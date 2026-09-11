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

const { createCache } = await import('../src/hooks/useCache.js');

test('get returns null when nothing is cached', () => {
  const cache = createCache('k1', 1000);
  assert.equal(cache.get(), null);
});

test('set then get round-trips the cached value', () => {
  const cache = createCache('k2', 1000);
  cache.set({ hello: 'world' });
  assert.deepEqual(cache.get(), { hello: 'world' });
});

test('get returns null once the entry is older than ttlMs', () => {
  const cache = createCache('k3', 10);
  cache.set('stale-soon');
  localStorage.setItem('k3', JSON.stringify({ data: 'stale-soon', at: Date.now() - 1000 }));
  assert.equal(cache.get(), null);
});

test('clear removes the cached entry', () => {
  const cache = createCache('k4', 1000);
  cache.set('x');
  cache.clear();
  assert.equal(cache.get(), null);
});

test('get/set/clear accept an explicit key that overrides defaultKey', () => {
  const cache = createCache('default-key', 1000);
  cache.set('per-repo-value', 'devos_github_owner_repo');
  assert.equal(cache.get('devos_github_owner_repo'), 'per-repo-value');
  assert.equal(cache.get(), null); // defaultKey untouched

  cache.clear('devos_github_owner_repo');
  assert.equal(cache.get('devos_github_owner_repo'), null);
});

test('getWithAge returns both the value and the stored timestamp', () => {
  const cache = createCache('k5', 1000);
  const before = Date.now();
  cache.set({ list: [1, 2, 3] });
  const result = cache.getWithAge();
  assert.deepEqual(result.value, { list: [1, 2, 3] });
  assert.ok(result.at >= before);
});

test('getWithAge returns null when nothing is cached or the entry expired', () => {
  const cache = createCache('k6', 10);
  assert.equal(cache.getWithAge(), null);
  localStorage.setItem('k6', JSON.stringify({ data: 'x', at: Date.now() - 1000 }));
  assert.equal(cache.getWithAge(), null);
});
