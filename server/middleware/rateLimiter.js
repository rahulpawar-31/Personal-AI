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

// Auth endpoints (login/signup) — 20 per 15 minutes per IP to slow brute-force.
export const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             20,
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts — try again later.' },
});
