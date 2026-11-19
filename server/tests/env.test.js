import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProduction, publicOrigin, frontendOrigin, corsOrigins, isAllowedOrigin, isHttps } from '../lib/env.js';

const KEYS = ['NODE_ENV', 'PUBLIC_URL', 'RENDER_EXTERNAL_URL', 'FRONTEND_URL', 'EXTRA_ALLOWED_ORIGINS'];

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

test('the hosted API trusts its exact versioned frontend even without optional environment settings', () => {
  withEnv({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://personal-ai-f2f9.onrender.com' }, () => {
    assert.equal(frontendOrigin(), 'https://personal-ai-blue.vercel.app');
    assert.ok(corsOrigins().includes(frontendOrigin()));
    assert.equal(isAllowedOrigin(frontendOrigin()), true);
    for (const origin of ['https://evil.vercel.app', 'https://personal-ai-blue.vercel.app.evil.test', 'https://evil.test', 'http://localhost:5173']) {
      assert.equal(isAllowedOrigin(origin), false, origin);
    }
    for (const origin of [undefined, null, 42, [], {}]) assert.equal(isAllowedOrigin(origin), false);
  });
});

test('the hosted pairing does not grant trust to unrelated deployments', () => {
  withEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://other.example.com' }, () => {
    assert.equal(frontendOrigin(), 'https://other.example.com');
    assert.equal(isAllowedOrigin('https://personal-ai-blue.vercel.app'), false);
  });
});

test('an explicit frontend overrides the hosted default and additional origins remain explicit', () => {
  withEnv({ NODE_ENV: 'production', PUBLIC_URL: 'https://api.example.com', FRONTEND_URL: 'https://app.example.com/', EXTRA_ALLOWED_ORIGINS: 'https://staging.example.com/' }, () => {
    assert.equal(frontendOrigin(), 'https://app.example.com');
    assert.deepEqual(corsOrigins(), ['https://api.example.com', 'https://app.example.com', 'https://staging.example.com']);
    assert.equal(isAllowedOrigin('https://app.example.com/'), true);
    assert.equal(isAllowedOrigin('https://staging.example.com'), true);
    assert.equal(isAllowedOrigin('https://api.example.com'), true);
    assert.equal(isAllowedOrigin('https://personal-ai-blue.vercel.app'), false);
  });
});
