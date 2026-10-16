import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// Per-user key: falls back to IP if userId isn't on the request yet (public endpoints).
// ipKeyGenerator() normalizes IPv6 addresses — raw req.ip throws
// ERR_ERL_KEY_GEN_IPV6 the moment this branch actually executes (currently
// dead via each limiter's `skip: !req.user` guard, but a live footgun for
// any future limiter that reuses this key function without that guard).
function userKey(req) {
  return req.user?.userId ? `user:${req.user.userId}` : ipKeyGenerator(req.ip);
}

// Digest runs are slow and hit multiple external APIs — 10 per hour per user.
export const digestLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             10,
  keyGenerator:    userKey,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many digest requests — try again in an hour.' },
  skip:            (req) => !req.user, // only limit authenticated calls
});

// Chat endpoints — 120 messages per minute per user.
export const chatLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  keyGenerator:    userKey,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Sending messages too fast — slow down a bit.' },
  skip:            (req) => !req.user,
});

// Credential test/save — 30 per minute per user.
export const credLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  keyGenerator:    userKey,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many credential requests — try again shortly.' },
  skip:            (req) => !req.user,
});

// Password change and account deletion both check the current password, so a
// stolen 15-minute access token could otherwise guess it as fast as the server
// answers. Only failed attempts count (skipSuccessfulRequests), so a legitimate
// change is never blocked. Keyed by user, not IP, so it holds whatever the
// proxy setup does to req.ip.
export const accountLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    5,
  keyGenerator:           userKey,
  skipSuccessfulRequests: true,
  standardHeaders:        'draft-7',
  legacyHeaders:          false,
  message:                { error: 'Too many failed attempts — try again in 15 minutes.' },
  skip:                   (req) => !req.user,
});

// Anything that sends a message to someone else on the user's behalf (email,
// Slack, LinkedIn webhook). One shared bucket so the routes cannot be used to
// get around each other: 30 per hour per user.
export const sendLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             30,
  keyGenerator:    userKey,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Sending too many messages — try again later.' },
  skip:            (req) => !req.user,
});

// Approving a queued send_email sends an email just like /api/email/send, so it
// draws from the same sendLimiter bucket — otherwise the agent's approve route
// would be a way round the cap. Other action types (tasks, calendar, ...) are
// not sends and are left alone. `getAction(userId, id)` loads the pending row;
// only a row still waiting for approval counts, so a repeated click on an
// already-resolved action does not use up quota.
export function limitSendApprovals(getAction) {
  return async (req, res, next) => {
    let action = null;
    try {
      action = await getAction(req.user?.userId, req.params.id);
    } catch {
      // Fall through: the route itself reports the real lookup error.
    }
    if (action?.actionType === 'send_email' && action.status === 'pending') {
      return sendLimiter(req, res, next);
    }
    next();
  };
}

// Logout writes to the database for any validly signed token, so it gets its own
// limit. Generous (60 per 15 minutes per IP) because it must never get in the way
// of someone signing out, and kept apart from authLimiter so signing out does not
// use up the login budget.
export const logoutLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             60,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many sign-out requests — try again later.' },
});

// Sign-in/signup/refresh, per address: 100 per 15 minutes. This only catches a
// single client hammering the API. It is deliberately loose because behind a
// shared proxy many people can share one address, and the limit that protects
// a password is the per-account one below, which does not depend on the address.
export const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts — try again later.' },
});

// Failed sign-ins against one account: 10 per 15 minutes, whichever address they
// come from, so guessing a password is slowed even when the attempts are spread
// over many addresses (or the address is not the real client's). Only failures
// count, so signing in correctly never uses it up. Trade-off: someone who knows
// the username can lock that account's sign-in for 15 minutes; refresh tokens
// and sessions already signed in are not affected.
export function loginAccountKey(req) {
  const name = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 64) : '';
  return name ? `login:${name}` : ipKeyGenerator(req.ip);
}

export const loginAccountLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    10,
  keyGenerator:           loginAccountKey,
  skipSuccessfulRequests: true,
  // Only a 401 (wrong credentials) is a failed sign-in. A 5xx from a database
  // outage is not the user's failure and must not use up the allowance.
  requestWasSuccessful:   (req, res) => res.statusCode !== 401,
  standardHeaders:        'draft-7',
  legacyHeaders:          false,
  message:                { error: 'Too many failed sign-ins for this account — try again in 15 minutes.' },
});
