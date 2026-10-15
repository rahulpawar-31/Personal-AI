import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigProblems, hostingProblems, assertProductionConfig } from '../lib/startupConfig.js';

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

test('Render without NODE_ENV=production is flagged, since every production check would be skipped', () => {
  assert.equal(hostingProblems({ RENDER: 'true' }).length, 1);
  assert.match(hostingProblems({ RENDER: 'true', NODE_ENV: 'development' })[0], /NODE_ENV must be "production" on Render/);
  assert.deepEqual(hostingProblems({ RENDER: 'true', NODE_ENV: 'production' }), []);
});

test('a developer machine or another host is not flagged', () => {
  assert.deepEqual(hostingProblems({}), []);
  assert.deepEqual(hostingProblems({ NODE_ENV: 'test' }), []);
  // A Render URL copied into a local .env is not the platform marker.
  assert.deepEqual(hostingProblems({ RENDER_EXTERNAL_URL: 'https://api.onrender.com' }), []);
});

test('assertProductionConfig refuses to start on Render without NODE_ENV=production', () => {
  const codes = [];
  const err = console.error;
  const lines = [];
  console.error = msg => lines.push(msg);
  try {
    assertProductionConfig({ RENDER: 'true' }, c => codes.push(c));
    assertProductionConfig({ RENDER: 'true', ...complete }, c => codes.push(c));
  } finally {
    console.error = err;
  }
  assert.deepEqual(codes, [1], 'only the run missing NODE_ENV exits; a complete production config does not');
  assert.ok(lines.some(l => /NODE_ENV must be "production" on Render/.test(l)));
});
