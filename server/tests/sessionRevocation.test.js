import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'session-revocation-test-secret-32-chars-long';

const users = await import('../services/users.js');
const { createInMemoryUserStore } = await import('../services/stores/userStore.js');
const { revokeGoogleTokens, readGoogleTokens } = await import('../services/auth.js');
const { default: jwt } = await import('jsonwebtoken');

test('the user store counts up per account and reports it on lookup', async () => {
  const store = createInMemoryUserStore();
  const a = await store.createUser({ username: 'ada', email: null, passwordHash: 'x' });
  const b = await store.createUser({ username: 'bob', email: null, passwordHash: 'x' });
  assert.equal((await store.findById(a.id)).tokenVersion, 0);
  assert.equal(await store.bumpTokenVersion(a.id), 1);
  assert.equal(await store.bumpTokenVersion(a.id), 2);
  assert.equal((await store.findById(a.id)).tokenVersion, 2);
  assert.equal((await store.findById(b.id)).tokenVersion, 0, 'another account is untouched');
  assert.equal(await store.bumpTokenVersion(999), null, 'unknown user');
});

test('a refresh token works until the account number moves past it', () => {
  const account = { id: 7, username: 'ada', tokenVersion: 0 };
  const token = users.verifyToken(users.signRefreshToken(account));
  assert.equal(token.tv, 0);
  assert.equal(users.refreshTokenIsCurrent(token, account), true);
  assert.equal(users.refreshTokenIsCurrent(token, { ...account, tokenVersion: 1 }), false);
  const newer = users.verifyToken(users.signRefreshToken({ ...account, tokenVersion: 1 }));
  assert.equal(users.refreshTokenIsCurrent(newer, { ...account, tokenVersion: 1 }), true);
});

test('a refresh token from before the number existed still works for an account at 0 only', () => {
  const legacy = jwt.verify(jwt.sign({ userId: 7, username: 'ada', type: 'refresh' }, process.env.JWT_SECRET), process.env.JWT_SECRET);
  assert.equal(users.refreshTokenIsCurrent(legacy, { tokenVersion: 0 }), true);
  assert.equal(users.refreshTokenIsCurrent(legacy, {}), true, 'account row without the field counts as 0');
  assert.equal(users.refreshTokenIsCurrent(legacy, { tokenVersion: 1 }), false);
});

test('tokenVersionOf reads Postgres and JSON-file rows, and treats a missing value as 0', () => {
  assert.equal(users.tokenVersionOf({ token_version: 3 }), 3);
  assert.equal(users.tokenVersionOf({ tokenVersion: 2 }), 2);
  assert.equal(users.tokenVersionOf({ token_version: '4' }), 4);
  assert.equal(users.tokenVersionOf({}), 0);
  assert.equal(users.tokenVersionOf(null), 0);
});

test('logout identifies the user from an expired access token, but not from a refresh token or a forged one', () => {
  const secret = process.env.JWT_SECRET;
  const expired = jwt.sign({ userId: 7, username: 'ada', type: 'access' }, secret, { expiresIn: -60 });
  assert.equal(users.identifyForLogout(expired), 7);
  assert.equal(users.identifyForLogout(users.signToken({ id: 9, username: 'bob' })), 9);
  assert.equal(users.identifyForLogout(users.signRefreshToken({ id: 7, username: 'ada' })), null);
  assert.equal(users.identifyForLogout(jwt.sign({ userId: 7, type: 'access' }, 'another-secret-entirely-32-characters!!')), null);
  assert.equal(users.identifyForLogout('not.a.token'), null);
  assert.equal(users.identifyForLogout(''), null);
});

test('revoking at Google sends the refresh token, falls back to the access token, and never throws', async () => {
  const sent = [];
  const ok = { revokeToken: async t => { sent.push(t); } };
  assert.equal(await revokeGoogleTokens({ refresh_token: 'r1', access_token: 'a1' }, { client: ok }), true);
  assert.equal(await revokeGoogleTokens({ access_token: 'a2' }, { client: ok }), true);
  assert.deepEqual(sent, ['r1', 'a2']);

  assert.equal(await revokeGoogleTokens(null, { client: ok }), false, 'nothing held');
  assert.equal(await revokeGoogleTokens({}, { client: ok }), false);

  const refuses = { revokeToken: async () => { throw new Error('invalid_token'); } };
  assert.equal(await revokeGoogleTokens({ refresh_token: 'r' }, { client: refuses }), false);

  const hangs = { revokeToken: () => new Promise(() => {}) };
  const started = Date.now();
  assert.equal(await revokeGoogleTokens({ refresh_token: 'r' }, { client: hangs, timeoutMs: 50 }), false);
  assert.ok(Date.now() - started < 1000, 'gives up after the timeout');
});

test('a password change ends the other sessions before the new password is saved', async () => {
  const order = [];
  const deps = {
    endSessions: async () => { order.push('sessions'); return 5; },
    saveHash:    async () => { order.push('hash'); },
  };
  assert.equal(await users.applyPasswordChange(7, 'hash', deps), 5);
  assert.deepEqual(order, ['sessions', 'hash']);
});

test('if ending the sessions fails, the password is not saved and the error reaches the caller', async () => {
  let saved = false;
  const deps = {
    endSessions: async () => { throw new Error('db down'); },
    saveHash:    async () => { saved = true; },
  };
  await assert.rejects(() => users.applyPasswordChange(7, 'hash', deps), /db down/);
  assert.equal(saved, false);
});

test('an account row without a number still yields 0 from a password change', async () => {
  const deps = { endSessions: async () => null, saveHash: async () => {} };
  assert.equal(await users.applyPasswordChange(7, 'hash', deps), 0);
});

test('a corrupt local token file falls back to the stored copy, so the Google grant is still revoked', async () => {
  const stored = { refresh_token: 'r-from-db' };
  const corrupt = () => { throw new SyntaxError('Unexpected token } in JSON'); };
  assert.deepEqual(await readGoogleTokens(7, { readLocal: corrupt, readStored: async () => stored }), stored);
});

test('the local token file is preferred when it is readable, and nothing held gives null', async () => {
  const local = { refresh_token: 'r-local' };
  let askedStore = false;
  const out = await readGoogleTokens(7, { readLocal: () => local, readStored: async () => { askedStore = true; return null; } });
  assert.deepEqual(out, local);
  assert.equal(askedStore, false);
  assert.equal(await readGoogleTokens(7, { readLocal: () => null, readStored: async () => null }), null);
  assert.equal(await readGoogleTokens(7, { readLocal: corruptFile, readStored: async () => { throw new Error('db down'); } }), null);
});

function corruptFile() { throw new Error('unreadable'); }
