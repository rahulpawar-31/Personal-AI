import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSession } from '../src/sessionCheck.js';

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a good answer is an ok session with the user', async () => {
  const user = { id: 1, username: 'rahul' };
  assert.deepEqual(await checkSession(reply(200, user)), { status: 'ok', user });
});

test('401 is an invalid session: the normal signed-out flow', async () => {
  assert.deepEqual(await checkSession(reply(401, { error: 'expired' })), { status: 'invalid' });
});

test('502, 503, 500 and other failures are unavailable, not invalid (#423)', async () => {
  for (const status of [500, 502, 503, 504, 429, 403, 404]) {
    assert.deepEqual(await checkSession(reply(status, {})), { status: 'unavailable' }, String(status));
  }
});

test('a network failure is unavailable', async () => {
  assert.deepEqual(await checkSession(async () => { throw new TypeError('Failed to fetch'); }), { status: 'unavailable' });
});

test('a 200 whose body is not a user, or not JSON, is unavailable', async () => {
  assert.deepEqual(await checkSession(reply(200, null)), { status: 'unavailable' });
  assert.deepEqual(await checkSession(reply(200, 'oops')), { status: 'unavailable' });
  const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  assert.deepEqual(await checkSession(notJson), { status: 'unavailable' });
});

test('a request that never answers ends as unavailable instead of hanging', async () => {
  const started = Date.now();
  assert.deepEqual(await checkSession(() => new Promise(() => {}), { timeoutMs: 30 }), { status: 'unavailable' });
  assert.ok(Date.now() - started < 2000);
});

test('an answer that arrives in time is not replaced by the timeout', async () => {
  const slow = () => new Promise(r => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ id: 2 }) }), 10));
  assert.deepEqual(await checkSession(slow, { timeoutMs: 500 }), { status: 'ok', user: { id: 2 } });
});
