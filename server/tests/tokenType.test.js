import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'token-type-test-secret-at-least-32-chars';

const users = await import('../services/users.js');
const { requireAuth } = await import('../middleware/auth.js');

const user = { id: 7, username: 'ada' };

function run(token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const out = { status: null, next: false };
  const res = { status(c) { out.status = c; return this; }, json() { return this; } };
  requireAuth(req, res, () => { out.next = true; });
  return { ...out, user: req.user };
}

test('signToken issues an access token', () => {
  assert.equal(users.verifyToken(users.signToken(user)).type, 'access');
});

test('requireAuth accepts an access token', () => {
  const r = run(users.signToken(user));
  assert.equal(r.next, true);
  assert.equal(r.user.userId, 7);
});

test('requireAuth rejects a refresh token sent as a bearer token', () => {
  const r = run(users.signRefreshToken(user));
  assert.equal(r.next, false);
  assert.equal(r.status, 401);
});

test('requireAuth still accepts an older access token with no type claim', async () => {
  const { default: jwt } = await import('jsonwebtoken');
  const legacy = jwt.sign({ userId: 7, username: 'ada' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  assert.equal(run(legacy).next, true);
});

test('requireAuth rejects a missing or garbage token', () => {
  assert.equal(run(null).status, 401);
  assert.equal(run('not-a-jwt').status, 401);
});
