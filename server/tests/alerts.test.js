import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'alerts-test-secret-32-characters-long-ok';

const {
  vipAlerts, reviewAlerts, senderName, runAlertsForUser, runDueAlerts, startLink, completeLink, ALERTS_PER_HOUR,
} = await import('../lib/alerts.js');
const { createInMemoryAlertStore } = await import('../services/stores/alertStore.js');

const NOW   = new Date('2026-11-04T10:00:00.000Z');
const LINKED = '2026-11-04T06:00:00.000Z';
const vips  = [{ email: 'boss@acme.com' }];

// ─── Detectors ────────────────────────────────────────────────────────────────

test('mail from a VIP becomes one alert; mail from anyone else does not', () => {
  const messages = [
    { id: 'm1', from: 'Ann Boss <boss@acme.com>', subject: 'Q3 numbers', receivedAt: '2026-11-04T09:00:00.000Z' },
    { id: 'm2', from: 'someone@else.com',          subject: 'Hello',      receivedAt: '2026-11-04T09:00:00.000Z' },
  ];
  const out = vipAlerts(messages, vips, LINKED);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'mail:m1');
  assert.equal(out[0].title, 'VIP email from Ann Boss');
  assert.equal(out[0].body, 'Q3 numbers');
});

test('a sender that only contains a VIP address is not a VIP', () => {
  const messages = [
    { id: 'm1', from: 'bigboss@acme.com',        subject: 'x', receivedAt: '2026-11-04T09:00:00.000Z' },
    { id: 'm2', from: 'boss@acme.com.evil.io',   subject: 'y', receivedAt: '2026-11-04T09:00:00.000Z' },
  ];
  assert.deepEqual(vipAlerts(messages, vips, LINKED), []);
});

test('VIP mail received before the channel was linked is not alerted', () => {
  const messages = [{ id: 'old', from: 'boss@acme.com', subject: 'x', receivedAt: '2026-11-04T05:59:00.000Z' }];
  assert.deepEqual(vipAlerts(messages, vips, LINKED), []);
});

test('a missing subject is shown as "(no subject)"', () => {
  const [a] = vipAlerts([{ id: 'm', from: 'boss@acme.com', subject: '', receivedAt: '2026-11-04T09:00:00.000Z' }], vips, LINKED);
  assert.equal(a.body, '(no subject)');
});

test('senderName reads the display name, else the bare address', () => {
  assert.equal(senderName('"Smith, Ann" <ann@x.com>'), 'Smith, Ann');
  assert.equal(senderName('Ann <ann@x.com>'), 'Ann');
  assert.equal(senderName('ann@x.com'), 'ann@x.com');
});

test('a review request becomes one alert keyed by repo and number', () => {
  const prs = [
    { id: 12, repo: 'me/app', title: 'Fix login', author: 'sam', url: 'https://github.com/me/app/pull/12', updatedAt: '2026-11-04T09:00:00.000Z' },
    { id: 3,  repo: 'me/app', title: 'Old',       author: 'sam', url: 'https://github.com/me/app/pull/3',  updatedAt: '2026-10-01T00:00:00.000Z' },
  ];
  const out = reviewAlerts(prs, LINKED);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'review:me/app#12');
  assert.equal(out[0].title, 'Review requested: me/app#12');
  assert.equal(out[0].body, 'Fix login (by sam)');
  assert.equal(out[0].url, 'https://github.com/me/app/pull/12');
});

// ─── Runner ───────────────────────────────────────────────────────────────────

// Deps that use the real in-memory store and record what was delivered.
function harness({ mail = [], prs = [], github = true, google = true, vipList = vips, deliverResult = { delivered: true } } = {}) {
  const store = createInMemoryAlertStore();
  const delivered = [];
  const unlinked = [];
  const calls = { mail: 0, reviews: 0 };
  const deps = {
    getVips:      async () => vipList,
    getCreds:     async () => ({}),
    googleReady:  async () => google,
    fetchVipMail: async () => { calls.mail += 1; return mail; },
    fetchReviews: async () => { calls.reviews += 1; return prs; },
    githubReady:  () => github,
    claim:        (u, k, at) => store.claimAlert(u, k, at),
    release:      (u, k) => store.releaseAlert(u, k),
    countSince:   (u, since) => store.countSentSince(u, since),
    unlink:       async u => { unlinked.push(u); },
    deliver:      async (prefs, item) => { delivered.push(item); return typeof deliverResult === 'function' ? deliverResult(item) : deliverResult; },
  };
  return { deps, delivered, unlinked, calls, store };
}

