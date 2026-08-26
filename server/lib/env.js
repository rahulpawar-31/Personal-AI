// server/lib/env.js
// Deployment-target detection — host-agnostic so the server isn't tied to Railway.
// Declare production via NODE_ENV=production, and the externally-reachable URL
// via PUBLIC_URL (e.g. http://1.2.3.4 or https://example.com).

export function isProduction() {
  return process.env.NODE_ENV === 'production';
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

// True if `origin` (scheme + host) is this server's own public origin or one
// of the explicitly-trusted extras above. Used to validate any client-supplied
// origin before treating it as a redirect target (OAuth callback, etc.) —
// never trust it unchecked, that's an open-redirect / host-injection risk.
export function isAllowedOrigin(origin) {
  if (!origin) return false;
  const clean = origin.replace(/\/+$/, '');
  return clean === publicOrigin() || extraOrigins().includes(clean);
}
