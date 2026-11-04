import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.JWT_SECRET = 'alert-routes-test-secret-32-characters-ok';

const { default: alertsRoutes } = await import('../routes/alerts.js');
const { signToken } = await import('../services/users.js');

// Only the paths that never reach the database are exercised here (auth, the
// webhook secret, request validation), so the test writes no state files.

let server, base;
const saved = {};
const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'];

before(async () => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  const app = express();
  app.use(express.json());
  app.use(alertsRoutes);
  server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const auth = { Authorization: `Bearer ${signToken({ id: 1, username: 'u', tokenVersion: 0 })}` };
const json = { 'Content-Type': 'application/json' };
const send = (method, path, { headers = {}, body } = {}) =>
  fetch(base + path, { method, headers: { ...json, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('every user-facing alert route needs a signed-in user', async () => {
  for (const [method, path] of [
    ['GET', '/api/alerts/settings'], ['PUT', '/api/alerts/settings'], ['POST', '/api/alerts/vips'],
    ['DELETE', '/api/alerts/vips'], ['POST', '/api/alerts/telegram/link'], ['DELETE', '/api/alerts/telegram'],
  ]) {
    assert.equal((await send(method, path, { body: method === 'GET' ? undefined : {} })).status, 401, `${method} ${path}`);
  }
});

test('the Telegram webhook refuses a call without the right secret', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  const update = { message: { text: `/start ${'A'.repeat(43)}`, chat: { id: 5, type: 'private' } } };
  assert.equal((await send('POST', '/api/telegram/webhook', { body: update })).status, 401);
  assert.equal((await send('POST', '/api/telegram/webhook', { body: update, headers: { 'x-telegram-bot-api-secret-token': 'wrong' } })).status, 401);
});

test('the Telegram webhook refuses everything when no secret is configured', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal((await send('POST', '/api/telegram/webhook', { body: {}, headers: { 'x-telegram-bot-api-secret-token': '' } })).status, 401);
});

test('with the right secret the webhook answers 200 and ignores messages that are not a link request', async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  const headers = { 'x-telegram-bot-api-secret-token': 'hook-secret' };
  for (const body of [{}, { message: { text: 'hello', chat: { id: 5, type: 'private' } } }, { message: { text: `/start ${'A'.repeat(43)}`, chat: { id: 5, type: 'group' } } }]) {
    assert.equal((await send('POST', '/api/telegram/webhook', { body, headers })).status, 200);
  }
});

test('linking Telegram says so plainly when the server has no bot configured', async () => {
  const r = await send('POST', '/api/alerts/telegram/link', { headers: auth });
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /not set up/);
});

test('settings reject a switch that is not true or false', async () => {
  const r = await send('PUT', '/api/alerts/settings', { headers: auth, body: { vipEnabled: 'yes' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /on or off/);
});

test('adding or removing a VIP rejects anything that is not one plain address', async () => {
  for (const method of ['POST', 'DELETE']) {
    for (const email of ['', 'nope', 'Ann <ann@x.co>']) {
      const r = await send(method, '/api/alerts/vips', { headers: auth, body: { email } });
      assert.equal(r.status, 400, `${method} ${email}`);
    }
  }
});
