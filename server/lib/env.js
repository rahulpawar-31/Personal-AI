// server/lib/env.js
// Deployment-target detection — host-agnostic so the server isn't tied to Railway.
// Declare production via NODE_ENV=production, and the externally-reachable URL
// via PUBLIC_URL (e.g. http://1.2.3.4 or https://example.com).

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// The externally-reachable origin (scheme + host, no trailing slash), or null
// if unknown (e.g. plain local dev) — callers decide their own fallback.
export function publicOrigin() {
  if (!process.env.PUBLIC_URL) return null;
  return process.env.PUBLIC_URL.replace(/\/+$/, '');
}

// Cookies must only be marked Secure when actually served over HTTPS — an
// HTTP-only deploy (e.g. a bare-IP VPS with no TLS yet) would silently drop
// them otherwise. Deliberately separate from isProduction().
export function isHttps() {
  return publicOrigin()?.startsWith('https://') ?? false;
}
