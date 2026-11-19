import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, clearSession, getToken, setToken } from '../src/api.js';
import { checkSession } from '../src/sessionCheck.js';

if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    key: index => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

const reply = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

function session(t, fetch) {
  clearSession();
  setToken('expired-access-token');
  localStorage.setItem('devos_emails_7', 'cached mail');
  t.mock.method(globalThis, 'fetch', fetch);
  t.after(clearSession);
}

test('a refresh outage or rate limit keeps an expired access token recoverable', async t => {
  for (const status of [429, 500, 502, 503, 504]) {
    session(t, async url => url === '/api/auth/refresh'
      ? reply(status, { error: 'temporarily unavailable' })
      : reply(401, { error: 'access token expired' }));
    assert.deepEqual(await checkSession(() => apiFetch('/api/users/me')), { status: 'unavailable' });
    assert.equal(getToken(), 'expired-access-token');
    assert.equal(localStorage.getItem('devos_emails_7'), 'cached mail');
  }
});

test('network and unreadable refresh responses are temporary failures', async t => {
  for (const refresh of [
    () => { throw new TypeError('Failed to fetch'); },
    () => new Response('<html>Bad gateway</html>', { status: 200 }),
    () => reply(200, {}),
  ]) {
    session(t, async url => url === '/api/auth/refresh' ? refresh() : reply(401, {}));
    assert.deepEqual(await checkSession(() => apiFetch('/api/users/me')), { status: 'unavailable' });
    assert.equal(getToken(), 'expired-access-token');
  }
});

test('an explicitly rejected refresh still reports an invalid session', async t => {
  session(t, async () => reply(401, { error: 'expired' }));
  assert.deepEqual(await checkSession(() => apiFetch('/api/users/me')), { status: 'invalid' });
});

test('retry after a refresh outage restores the session without another login', async t => {
  let available = false;
  session(t, async (url, options) => {
    if (url === '/api/auth/refresh') return available
      ? reply(200, { token: 'renewed-access-token' }) : reply(503, {});
    return options.headers.Authorization === 'Bearer renewed-access-token'
      ? reply(200, { id: 7, username: 'reviewer' }) : reply(401, {});
  });
  assert.deepEqual(await checkSession(() => apiFetch('/api/users/me')), { status: 'unavailable' });
  available = true;
  assert.deepEqual(await checkSession(() => apiFetch('/api/users/me')), {
    status: 'ok', user: { id: 7, username: 'reviewer' },
  });
  assert.equal(getToken(), 'renewed-access-token');
});

test('concurrent expired requests still share a single refresh and retry with the new token', async t => {
  let refreshes = 0;
  session(t, async (url, options) => {
    if (url === '/api/auth/refresh') {
      refreshes += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return reply(200, { token: 'renewed-access-token' });
    }
    return options.headers.Authorization === 'Bearer renewed-access-token'
      ? reply(200, { ok: true }) : reply(401, {});
  });
  const results = await Promise.all([apiFetch('/api/users/me'), apiFetch('/api/health')]);
  assert.ok(results.every(result => result.ok));
  assert.equal(refreshes, 1);
});

test('a request without a token does not try to refresh an anonymous session', async t => {
  const calls = [];
  session(t, async url => { calls.push(url); return reply(401, {}); });
  clearSession();
  assert.equal((await apiFetch('/api/users/me')).status, 401);
  assert.deepEqual(calls, ['/api/users/me']);
});
