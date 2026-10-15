import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Static guard: every route in server/routes must either run requireAuth /
// requireAdmin, or be on the explicit public list below. Adding a route with no
// guard (the easy mistake) fails this test, and so does leaving a stale entry on
// the list. server/tests/smoke-auth.sh checks the same thing against a live server.
const ROUTES_DIR = new URL('../routes/', import.meta.url);

// Routes that are meant to be reachable without a bearer token, and why.
const PUBLIC = {
  'POST /api/auth/signup':          'creates an account (rate limited, invite-only in production)',
  'POST /api/auth/login':           'issues tokens from a password (rate limited)',
  'POST /api/auth/refresh':         'authenticates by the httpOnly refresh cookie instead',
  'POST /api/auth/logout':          'only clears the caller\'s own cookie',
  'GET /api/auth/google/signin':    'starts Google sign-in',
  'GET /api/auth/google/callback':  'verifies a signed OAuth state instead',
  'GET /api/users/me':              'checks the bearer token itself and returns 401 without one',
  'GET /api/webhook/info':          'static info about the webhook URL, no user data',
  'POST /api/webhook/github':       'authenticated by the HMAC signature of the body',
};

function findRoutes() {
  const found = [];
  const call = /router\.(get|post|put|patch|delete)\(\s*(['"`])(.+?)\2\s*,([\s\S]*?)(?:async\s*)?\(\s*req\s*,\s*res/g;
  for (const file of readdirSync(ROUTES_DIR).filter(f => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, ROUTES_DIR), 'utf8');
    for (const m of src.matchAll(call)) {
      found.push({ key: `${m[1].toUpperCase()} ${m[3]}`, file, middleware: m[4] });
    }
  }
  return found;
}

const routes = findRoutes();

test('the route scanner finds the whole route surface', () => {
  // A floor, not an exact count, so adding routes does not mean editing this test —
  // but a regex that silently matches nothing cannot pass.
  assert.ok(routes.length >= 60, `only found ${routes.length} routes`);
  assert.ok(routes.some(r => r.key === 'POST /api/email/send'));
  assert.ok(routes.some(r => r.key === 'GET /api/admin/users'));
});

test('every route is guarded or explicitly public', () => {
  const unguarded = routes.filter(r => !/requireAuth|requireAdmin/.test(r.middleware) && !(r.key in PUBLIC));
  assert.deepEqual(unguarded.map(r => `${r.key} (${r.file})`), [], 'add requireAuth, or list the route as public with a reason');
});

test('the public list has no stale entries and every entry really is unguarded', () => {
  const keys = new Set(routes.map(r => r.key));
  for (const key of Object.keys(PUBLIC)) assert.ok(keys.has(key), `${key} is on the public list but is not a route`);
  for (const r of routes.filter(r => r.key in PUBLIC)) {
    assert.doesNotMatch(r.middleware, /requireAuth|requireAdmin/, `${r.key} is guarded; remove it from the public list`);
  }
});

test('every /api/admin route uses requireAdmin, not just requireAuth', () => {
  const admin = routes.filter(r => r.key.includes(' /api/admin/'));
  assert.ok(admin.length >= 4);
  for (const r of admin) assert.match(r.middleware, /requireAdmin/, r.key);
});

test('routes that send messages or change accounts are rate limited', () => {
  const limited = {
    'POST /api/email/send': /sendLimiter/,
    'POST /api/email/approve-draft': /sendLimiter/,
    'POST /api/slack/send': /sendLimiter/,
    'POST /api/content/approve': /sendLimiter/,
    'PUT /api/users/me/password': /accountLimiter/,
    'DELETE /api/users/me': /accountLimiter/,
  };
  for (const [key, limiter] of Object.entries(limited)) {
    const r = routes.find(x => x.key === key);
    assert.ok(r, `${key} not found`);
    assert.match(r.middleware, limiter, key);
  }
});
