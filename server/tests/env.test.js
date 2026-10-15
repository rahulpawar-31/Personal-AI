import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProduction, publicOrigin, isHttps } from '../lib/env.js';

const KEYS = ['NODE_ENV', 'PUBLIC_URL', 'RENDER_EXTERNAL_URL'];

// Runs fn with exactly these environment variables set (and the others unset).
function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

test('production means NODE_ENV=production and nothing else', () => {
  assert.equal(isProduction({ NODE_ENV: 'production' }), true);
  assert.equal(isProduction({ NODE_ENV: 'development' }), false);
  assert.equal(isProduction({ NODE_ENV: 'test' }), false);
  assert.equal(isProduction({}), false);
});

test('other hosting variables do not make a deploy count as production', () => {
  // A host must declare itself with NODE_ENV; no platform-specific variable does it for it.
  for (const name of ['PUBLIC_URL', 'RENDER_EXTERNAL_URL', 'PORT', 'HOST']) {
    assert.equal(isProduction({ [name]: 'https://example.com' }), false, name);
  }
});

test('the public origin comes from PUBLIC_URL, then RENDER_EXTERNAL_URL, without a trailing slash', () => {
  assert.equal(withEnv({}, publicOrigin), null);
  assert.equal(withEnv({ PUBLIC_URL: 'https://app.example.com/' }, publicOrigin), 'https://app.example.com');
  assert.equal(withEnv({ RENDER_EXTERNAL_URL: 'https://api.onrender.com//' }, publicOrigin), 'https://api.onrender.com');
  assert.equal(
    withEnv({ PUBLIC_URL: 'https://custom.example.com', RENDER_EXTERNAL_URL: 'https://api.onrender.com' }, publicOrigin),
    'https://custom.example.com',
    'an explicit PUBLIC_URL wins over the one Render provides',
  );
});

test('isHttps follows the public origin', () => {
  assert.equal(withEnv({ PUBLIC_URL: 'https://app.example.com' }, isHttps), true);
  assert.equal(withEnv({ PUBLIC_URL: 'http://1.2.3.4' }, isHttps), false);
  assert.equal(withEnv({}, isHttps), false);
});
