// server/lib/env.js
// Deployment-target detection, shared by index.js, services/auth.js,
// services/users.js, routes/auth.js and routes/webhooks.js.
// Any host declares itself production via NODE_ENV=production, and its public
// URL via PUBLIC_URL (e.g. http://1.2.3.4 or https://example.com).

export function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

// The externally-reachable origin (scheme + host, no trailing slash), or null
// if unknown (e.g. plain local dev) — callers decide their own fallback.
// Falls back to RENDER_EXTERNAL_URL, which Render injects automatically on
// every Web Service — no manual PUBLIC_URL needed for that host specifically.
export function publicOrigin() {
  const url = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (!url) return null;
  return url.replace(/\/+$/, '');
}

// How many reverse proxies sit in front of this server, for Express's
// `trust proxy`. It decides which address counts as the client in req.ip, which
// the per-address rate limits key on: too low and every visitor shares the
// proxy's address, too high and a client can put a made-up address at the
// front of X-Forwarded-For. The default, 1, is the long-standing behaviour.
// TRUST_PROXY_HOPS overrides it (a whole number from 0 to 5); anything else is
// ignored and reported in `valid`. The Admin page's request check shows what
// each value would pick for the real deployment.
export const DEFAULT_TRUST_PROXY_HOPS = 1;

export function parseTrustProxyHops(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { hops: DEFAULT_TRUST_PROXY_HOPS, valid: true };
  const text = String(raw).trim();
  const n = Number(text);
  if (/^\d+$/.test(text) && Number.isInteger(n) && n >= 0 && n <= 5) return { hops: n, valid: true };
  return { hops: DEFAULT_TRUST_PROXY_HOPS, valid: false };
}

// What to say in the log about the chosen hop count: one line always, so the
// setting in force can be read from the Render log, plus a warning for 0 in
// production, where every visitor would be seen as the proxy's address.
export function proxyHopsNotices({ hops, valid }, raw, production) {
  const notices = [];
  if (!valid) notices.push({ level: 'warn', text: `TRUST_PROXY_HOPS must be a whole number from 0 to 5; using ${hops}` });
  const source = valid && String(raw ?? '').trim() !== '' ? 'TRUST_PROXY_HOPS' : 'default';
  notices.push({ level: 'info', text: `trusting ${hops} proxy hop${hops === 1 ? '' : 's'} for client addresses (${source})` });
  if (hops === 0 && production) {
    notices.push({ level: 'warn', text: 'TRUST_PROXY_HOPS is 0 in production: behind a proxy every visitor shares the proxy\'s address, so the per-address rate limits act on everyone at once' });
  }
  return notices;
}

// Cookies must only be marked Secure when actually served over HTTPS — an
// HTTP-only deploy (e.g. a bare-IP VPS with no TLS yet) would silently drop
// them otherwise. Deliberately separate from isProduction().
export function isHttps() {
  return publicOrigin()?.startsWith('https://') ?? false;
}

// Extra frontend origins allowed to embed the app or initiate OAuth — e.g. a
// CDN-fronted deploy (Vercel) that proxies /api/* to this backend, so it has
// a different browser-visible origin than publicOrigin(). Comma-separated.
export function extraOrigins() {
  return (process.env.EXTRA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// Browser origins allowed to call the API with credentials. The localhost
// entries exist for local development only: in production they would let any
// program a visitor runs on their own machine act as an allowed origin.
export function corsOrigins() {
  const dev = isProduction() ? [] : ['http://localhost:5173', 'http://localhost:3001'];
  return [...dev, publicOrigin(), ...extraOrigins()].filter(Boolean);
}

// True if `origin` (scheme + host) is this server's own public origin or one
// of the explicitly-trusted extras above. Used to validate any client-supplied
// origin before treating it as a redirect target (OAuth callback, etc.) —
// never trust it unchecked, that's an open-redirect / host-injection risk.
export function isAllowedOrigin(origin) {
  if (!origin) return false;
  const clean = origin.replace(/\/+$/, '');
  return clean === publicOrigin() || extraOrigins().includes(clean);
}
