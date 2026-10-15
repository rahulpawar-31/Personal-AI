// server/middleware/securityHeaders.js
// Response headers that tell the browser how much to trust the page.
//
// The same CSP is repeated in vercel.json, because Vercel serves the React app
// directly and only proxies /api to this server — headers set here never reach
// the HTML people actually load there. tests/securityHeaders.test.js fails if
// the two copies drift apart.
import { isHttps } from '../lib/env.js';

// style-src needs 'unsafe-inline' because React writes style="" attributes.
// script-src does not: the Vite build emits only external scripts.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS only where the site is really served over HTTPS: a bare-IP deploy
  // without TLS would otherwise tell browsers to refuse its own plain-HTTP pages.
  if (isHttps()) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}
