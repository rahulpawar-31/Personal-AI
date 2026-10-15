import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigProblems, assertProductionConfig } from '../lib/startupConfig.js';

const complete = {
  NODE_ENV: 'production',
  JWT_SECRET: 'f3a9c1e7b5d20486a1c3e5f70b92d4c8',
  DATABASE_URL: 'postgresql://example/db',
  OWNER_USERNAME: 'owner',
};

test('a complete production config has no problems', () => {
  assert.deepEqual(productionConfigProblems(complete), []);
});

test('outside production nothing is required', () => {
  assert.deepEqual(productionConfigProblems({ NODE_ENV: 'test' }), []);
  assert.deepEqual(productionConfigProblems({}), []);
});

test('production reports each missing or weak setting', () => {
  assert.equal(productionConfigProblems({ NODE_ENV: 'production' }).length, 3);
  assert.match(productionConfigProblems({ ...complete, JWT_SECRET: 'short' })[0], /JWT_SECRET/);
  assert.match(productionConfigProblems({ ...complete, DATABASE_URL: '  ' })[0], /DATABASE_URL/);
  assert.match(productionConfigProblems({ ...complete, OWNER_USERNAME: '' })[0], /OWNER_USERNAME/);
});

test('production rejects a long but guessable JWT_SECRET', () => {
  for (const weak of ['x'.repeat(32), 'ab'.repeat(20), 'changeme-changeme-changeme-change', 'your-secret-key-goes-here-0123456789']) {
    const problems = productionConfigProblems({ ...complete, JWT_SECRET: weak });
    assert.equal(problems.length, 1, weak);
    assert.match(problems[0], /JWT_SECRET looks guessable/);
  }
});

test('production accepts a generated JWT_SECRET (hex and base64)', () => {
  const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const b64 = 'k3Jx9Qw2LmZp7TnVb4YcR8sUe1HdGfA5oXiW6yNtB0M=';
  assert.deepEqual(productionConfigProblems({ ...complete, JWT_SECRET: hex }), []);
  assert.deepEqual(productionConfigProblems({ ...complete, JWT_SECRET: b64 }), []);
});

test('a Railway domain also counts as production', () => {
  assert.equal(productionConfigProblems({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).length, 3);
});

test('assertProductionConfig exits with code 1 on a bad production config', () => {
  const codes = [];
  const err = console.error;
  console.error = () => {};
  try {
    assertProductionConfig({ NODE_ENV: 'production' }, c => codes.push(c));
    assertProductionConfig(complete, c => codes.push(c));
  } finally {
    console.error = err;
  }
  assert.deepEqual(codes, [1]);
});
