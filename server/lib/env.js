// server/lib/env.js
// Deployment-target detection — was duplicated ad hoc (and Railway-only) across
// index.js, services/auth.js, services/users.js, routes/auth.js, routes/webhooks.js.
// Any host can now declare itself production via NODE_ENV=production, and its
// public URL via PUBLIC_URL (e.g. http://1.2.3.4 or https://example.com) —
// RAILWAY_PUBLIC_DOMAIN keeps working unchanged for existing Railway deploys.

export function isProduction() {
  return !!process.env.RAILWAY_PUBLIC_DOMAIN || process.env.NODE_ENV === 'production';
}

// The externally-reachable origin (scheme + host, no trailing slash), or null
// if unknown (e.g. plain local dev) — callers decide their own fallback.
export function publicOrigin() {
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return null;
}

// Cookies must only be marked Secure when actually served over HTTPS — an
// HTTP-only deploy (e.g. a bare-IP VPS with no TLS yet) would silently drop
// them otherwise. Deliberately separate from isProduction().
export function isHttps() {
  return publicOrigin()?.startsWith('https://') ?? false;
}
