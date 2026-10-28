import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryBriefStore } from '../services/stores/briefStore.js';

// The in-memory adapter runs the same core as the JSON-file adapter. The
// Postgres adapter's SQL is not exercised here (no database in tests).

test('a user with nothing saved has no prefs row', async () => {
  const store = createInMemoryBriefStore();
  assert.equal(await store.getPrefs(1), null);
  assert.deepEqual(await store.listPrefs(), []);
});

test('savePrefs merges over defaults, then over what was saved', async () => {
  const store = createInMemoryBriefStore();
  const first = await store.savePrefs(1, { timezone: 'Asia/Kolkata' });
  assert.deepEqual(
    { enabled: first.enabled, time: first.time, timezone: first.timezone, channel: first.channel },
    { enabled: true, time: '09:00', timezone: 'Asia/Kolkata', channel: 'slack' }
  );
  const second = await store.savePrefs(1, { time: '07:30', channel: 'app' });
  assert.equal(second.timezone, 'Asia/Kolkata', 'earlier fields are kept');
  assert.equal(second.time, '07:30');
  assert.equal(second.channel, 'app');
});

test('one user\'s settings never show up for another', async () => {
  const store = createInMemoryBriefStore();
  await store.savePrefs(1, { enabled: false });
  await store.savePrefs(2, { time: '06:00' });
  assert.equal((await store.getPrefs(1)).enabled, false);
  assert.equal((await store.getPrefs(2)).enabled, true);
  assert.equal((await store.getPrefs(2)).time, '06:00');
  assert.equal((await store.listPrefs()).length, 2);
});

test('claimBrief lets exactly one caller record a given date', async () => {
  const store = createInMemoryBriefStore();
  assert.equal(await store.claimBrief(1, '2026-10-28'), true);
  assert.equal(await store.claimBrief(1, '2026-10-28'), false, 'the second claim for the same date loses');
  assert.equal(await store.claimBrief(1, '2026-10-29'), true, 'the next local day can be claimed');
  assert.equal(await store.claimBrief(2, '2026-10-28'), true, 'another user is independent');
});

test('concurrent claims for the same user and date produce one winner', async () => {
  const store = createInMemoryBriefStore();
  const results = await Promise.all([1, 2, 3, 4].map(() => store.claimBrief(1, '2026-10-28')));
  assert.equal(results.filter(Boolean).length, 1);
});

test('claiming a date keeps the user\'s settings, and saving settings keeps the claimed date', async () => {
  const store = createInMemoryBriefStore();
  await store.savePrefs(1, { time: '07:30', timezone: 'Europe/London' });
  await store.claimBrief(1, '2026-10-28');
  assert.deepEqual(
    { time: (await store.getPrefs(1)).time, tz: (await store.getPrefs(1)).timezone },
    { time: '07:30', tz: 'Europe/London' }
  );
  await store.savePrefs(1, { channel: 'app' });
  assert.equal((await store.getPrefs(1)).lastSentDate, '2026-10-28');
});

test('claiming for a user with no settings row creates one with the defaults', async () => {
  const store = createInMemoryBriefStore();
  await store.claimBrief(5, '2026-10-28');
  const row = await store.getPrefs(5);
  assert.equal(row.enabled, true);
  assert.equal(row.time, '09:00');
  assert.equal(row.channel, 'slack');
  assert.equal(row.lastSentDate, '2026-10-28');
});

test('the latest digest is saved per user and replaced by the next one', async () => {
  const store = createInMemoryBriefStore();
  assert.equal(await store.getDigest(1), null);
  await store.saveDigest(1, { generatedAt: 'a', comms: { pending: [] } });
  await store.saveDigest(2, { generatedAt: 'b' });
  assert.equal((await store.getDigest(1)).generatedAt, 'a');
  await store.saveDigest(1, { generatedAt: 'c' });
  assert.equal((await store.getDigest(1)).generatedAt, 'c');
  assert.equal((await store.getDigest(2)).generatedAt, 'b');
});