const prefs = { userId: 1, vipEnabled: true, reviewEnabled: true, telegramChatId: '42', telegramLinkedAt: LINKED };
const vipMail = id => ({ id, from: 'boss@acme.com', subject: `s-${id}`, receivedAt: '2026-11-04T09:00:00.000Z' });
const pr = id => ({ id, repo: 'me/app', title: `PR ${id}`, author: 'sam', url: `u${id}`, updatedAt: '2026-11-04T09:00:00.000Z' });

test('a VIP email and a review request each produce one alert', async () => {
  const h = harness({ mail: [vipMail('m1')], prs: [pr(5)] });
  const out = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.equal(out.sent, 2);
  assert.deepEqual(h.delivered.map(d => d.key).sort(), ['mail:m1', 'review:me/app#5']);
});

test('the next check does not alert the same items again', async () => {
  const h = harness({ mail: [vipMail('m1')], prs: [pr(5)] });
  await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  const again = await runAlertsForUser(1, prefs, { now: new Date(NOW.getTime() + 5 * 60 * 1000), deps: h.deps });
  assert.equal(again.sent, 0);
  assert.equal(h.delivered.length, 2);
});

test('a new item on a later check is alerted, the old one is not', async () => {
  const h = harness({ mail: [vipMail('m1')] });
  await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  const h2 = { ...h, deps: { ...h.deps, fetchVipMail: async () => [vipMail('m1'), vipMail('m2')] } };
  const out = await runAlertsForUser(1, prefs, { now: NOW, deps: h2.deps });
  assert.equal(out.sent, 1);
  assert.equal(h.delivered.at(-1).key, 'mail:m2');
});

test('at most ALERTS_PER_HOUR alerts go out in an hour; the rest wait and go out later', async () => {
  const mail = Array.from({ length: ALERTS_PER_HOUR + 3 }, (_, i) => vipMail(`m${i}`));
  const h = harness({ mail });
  const first = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.equal(first.sent, ALERTS_PER_HOUR);
  assert.equal(first.held, 3);

  const sameHour = await runAlertsForUser(1, prefs, { now: new Date(NOW.getTime() + 10 * 60 * 1000), deps: h.deps });
  assert.equal(sameHour.sent, 0, 'still inside the hour');

  const nextHour = await runAlertsForUser(1, prefs, { now: new Date(NOW.getTime() + 61 * 60 * 1000), deps: h.deps });
  assert.equal(nextHour.sent, 3, 'the held ones go out once the hour has passed');
  assert.equal(h.delivered.length, ALERTS_PER_HOUR + 3);
});

test('the rate limit is per user: a busy inbox for one does not hold back another', async () => {
  const mail = Array.from({ length: ALERTS_PER_HOUR + 2 }, (_, i) => vipMail(`m${i}`));
  const h = harness({ mail });
  await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  const other = await runAlertsForUser(2, { ...prefs, userId: 2 }, { now: NOW, deps: h.deps });
  assert.equal(other.sent, ALERTS_PER_HOUR);
});

test('a failed send gives the item back so the next check tries again', async () => {
  let fail = true;
  const h = harness({ mail: [vipMail('m1')], deliverResult: () => (fail ? { delivered: false, reason: 'failed', gone: false, error: 'Telegram 500' } : { delivered: true }) });
  const first = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.equal(first.sent, 0);
  fail = false;
  const second = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.equal(second.sent, 1);
});

test('a chat that cannot be reached is unlinked and nothing more is sent to it', async () => {
  const h = harness({ mail: [vipMail('m1'), vipMail('m2')], deliverResult: { delivered: false, reason: 'failed', gone: true, error: 'Telegram 403' } });
  await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.deepEqual(h.unlinked, [1]);
  assert.equal(h.delivered.length, 1, 'stopped after the first failure');
});

test('switched-off alerts are not even fetched', async () => {
  const h = harness({ mail: [vipMail('m1')], prs: [pr(5)] });
  await runAlertsForUser(1, { ...prefs, vipEnabled: false, reviewEnabled: false }, { now: NOW, deps: h.deps });
  assert.deepEqual(h.calls, { mail: 0, reviews: 0 });
  assert.equal(h.delivered.length, 0);
});

