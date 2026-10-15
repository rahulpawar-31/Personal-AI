import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { securityHeaders, CONTENT_SECURITY_POLICY } from '../middleware/securityHeaders.js';
import { corsOrigins } from '../lib/env.js';

function headersFor(env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  const set = {};
  try {
    securityHeaders({}, { setHeader: (k, v) => { set[k] = v; } }, () => {});
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
  return set;
}

test('every response gets CSP, nosniff and a referrer policy', () => {
  const h = headersFor({});
  assert.equal(h['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
});

test('the CSP forbids framing, plugins and inline scripts', () => {
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  const script = CONTENT_SECURITY_POLICY.split('; ').find(d => d.startsWith('script-src'));
  assert.equal(script, "script-src 'self'");
});

test('HSTS is sent only when the site is served over HTTPS', () => {
  assert.match(headersFor({ PUBLIC_URL: 'https://app.example.com' })['Strict-Transport-Security'], /max-age=\d+/);
  assert.equal(headersFor({ PUBLIC_URL: 'http://1.2.3.4' })['Strict-Transport-Security'], undefined);
});

test('vercel.json serves the same CSP as the server', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const all = cfg.headers.find(h => h.source === '/(.*)').headers;
  assert.equal(all.find(h => h.key === 'Content-Security-Policy').value, CONTENT_SECURITY_POLICY);
  assert.equal(all.find(h => h.key === 'X-Content-Type-Options').value, 'nosniff');
});

test('localhost origins are allowed in development but not in production', () => {
  const run = env => {
    const keys = ['NODE_ENV', 'RAILWAY_PUBLIC_DOMAIN', 'PUBLIC_URL', 'EXTRA_ALLOWED_ORIGINS'];
    const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, env);
    try { return corsOrigins(); } finally {
      for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
  assert.ok(run({ NODE_ENV: 'development' }).includes('http://localhost:5173'));
  const prod = run({ NODE_ENV: 'production', PUBLIC_URL: 'https://app.example.com/', EXTRA_ALLOWED_ORIGINS: 'https://x.vercel.app' });
  assert.deepEqual(prod, ['https://app.example.com', 'https://x.vercel.app']);
  assert.ok(!prod.some(o => o.includes('localhost')));
});
