import { Router } from 'express';
import crypto      from 'crypto';
import auth        from '../services/auth.js';
import * as userService from '../services/users.js';
import * as integrations from '../services/integrations.js';
import tracing     from '../services/tracing.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import { getUserCreds } from '../lib/creds.js';
import github from '../services/github.js';
import { publicOrigin, isHttps, isAllowedOrigin } from '../lib/env.js';

const NONCE_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/api/auth/google' };

function setNonceCookie(res, nonce) {
  res.cookie('oauth_nonce', nonce, { ...NONCE_COOKIE_OPTS, secure: isHttps(), maxAge: 10 * 60 * 1000 });
}

const router = Router();

const frontendURL = () => publicOrigin() ?? (process.env.APP_URL ?? 'http://localhost:5173');

// The browser page that starts the OAuth flow may be on a different origin
// than this server (e.g. Vercel proxying /api/* here) — the nonce cookie set
// on THAT origin is invisible to a callback that lands on THIS server's own
// origin, which always fails the CSRF check below. So the client tells us
// its current origin, we validate it against the trusted allow-list, and if
// valid we run the *entire* OAuth round-trip (redirect_uri + final redirect)
// through that same origin instead, keeping the cookie same-origin throughout.
function resolveRequestOrigin(req) {
  const requested = req.query.origin;
  if (requested && isAllowedOrigin(requested)) return requested.replace(/\/+$/, '');
  return null;
}

// Carries the resolved origin through Google's redirect (which only echoes
// back `code`/`state`, nothing else we pass) so the callback can reconstruct
// the identical redirect_uri the token exchange requires, and know where to
// send the user back. base64url keeps it free of the `:`/`/` the simple
// colon-delimited state string already uses as delimiters.
const encodeOrigin = origin => Buffer.from(origin).toString('base64url');
const decodeOrigin = encoded => Buffer.from(encoded, 'base64url').toString();

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/api/health', requireAuth, async (req, res) => {
  const creds = await getUserCreds(req.user.userId);
  const googleForUser = auth.isConnected(req.user.userId);
  const geminiShared  = !!process.env.GEMINI_API_KEY;
  const groqShared    = !!process.env.GROQ_API_KEY;
  res.json({
    ok:           true,
    google:       googleForUser,
    gemini:       !!(creds.GEMINI_API_KEY) || geminiShared,
    groq:         !!(creds.GROQ_API_KEY)   || groqShared,
    geminiShared,
    groqShared,
    notion:       !!(creds.NOTION_API_KEY),
    slack:        !!(creds.SLACK_BOT_TOKEN),
    github:       github.isConfigured(creds),
    trello:       !!(creds.TRELLO_API_KEY),
    todoist:      !!(creds.TODOIST_API_KEY),
    linkedin:     !!(creds.LINKEDIN_WEBHOOK_URL),
    tracing:      tracing.tracingStatus().enabled,
  });
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────

router.get('/api/auth/google/init', requireAuth, (req, res) => {
  const fromSettings = req.query.from === 'settings';
  const nonce  = crypto.randomBytes(16).toString('hex');
  const origin = resolveRequestOrigin(req) ?? frontendURL();
  const state  = `uid:${req.user.userId}${fromSettings ? ':from:settings' : ''}:nonce:${nonce}:origin:${encodeOrigin(origin)}`;
  setNonceCookie(res, nonce);
  res.json({ url: auth.getAuthUrl(state, origin) });
});

router.get('/api/auth/google/signin', (req, res) => {
  const nonce  = crypto.randomBytes(16).toString('hex');
  const origin = resolveRequestOrigin(req) ?? frontendURL();
  setNonceCookie(res, nonce);
  res.redirect(auth.getAuthUrl(`mode:signin:nonce:${nonce}:origin:${encodeOrigin(origin)}`, origin));
});

router.get('/api/auth/google', (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.redirect(`${frontendURL()}/`);
  try {
    const payload = userService.verifyToken(header.slice(7));
    const fromSettings = req.query.from === 'settings';
    const nonce  = crypto.randomBytes(16).toString('hex');
    const origin = resolveRequestOrigin(req) ?? frontendURL();
    const state  = `uid:${payload.userId}${fromSettings ? ':from:settings' : ''}:nonce:${nonce}:origin:${encodeOrigin(origin)}`;
    setNonceCookie(res, nonce);
    res.redirect(auth.getAuthUrl(state, origin));
  } catch {
    return res.redirect(`${frontendURL()}/`);
  }
});

