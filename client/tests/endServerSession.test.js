import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endServerSession } from '../src/endServerSession.js';

const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

function run(request, hadToken = true) {
  let warned = 0;
  return endServerSession(request, { hadToken, warn: () => { warned += 1; } }).then(() => warned);
}

test('a confirmed sign-out gives no warning', async () => {
  assert.equal(await run(reply(200, { ok: true, revoked: true })), 0);
});

test('the server saying it could not end the sessions gives a warning', async () => {
  assert.equal(await run(reply(200, { ok: true, revoked: false })), 1);
});

test('an error status warns', async () => {
  assert.equal(await run(reply(429, { error: 'Too many sign-out requests' })), 1);
  assert.equal(await run(reply(500, null)), 1);
});

test('a network failure warns', async () => {
  assert.equal(await run(async () => { throw new TypeError('Failed to fetch'); }), 1);
});

test('an unreadable body on a successful response is not treated as success', async () => {
  const noJson = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  assert.equal(await run(noJson), 0, 'a 200 with no readable body is not a failure to revoke');
});

test('with no token there was nothing to end, so the request is not even made and nothing warns', async () => {
  let called = false;
  const warned = await run(async () => { called = true; return reply(200, { revoked: false })(); }, false);
  assert.equal(called, false);
  assert.equal(warned, 0);
});

test('the request is made before the function yields, so the token can be cleared right after', () => {
  let called = false;
  endServerSession(async () => { called = true; return reply(200, { revoked: true })(); }, { hadToken: true, warn() {} });
  assert.equal(called, true, 'request() ran synchronously');
});
