import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAlertStore } from '../services/stores/alertStore.js';

// The in-memory adapter runs the same core as the JSON-file adapter. The
// Postgres adapter's SQL is not exercised here (no database in tests).

const T0 = '2026-11-04T10:00:00.000Z';

test('an item is claimed once; a second claim for the same user and item is refused', async () => {
  const store = createInMemoryAlertStore();
  assert.equal(await store.claimAlert(1, 'mail:a', T0), true);
  assert.equal(await store.claimAlert(1, 'mail:a', T0), false);
});

test('the same item key for another user is a separate claim', async () => {
  const store = createInMemoryAlertStore();
  assert.equal(await store.claimAlert(1, 'mail:a', T0), true);
  assert.equal(await store.claimAlert(2, 'mail:a', T0), true);
});

test('a released item can be claimed again', async () => {
  const store = createInMemoryAlertStore();
  await store.claimAlert(1, 'mail:a', T0);
  await store.releaseAlert(1, 'mail:a');
  assert.equal(await store.claimAlert(1, 'mail:a', T0), true);
});

test('countSentSince counts only that user\'s alerts at or after the cutoff', async () => {
  const store = createInMemoryAlertStore();
  await store.claimAlert(1, 'old', '2026-11-04T08:00:00.000Z');
  await store.claimAlert(1, 'new1', '2026-11-04T09:30:00.000Z');
  await store.claimAlert(1, 'new2', '2026-11-04T09:45:00.000Z');
  await store.claimAlert(2, 'other', '2026-11-04T09:45:00.000Z');
  assert.equal(await store.countSentSince(1, '2026-11-04T09:00:00.000Z'), 2);
});

test('pruneSentBefore drops old records and keeps recent ones', async () => {
  const store = createInMemoryAlertStore();
  await store.claimAlert(1, 'old', '2026-09-01T00:00:00.000Z');
  await store.claimAlert(1, 'new', T0);
  assert.equal(await store.pruneSentBefore('2026-10-01T00:00:00.000Z'), 1);
  assert.equal(await store.claimAlert(1, 'old', T0), true, 'a pruned item is forgotten');
  assert.equal(await store.claimAlert(1, 'new', T0), false);
});

test('a user with no saved alert settings has none stored', async () => {
  assert.equal(await createInMemoryAlertStore().getPrefs(1), null);
});

test('switches default to on, and saving one leaves the other and the link alone', async () => {
  const store = createInMemoryAlertStore();
  await store.linkTelegram(1, 42, T0);
  const saved = await store.savePrefs(1, { vipEnabled: false });
  assert.equal(saved.vipEnabled, false);
  assert.equal(saved.reviewEnabled, true);
  assert.equal(saved.telegramChatId, '42');
});

test('savePrefs ignores anything that is not a switch, so it cannot set a chat id', async () => {
  const store = createInMemoryAlertStore();
  const saved = await store.savePrefs(1, { telegramChatId: '999', vipEnabled: 'yes' });
  assert.equal(saved.telegramChatId, null);
  assert.equal(saved.vipEnabled, true);
});

test('listLinked returns only users with a chat and at least one alert on', async () => {
  const store = createInMemoryAlertStore();
  await store.savePrefs(1, {});                       // no chat
  await store.linkTelegram(2, 20, T0);                // linked, both on
  await store.linkTelegram(3, 30, T0);
  await store.savePrefs(3, { vipEnabled: false, reviewEnabled: false }); // linked, both off
  assert.deepEqual((await store.listLinked()).map(p => p.userId), [2]);
});

test('unlinking removes the chat and takes the user out of listLinked', async () => {
  const store = createInMemoryAlertStore();
  await store.linkTelegram(1, 42, T0);
  await store.unlinkTelegram(1);
  assert.equal((await store.getPrefs(1)).telegramChatId, null);
  assert.deepEqual(await store.listLinked(), []);
});

test('a link code works once, for the user it was made for', async () => {
  const store = createInMemoryAlertStore();
  await store.createLinkToken(7, 'hash-a', '2999-01-01T00:00:00.000Z');
  assert.equal(await store.consumeLinkToken('hash-a', T0), 7);
  assert.equal(await store.consumeLinkToken('hash-a', T0), null, 'second use');
});

test('an expired link code is refused, and an unknown one too', async () => {
  const store = createInMemoryAlertStore();
  await store.createLinkToken(7, 'hash-a', '2026-11-04T09:00:00.000Z');
  assert.equal(await store.consumeLinkToken('hash-a', T0), null);
  assert.equal(await store.consumeLinkToken('nope', T0), null);
});

test('asking for a new link code replaces the user\'s earlier one', async () => {
  const store = createInMemoryAlertStore();
  await store.createLinkToken(7, 'old', '2999-01-01T00:00:00.000Z');
  await store.createLinkToken(7, 'new', '2999-01-01T00:00:00.000Z');
  assert.equal(await store.consumeLinkToken('old', T0), null);
  assert.equal(await store.consumeLinkToken('new', T0), 7);
});