router.get('/api/auth/google/callback', async (req, res) => {
  const stateStr = req.query.state ?? '';

  // The token exchange requires the EXACT redirect_uri used at authorize
  // time, so resolve the initiating origin from state before touching the
  // OAuth2 client at all — not after, and re-validate it (defense in depth;
  // the nonce check below is the real CSRF guard) so a tampered state value
  // can't be used as an open-redirect target.
  const encodedOrigin  = stateStr.match(/origin:([A-Za-z0-9_-]+)/)?.[1];
  let originFromState  = null;
  if (encodedOrigin) {
    try { originFromState = decodeOrigin(encodedOrigin); } catch { /* malformed — ignore */ }
  }
  const originAllowed = !!(originFromState && isAllowedOrigin(originFromState));
  const redirectBase  = originAllowed ? originFromState : frontendURL();

  try {
    const client     = auth.createOAuth2Client(redirectBase);
    const { tokens } = await client.getToken(req.query.code);

    // CSRF: verify the nonce embedded in state matches the httpOnly cookie
    const nonceInState  = stateStr.match(/nonce:([a-f0-9]{32})/)?.[1];
    const nonceInCookie = req.cookies?.oauth_nonce;
    res.clearCookie('oauth_nonce', NONCE_COOKIE_OPTS);
    if (!nonceInState || !nonceInCookie || nonceInState !== nonceInCookie) {
      console.warn('[auth/google/callback] nonce mismatch — possible CSRF attempt', {
        cookiePresent: !!nonceInCookie,
        statePresent:  !!nonceInState,
        hadOriginInState: !!encodedOrigin,
        originAllowed,
      });
      return res.redirect(`${redirectBase}/?auth_error=google_failed&detail=invalid_state`);
    }

    if (stateStr.includes('mode:signin')) {
      client.setCredentials(tokens);
      const { google: googleapis } = await import('googleapis');
      const oauth2   = googleapis.oauth2({ version: 'v2', auth: client });
      const profile  = await oauth2.userinfo.get();
      const googleId = profile.data.id;
      const email    = profile.data.email;
      const name     = profile.data.name ?? '';

      let user = await userService.dbFindByGoogleId(googleId);
      if (!user) {
        const existing = await userService.dbFindByEmail(email);
        if (existing) {
          await userService.dbLinkGoogleId(existing.id, googleId);
          user = existing;
        } else {
          let base = (email.split('@')[0] ?? name).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28) || 'user';
          let username = base, attempt = 1;
          while (true) {
            try {
              user = await userService.dbCreateGoogleUser({ username, email, googleId });
              break;
            } catch (e) {
              if (!e.message.includes('already taken') && !e.message.includes('unique')) throw e;
              username = `${base}_${attempt++}`;
            }
          }
        }
      }

      await auth.saveTokens(tokens, user.id);
      const jwtUser = { id: user.id, username: user.username };
      const token   = userService.signToken(jwtUser);
      userService.setRefreshCookie(res, jwtUser);
      return res.redirect(`${redirectBase}/#google_token=${token}`);
    }

    const uidMatch = stateStr.match(/uid:(\d+)/);
    const userId   = uidMatch ? parseInt(uidMatch[1], 10) : null;
    if (!userId) {
      console.error('[auth/google/callback] missing uid in OAuth state');
      return res.redirect(`${redirectBase}/?auth_error=google_failed`);
    }
    await auth.saveTokens(tokens, userId);
    const fromSettings = stateStr.includes('from:settings');
    res.redirect(`${redirectBase}${fromSettings ? '/settings?google_connected=true' : '/?connected=true'}`);
  } catch (err) {
    console.error('[auth/google/callback] FULL ERROR:', err);
    const msg = encodeURIComponent(err.message ?? 'Unknown error');
    res.redirect(`${redirectBase}/?auth_error=google_failed&detail=${msg}`);
  }
});

router.get('/api/auth/google/email', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  if (!auth.isConnected(uid)) return res.json({ connected: false, email: null });
  try {
    const { google: googleapis } = await import('googleapis');
    const client  = await auth.getAuthClient(uid);
    const gmailApi = googleapis.gmail({ version: 'v1', auth: client });
    const profile = await gmailApi.users.getProfile({ userId: 'me' });
    res.json({ connected: true, email: profile.data.emailAddress });
  } catch {
    res.json({ connected: true, email: null });
  }
});

router.get('/api/auth/status', requireAuth, (req, res) => {
  res.json({ connected: auth.isConnected(req.user.userId) });
});

// ─── Account auth ─────────────────────────────────────────────────────────────

router.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const user  = await userService.createUser(username, password, email);
    const token = userService.signToken(user);
    userService.setRefreshCookie(res, user);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user  = await userService.loginUser(username, password);
    const token = userService.signToken(user);
    userService.setRefreshCookie(res, user);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Silent refresh — frontend calls this when the access token expires.
// The httpOnly refresh cookie is sent automatically by the browser.
router.post('/api/auth/refresh', authLimiter, (req, res) => {
  const rt = req.cookies?.refresh_token;
  if (!rt) return res.status(401).json({ error: 'No refresh token' });
  try {
    const payload = userService.verifyToken(rt);
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Invalid token type' });
    const user  = { id: payload.userId, username: payload.username };
    const token = userService.signToken(user);
    userService.setRefreshCookie(res, user); // rotate the cookie
    res.json({ token });
  } catch {
    userService.clearRefreshCookie(res);
    res.status(401).json({ error: 'Refresh token expired — please log in again' });
  }
});

router.post('/api/auth/logout', (req, res) => {
  userService.clearRefreshCookie(res);
  res.json({ ok: true });
});

router.get('/api/users/me', async (req, res) => {
  const auth_header = req.headers.authorization;
  if (!auth_header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const payload = userService.verifyToken(auth_header.slice(7));
    const user    = await userService.getUserById(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { dbIsAdmin } = await import('../services/db.js');
    const isAdmin = await dbIsAdmin(payload.userId);
    res.json({ id: user.id, username: user.username, email: user.email, isAdmin });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
