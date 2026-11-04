import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'telegram-test-secret-32-characters-long-ok';

const telegram = (await import('../services/telegram.js')).default;
const { deliver } = await import('../services/notifier.js');
const { validateAlertSettings, validateVipEmail } = await import('../lib/alertSettings.js');

const saved = {};
const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET'];
beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function configure() {
  process.env.TELEGRAM_BOT_TOKEN = '123:secret-token';
  process.env.TELEGRAM_BOT_USERNAME = 'dayhand_bot';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
}

// ─── Webhook input ────────────────────────────────────────────────────────────

const code = 'A'.repeat(43);
const startMsg = (text, type = 'private') => ({ message: { text, chat: { id: 99, type } } });

test('"/start <code>" in a private chat gives the chat and the code', () => {
  assert.deepEqual(telegram.parseStartCommand(startMsg(`/start ${code}`)), { chatId: '99', code });
});

test('the same message in a group or channel is ignored', () => {
  assert.equal(telegram.parseStartCommand(startMsg(`/start ${code}`, 'group')), null);
  assert.equal(telegram.parseStartCommand(startMsg(`/start ${code}`, 'supergroup')), null);
  assert.equal(telegram.parseStartCommand(startMsg(`/start ${code}`, 'channel')), null);
});

test('other messages are ignored', () => {
  assert.equal(telegram.parseStartCommand(startMsg('/start')), null);
  assert.equal(telegram.parseStartCommand(startMsg('hello')), null);
  assert.equal(telegram.parseStartCommand(startMsg('/start short')), null);
  assert.equal(telegram.parseStartCommand({}), null);
  assert.equal(telegram.parseStartCommand(null), null);
});

test('the webhook secret must match exactly', () => {
  configure();
  assert.equal(telegram.webhookSecretMatches('hook-secret'), true);
  assert.equal(telegram.webhookSecretMatches('hook-secreT'), false);
  assert.equal(telegram.webhookSecretMatches('hook'), false);
  assert.equal(telegram.webhookSecretMatches(undefined), false);
});

test('with no secret configured nothing matches, not even an empty header', () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  assert.equal(telegram.webhookSecretMatches(''), false);
  assert.equal(telegram.webhookSecretMatches('anything'), false);
});

test('Telegram is available only when the token, bot name and secret are all set', () => {
  configure();
  assert.equal(telegram.isConfigured(), true);
  delete process.env.TELEGRAM_BOT_USERNAME;
  assert.equal(telegram.isConfigured(), false);
});

test('the deep link carries the code to the bot', () => {
  configure();
  assert.equal(telegram.deepLink(code), `https://t.me/dayhand_bot?start=${code}`);
});

test('a blocked bot or a missing chat counts as gone; a message error does not', () => {
  assert.equal(telegram.isChatGone(403, 'Forbidden: bot was blocked by the user'), true);
  assert.equal(telegram.isChatGone(400, 'Bad Request: chat not found'), true);
  assert.equal(telegram.isChatGone(400, "Bad Request: can't parse entities"), false);
  assert.equal(telegram.isChatGone(500, ''), false);
});

test('message text is HTML-escaped', () => {
  assert.equal(telegram.escapeHtml('a <b>&</b>'), 'a &lt;b&gt;&amp;&lt;/b&gt;');
});

// ─── Notifier ─────────────────────────────────────────────────────────────────

test('a user with no linked channel gets nothing and no error', async () => {
  configure();
  const sends = [];
  const channels = [{ name: 't', linked: p => Boolean(p.telegramChatId), send: async () => { sends.push(1); return { ok: true }; } }];
  assert.deepEqual(await deliver({ telegramChatId: null }, { title: 'x' }, channels), { delivered: false, reason: 'no-channel' });
  assert.equal(sends.length, 0);
});

test('a linked channel receives the alert', async () => {
  const sent = [];
  const channels = [{ name: 't', linked: () => true, send: async (p, a) => { sent.push(a.title); return { ok: true }; } }];
  assert.deepEqual(await deliver({}, { title: 'Hi' }, channels), { delivered: true, channel: 't' });
  assert.deepEqual(sent, ['Hi']);
});

test('a failed send says whether the destination is gone', async () => {
  const channels = [{ name: 't', linked: () => true, send: async () => ({ ok: false, gone: true, error: 'Telegram 403' }) }];
  assert.deepEqual(await deliver({}, { title: 'x' }, channels), { delivered: false, reason: 'failed', gone: true, error: 'Telegram 403' });
});

test('a second channel is used when the first is not linked, with no change to the caller', async () => {
  const channels = [
    { name: 'a', linked: () => false, send: async () => ({ ok: true }) },
    { name: 'b', linked: () => true,  send: async () => ({ ok: true }) },
  ];
  assert.equal((await deliver({}, { title: 'x' }, channels)).channel, 'b');
});

test('the Telegram channel escapes the alert and sends it to the linked chat', async () => {
  configure();
  const realFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, init) => { call = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200 }; };
  try {
    const out = await deliver({ telegramChatId: '42' }, { title: 'VIP <Ann>', body: 'Re: A & B', url: 'https://x.test/?a=1&b=2' });
    assert.equal(out.delivered, true);
    assert.equal(call.body.chat_id, '42');
    assert.equal(call.body.parse_mode, 'HTML');
    assert.equal(call.body.text, '<b>VIP &lt;Ann&gt;</b>\nRe: A &amp; B\nhttps://x.test/?a=1&amp;b=2');
  } finally { globalThis.fetch = realFetch; }
});

test('a Telegram failure never leaks the bot token', async () => {
  configure();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { throw new Error(`connect failed for ${url}`); };
  try {
    const out = await deliver({ telegramChatId: '42' }, { title: 'x' });
    assert.equal(out.delivered, false);
    assert.ok(!JSON.stringify(out).includes('secret-token'));
  } finally { globalThis.fetch = realFetch; }
});

// ─── Settings requests ────────────────────────────────────────────────────────

test('alert settings accept the two switches and nothing else', () => {
  assert.deepEqual(validateAlertSettings({ vipEnabled: false, reviewEnabled: true, telegramChatId: '1' }), { vipEnabled: false, reviewEnabled: true });
  assert.deepEqual(validateAlertSettings({}), {});
  assert.throws(() => validateAlertSettings({ vipEnabled: 'yes' }), /VIP email alerts must be on or off/);
});

test('a VIP must be one plain address; it is lowercased and trimmed', () => {
  assert.equal(validateVipEmail('  Boss@Acme.com '), 'boss@acme.com');
  for (const bad of ['', 'no-at-sign', 'a@b', 'Ann <a@b.co>', 'a@b.co, c@d.co', 'a b@c.co', 42, null]) {
    assert.throws(() => validateVipEmail(bad), /Enter one email address/, String(bad));
  }
});
