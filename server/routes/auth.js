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

function setNonceCookie(res, nonce) {
  res.cookie('oauth_nonce', nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   !!process.env.RAILWAY_PUBLIC_DOMAIN,
    maxAge:   10 * 60 * 1000,
  });
}

const router = Router();

const frontendURL = () => process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.APP_URL ?? 'http://localhost:5173');

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
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `uid:${req.user.userId}${fromSettings ? ':from:settings' : ''}:nonce:${nonce}`;
  setNonceCookie(res, nonce);
  res.json({ url: auth.getAuthUrl(state) });
});

router.get('/api/auth/google/signin', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('hex');
  setNonceCookie(res, nonce);
  res.redirect(auth.getAuthUrl(`mode:signin:nonce:${nonce}`));
});

router.get('/api/auth/google/callback', async (req, res) => {
  try {
    const client     = auth.createOAuth2Client();
    const { tokens } = await client.getToken(req.query.code);
    const stateStr   = req.query.state ?? '';

    // CSRF: verify the nonce embedded in state matches the httpOnly cookie
    const nonceInState  = stateStr.match(/nonce:([a-f0-9]{32})/)?.[1];
    const nonceInCookie = req.cookies?.oauth_nonce;
    res.clearCookie('oauth_nonce');
    if (!nonceInState || !nonceInCookie || nonceInState !== nonceInCookie) {
      console.warn('[auth/google/callback] nonce mismatch — possible CSRF attempt');
      return res.redirect(`${frontendURL()}/?auth_error=google_failed&detail=invalid_state`);
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
      return res.redirect(`${frontendURL()}/#google_token=${token}`);
    }

    const uidMatch = stateStr.match(/uid:(\d+)/);
    const userId   = uidMatch ? parseInt(uidMatch[1], 10) : null;
    if (!userId) {
      console.error('[auth/google/callback] missing uid in OAuth state');
      return res.redirect(`${frontendURL()}/?auth_error=google_failed`);
    }
    await auth.saveTokens(tokens, userId);
    const fromSettings = stateStr.includes('from:settings');
    res.redirect(`${frontendURL()}${fromSettings ? '/settings?google_connected=true' : '/?connected=true'}`);
  } catch (err) {
    console.error('[auth/google/callback] FULL ERROR:', err);
    const msg = encodeURIComponent(err.message ?? 'Unknown error');
    res.redirect(`${frontendURL()}/?auth_error=google_failed&detail=${msg}`);
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

router.post('/api/auth/google/disconnect', requireAuth, async (req, res) => {
  try {
    await auth.disconnectUser(req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
