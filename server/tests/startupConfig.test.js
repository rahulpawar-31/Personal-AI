import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigProblems, assertProductionConfig } from '../lib/startupConfig.js';

const complete = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(32),
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
