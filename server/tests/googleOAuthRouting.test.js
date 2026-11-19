import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import cookieParser from 'cookie-parser';
import { google } from 'googleapis';
import auth from '../services/auth.js';
import router from '../routes/auth.js';
import { dbCreateGoogleUser, dbDeleteUser } from '../services/db.js';
import { verifyToken } from '../services/users.js';

const FRONTEND = 'https://personal-ai-blue.vercel.app';
const API = 'https://personal-ai-f2f9.onrender.com';
const decode = state => JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString());

async function setup(t, { googleId } = {}) {
  const env = { NODE_ENV: 'production', PUBLIC_URL: API, JWT_SECRET: 'test-only-oauth-routing-signature-secret' };
  const keys = [...Object.keys(env), 'FRONTEND_URL', 'EXTRA_ALLOWED_ORIGINS'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  t.mock.method(auth, 'getAuthUrl', (origin, state) => {
    const url = new URL('/o/oauth2/v2/auth', 'https://accounts.google.com');
    url.searchParams.set('redirect_uri', `${origin}/api/auth/google/callback`);
    url.searchParams.set('state', state);
    return url.href;
  });
  const exchanges = [];
  t.mock.method(auth, 'createOAuth2Client', origin => ({ setCredentials() {}, getToken: async code => {
    exchanges.push({ origin, code });
    if (googleId) return { tokens: { access_token: 'test-only-google-access-token' } };
    throw new Error('test stops before any real Google or account operation');
  } }));
  if (googleId) {
    t.mock.method(auth, 'saveTokens', async () => {});
    t.mock.method(google, 'oauth2', () => ({ userinfo: { get: async () => ({ data: { id: googleId } }) } }));
  }
  const app = express(); app.use(cookieParser()); app.use(router);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(new URL(url, base), { ...options, redirect: 'manual' });
  const start = async origin => {
    const response = await request(`/api/auth/google/signin?origin=${encodeURIComponent(origin)}`);
    assert.equal(response.status, 302);
    return new URL(response.headers.get('location'));
  };
  return { request, start, exchanges };
}

test('Google keeps its registered API callback while the browser returns and completes through Vercel', async t => {
  const { start, request, exchanges } = await setup(t);
  const google = await start(FRONTEND);
  assert.equal(google.searchParams.get('redirect_uri'), `${API}/api/auth/google/callback`);
  const state = google.searchParams.get('state');
  assert.equal(decode(state).origin, FRONTEND);
  assert.equal(decode(state).callbackOrigin, API);

  const first = await request(`/api/auth/google/callback?${new URLSearchParams({ state, code: 'test-code' })}`);
  assert.equal(first.status, 302);
  const forward = new URL(first.headers.get('location'));
  assert.equal(forward.origin, FRONTEND);
  assert.equal(forward.pathname, '/api/auth/google/callback');
  assert.equal(decode(forward.searchParams.get('state')).forwarded, true);
  assert.equal(forward.searchParams.get('code'), 'test-code');
  assert.equal(first.headers.get('set-cookie'), null, 'the API hop must not issue the browser session cookie');
  assert.deepEqual(exchanges, []);

  const second = await request(`${forward.pathname}${forward.search}`);
  assert.deepEqual(exchanges, [{ origin: API, code: 'test-code' }], 'the exchange still uses the exact callback registered with Google');
  assert.equal(new URL(second.headers.get('location')).origin, FRONTEND);
  assert.match(second.headers.get('location'), /auth_error=google_failed/);
});

test('untrusted requested origins fall back safely and a tampered forwarded state never exchanges a code', async t => {
  const { start, request, exchanges } = await setup(t);
  const google = await start('https://evil.example');
  const state = google.searchParams.get('state');
  assert.equal(decode(state).origin, FRONTEND);
  const [, signature] = state.split('.');
  const changed = { ...decode(state), origin: 'https://evil.example', forwarded: true };
  const tampered = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
  const response = await request(`/api/auth/google/callback?${new URLSearchParams({ state: tampered, code: 'test-code' })}`);
  assert.equal(new URL(response.headers.get('location')).origin, FRONTEND);
  assert.match(response.headers.get('location'), /invalid_state/);
  assert.deepEqual(exchanges, []);
});

test('the forwarded sign-in issues a host-only refresh cookie that can restore the same account', async t => {
  const googleId = `routing-test-${Date.now()}`;
  const account = await dbCreateGoogleUser({ username: `oauth_${Date.now()}`, email: `${googleId}@example.test`, googleId });
  t.after(() => dbDeleteUser(account.id));
  const { start, request, exchanges } = await setup(t, { googleId });
  const googleUrl = await start(FRONTEND);
  const state = googleUrl.searchParams.get('state');
  const first = await request(`/api/auth/google/callback?${new URLSearchParams({ state, code: 'test-code' })}`);
  assert.equal(first.headers.get('set-cookie'), null);
  const forwarded = new URL(first.headers.get('location'));
  assert.equal(forwarded.origin, FRONTEND);
  const completed = await request(`${forwarded.pathname}${forwarded.search}`);
  assert.equal(completed.status, 302);
  const destination = new URL(completed.headers.get('location'));
  assert.equal(destination.origin, FRONTEND);
  const access = new URLSearchParams(destination.hash.slice(1)).get('google_token');
  assert.equal(verifyToken(access).userId, account.id);
  assert.deepEqual(exchanges, [{ origin: API, code: 'test-code' }]);
  const cookie = completed.headers.get('set-cookie');
  assert.match(cookie, /^refresh_token=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/api\/auth\/refresh/);
  assert.doesNotMatch(cookie, /Domain=/i, 'the frontend response sets its own host-only cookie');
  const refreshed = await request('/api/auth/refresh', { method: 'POST', headers: { Cookie: cookie.split(';')[0] } });
  assert.equal(refreshed.status, 200);
  assert.equal(verifyToken((await refreshed.json()).token).userId, account.id);
});

test('same-origin sign-in exchanges directly and cancelled consent returns safely to the frontend', async t => {
  const { start, request, exchanges } = await setup(t);
  const direct = await start(API);
  const directResult = await request(`/api/auth/google/callback?${new URLSearchParams({ state: direct.searchParams.get('state'), code: 'direct-code' })}`);
  assert.deepEqual(exchanges, [{ origin: API, code: 'direct-code' }]);
  assert.equal(new URL(directResult.headers.get('location')).origin, API);
  const split = await start(FRONTEND);
  const cancelled = await request(`/api/auth/google/callback?${new URLSearchParams({ state: split.searchParams.get('state'), error: 'access_denied' })}`);
  assert.equal(new URL(cancelled.headers.get('location')).origin, FRONTEND);
  assert.equal(exchanges.length, 1, 'cancelled consent does not attempt a token exchange');
});
