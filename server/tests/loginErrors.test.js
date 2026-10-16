import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'login-errors-test-secret-at-least-32-chars';

const { LoginError, loginFailureStatus, loginUser } = await import('../services/users.js');

test('a credential failure is a 401 and anything else is a 503', () => {
  assert.equal(loginFailureStatus(new LoginError('Invalid username or password')), 401);
  assert.equal(loginFailureStatus(new Error('connection terminated unexpectedly')), 503);
  assert.equal(loginFailureStatus(Object.assign(new Error('x'), { code: '57P01' })), 503);
  assert.equal(loginFailureStatus(undefined), 503);
});

test('LoginError is an Error with its own name', () => {
  const e = new LoginError('nope');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'LoginError');
  assert.equal(e.message, 'nope');
});

test('missing credentials are a LoginError, decided before any database access', async () => {
  await assert.rejects(() => loginUser('', ''), err => err instanceof LoginError && /required/.test(err.message));
  await assert.rejects(() => loginUser('ada', ''), LoginError);
  await assert.rejects(() => loginUser(undefined, 'pw'), LoginError);
});
