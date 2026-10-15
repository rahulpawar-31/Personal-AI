import { test } from 'node:test';
import assert from 'node:assert/strict';

// See chatStream.test.js for why this shim is needed in plain Node.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

const { getToken, setToken, clearToken, clearSession, clearCachedData } = await import('../src/api.js');

test('getToken returns null when nothing is stored', () => {
  clearSession();
  assert.equal(getToken(), null);
});

test('setToken then getToken round-trips', () => {
  setToken('abc123');
  assert.equal(getToken(), 'abc123');
  clearSession();
});

test('clearSession removes both the token and the onboarding flag', () => {
  setToken('abc123');
  localStorage.setItem('devos_onboarding', 'true');

  clearSession();

  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem('devos_onboarding'), null);
});

test('clearSession removes every cached copy of account data, and only devos_ keys (#346)', () => {
  setToken('abc123');
  for (const k of ['devos_emails_7', 'devos_github_7_ada_devos', 'devos_chat_history_7', 'devos_view', 'devos_emails']) {
    localStorage.setItem(k, '{"data":"private"}');
  }
  localStorage.setItem('unrelated_key', 'keep me');

  clearSession();

  for (const k of ['devos_emails_7', 'devos_github_7_ada_devos', 'devos_chat_history_7', 'devos_view', 'devos_emails']) {
    assert.equal(localStorage.getItem(k), null, `${k} should be cleared`);
  }
  assert.equal(localStorage.getItem('unrelated_key'), 'keep me');
  localStorage.removeItem('unrelated_key');
});

test('clearCachedData leaves the token and onboarding flag to their own clearers', () => {
  setToken('abc123');
  localStorage.setItem('devos_onboarding', 'true');
  localStorage.setItem('devos_emails_7', 'x');

  clearCachedData();

  assert.equal(localStorage.getItem('devos_emails_7'), null);
  assert.equal(getToken(), 'abc123');
  assert.equal(localStorage.getItem('devos_onboarding'), 'true');
  clearSession();
});

test('clearToken removes only the token, leaving the onboarding flag untouched', () => {
  setToken('abc123');
  localStorage.setItem('devos_onboarding', 'true');

  clearToken();

  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem('devos_onboarding'), 'true');

  localStorage.removeItem('devos_onboarding'); // cleanup
});
