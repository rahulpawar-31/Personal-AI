import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGoogleConnect, googleConnectInitPath, GOOGLE_CONNECT_MESSAGES } from '../src/googleConnect.js';

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const URL_OK = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';

test('all connect entry points carry the browser origin and only Settings adds its return marker', () => {
  for (const fromSettings of [false, true]) {
    const url = new URL(googleConnectInitPath('https://app.example.com', { fromSettings }), 'https://app.example.com');
    assert.equal(url.pathname, '/api/auth/google/init');
    assert.equal(url.searchParams.get('origin'), 'https://app.example.com');
    assert.equal(url.searchParams.get('from'), fromSettings ? 'settings' : null);
  }
});

test('a good answer returns the consent URL to go to', async () => {
  assert.deepEqual(await startGoogleConnect(reply(200, { url: URL_OK })), { url: URL_OK });
});

test('401 says the session expired', async () => {
  const out = await startGoogleConnect(reply(401, { error: 'jwt expired' }));
  assert.equal(out.error, 'session');
  assert.equal(out.message, GOOGLE_CONNECT_MESSAGES.session);
});

test('a 503 with a JSON error is an error the user can retry, worded by us, not by the server', async () => {
  const out = await startGoogleConnect(reply(503, { error: 'ECONNREFUSED 10.0.0.5:5432 password=hunter2' }));
  assert.equal(out.error, 'server');
  assert.doesNotMatch(out.message, /ECONNREFUSED|10\.0\.0\.5|hunter2/);
  assert.match(out.message, /try again/i);
});

test('a network failure is an error, not silence', async () => {
  const out = await startGoogleConnect(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(out.error, 'network');
  assert.match(out.message, /connection/i);
});

test('an unreadable body is an error', async () => {
  const notJson = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  assert.equal((await startGoogleConnect(notJson)).error, 'response');
});

test('a reply with no usable URL is an error', async () => {
  for (const body of [{}, null, { url: '' }, { url: 42 }, { url: 'javascript:alert(1)' }, { url: 'http://plain.example/x' }, { url: '/relative' }]) {
    assert.equal((await startGoogleConnect(reply(200, body))).error, 'response', JSON.stringify(body));
  }
});

test('every error comes with a message to show, and trying again is just calling it again', async () => {
  for (const out of [
    await startGoogleConnect(reply(401, {})), await startGoogleConnect(reply(500, {})),
    await startGoogleConnect(async () => { throw new Error('x'); }), await startGoogleConnect(reply(200, {})),
  ]) assert.ok(out.message && out.message.length > 10);
  assert.deepEqual(await startGoogleConnect(reply(200, { url: URL_OK })), { url: URL_OK }, 'works after earlier failures');
});