test('a user with no VIPs makes no Gmail call, and one without GitHub makes no GitHub call', async () => {
  const h = harness({ vipList: [], github: false, mail: [vipMail('m1')], prs: [pr(5)] });
  const out = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.deepEqual(h.calls, { mail: 0, reviews: 0 });
  assert.equal(out.sent, 0);
});

test('a user with VIPs but no Google account makes no Gmail call and logs no error', async () => {
  const h = harness({ google: false, mail: [vipMail('m1')], prs: [pr(5)] });
  const out = await runAlertsForUser(1, prefs, { now: NOW, deps: h.deps });
  assert.equal(h.calls.mail, 0);
  assert.equal(out.sent, 1, 'the review request still goes out');
});

test('one detector failing does not stop the other', async () => {
  const h = harness({ prs: [pr(5)] });
  const deps = { ...h.deps, fetchVipMail: async () => { throw new Error('Gmail down'); } };
  const out = await runAlertsForUser(1, prefs, { now: NOW, deps });
  assert.equal(out.sent, 1);
  assert.equal(h.delivered[0].key, 'review:me/app#5');
});

// ─── Who gets checked ─────────────────────────────────────────────────────────

test('only linked, active users are checked; a user with no channel gets nothing and no error', async () => {
  const checked = [];
  const deps = {
    listLinked: async () => [{ userId: 2 }, { userId: 3 }],     // user 1 has no linked channel, so is not listed
    listUsers:  async () => [{ id: 1 }, { id: 2 }, { id: 3, isActive: false }],
    prune:      async () => 0,
    runUser:    async userId => { checked.push(userId); },
  };
  assert.deepEqual(await runDueAlerts({ now: NOW, deps }), [2]);
  assert.deepEqual(checked, [2]);
});

test('one user failing does not stop the rest', async () => {
  const checked = [];
  const deps = {
    listLinked: async () => [{ userId: 1 }, { userId: 2 }],
    listUsers:  async () => [{ id: 1 }, { id: 2 }],
    prune:      async () => 0,
    runUser:    async userId => { if (userId === 1) throw new Error('boom'); checked.push(userId); },
  };
  await runDueAlerts({ now: NOW, deps });
  assert.deepEqual(checked, [2]);
});

test('old sent records are pruned after 30 days', async () => {
  let cutoff;
  await runDueAlerts({ now: NOW, deps: { listLinked: async () => [], listUsers: async () => [], prune: async c => { cutoff = c; return 0; }, runUser: async () => {} } });
  assert.equal(cutoff, '2026-10-05T10:00:00.000Z');
});

// ─── Linking ──────────────────────────────────────────────────────────────────

function linkHarness() {
  const store = createInMemoryAlertStore();
  return {
    store,
    deps: {
      createToken:  (u, h, exp) => store.createLinkToken(u, h, exp),
      consumeToken: (h, now) => store.consumeLinkToken(h, now),
      link:         (u, chat, at) => store.linkTelegram(u, chat, at),
    },
  };
}

test('a link code ties the chat that sends it to the user who asked for it', async () => {
  const { store, deps } = linkHarness();
  const code = await startLink(7, { now: NOW, deps });
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await completeLink({ chatId: '555', code }, { now: new Date(NOW.getTime() + 60_000), deps }), 7);
  assert.equal((await store.getPrefs(7)).telegramChatId, '555');
});

test('a link code cannot be used twice', async () => {
  const { deps } = linkHarness();
  const code = await startLink(7, { now: NOW, deps });
  await completeLink({ chatId: '555', code }, { now: NOW, deps });
  assert.equal(await completeLink({ chatId: '666', code }, { now: NOW, deps }), null);
});

test('a link code expires after 15 minutes', async () => {
  const { store, deps } = linkHarness();
  const code = await startLink(7, { now: NOW, deps });
  assert.equal(await completeLink({ chatId: '555', code }, { now: new Date(NOW.getTime() + 16 * 60 * 1000), deps }), null);
  assert.equal(await store.getPrefs(7), null, 'nothing was linked');
});

test('a made-up code links nothing', async () => {
  const { store, deps } = linkHarness();
  assert.equal(await completeLink({ chatId: '555', code: 'x'.repeat(43) }, { now: NOW, deps }), null);
  assert.equal(await store.getPrefs(1), null);
});
