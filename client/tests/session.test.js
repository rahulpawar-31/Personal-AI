import { test } from 'node:test';
import assert from 'node:assert/strict';

// See chatStream.test.js for why this shim is needed in plain Node.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const { getToken, setToken, clearToken, clearSession } = await import('../src/api.js');

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

test('clearToken removes only the token, leaving the onboarding flag untouched', () => {
  setToken('abc123');
  localStorage.setItem('devos_onboarding', 'true');

  clearToken();

  assert.equal(getToken(), null);
  assert.equal(localStorage.getItem('devos_onboarding'), 'true');

  localStorage.removeItem('devos_onboarding'); // cleanup
});
