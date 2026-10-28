import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemorySnoozeStore } from '../services/stores/snoozeStore.js';

// The in-memory adapter runs the same core as the JSON-file adapter. The
// Postgres adapter's SQL is not exercised here (no database in tests).

test('a user with nothing snoozed gets an empty list', async () => {
  const store = createInMemorySnoozeStore();
  assert.deepEqual(await store.listSnoozes(1), []);
});

test('a snooze is stored and listed with its return time and title', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'mail:gmail:a', until: '2026-10-29T03:30:00.000Z', title: 'Invoice' });
  assert.deepEqual(await store.listSnoozes(1), [
    { key: 'mail:gmail:a', until: '2026-10-29T03:30:00.000Z', title: 'Invoice' },
  ]);
});

test('snoozing the same item again moves its return time instead of adding a second row', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'k', until: '2026-10-29T03:30:00.000Z', title: 'a' });
  await store.upsertSnooze(1, { key: 'k', until: '2026-10-31T03:30:00.000Z', title: 'b' });
  const rows = await store.listSnoozes(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].until, '2026-10-31T03:30:00.000Z');
  assert.equal(rows[0].title, 'b');
});

test('the list is ordered by return time', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'late',  until: '2026-11-02T00:00:00.000Z' });
  await store.upsertSnooze(1, { key: 'early', until: '2026-10-29T00:00:00.000Z' });
  assert.deepEqual((await store.listSnoozes(1)).map(r => r.key), ['early', 'late']);
});

test('one user\'s snoozes never show up for, or get changed by, another user', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'shared-key', until: '2026-10-29T00:00:00.000Z', title: 'mine' });
  await store.upsertSnooze(2, { key: 'shared-key', until: '2026-11-05T00:00:00.000Z', title: 'theirs' });
  assert.equal((await store.listSnoozes(1))[0].title, 'mine');
  assert.equal((await store.listSnoozes(2))[0].title, 'theirs');
  assert.equal(await store.removeSnooze(2, 'shared-key'), true);
  assert.equal((await store.listSnoozes(1)).length, 1, 'user 1 still has their snooze');
  assert.equal((await store.listSnoozes(2)).length, 0);
});

test('removing a snooze says whether there was one', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'k', until: '2026-10-29T00:00:00.000Z' });
  assert.equal(await store.removeSnooze(1, 'k'), true);
  assert.equal(await store.removeSnooze(1, 'k'), false);
  assert.equal(await store.removeSnooze(1, 'never-snoozed'), false);
});

test('removeReturnedBefore drops only that user\'s snoozes that ended before the cutoff', async () => {
  const store = createInMemorySnoozeStore();
  await store.upsertSnooze(1, { key: 'old',    until: '2026-10-10T00:00:00.000Z' });
  await store.upsertSnooze(1, { key: 'recent', until: '2026-10-27T00:00:00.000Z' });
  await store.upsertSnooze(1, { key: 'future', until: '2026-11-10T00:00:00.000Z' });
  await store.upsertSnooze(2, { key: 'old',    until: '2026-10-10T00:00:00.000Z' });
  const removed = await store.removeReturnedBefore(1, '2026-10-21T12:00:00.000Z');
  assert.equal(removed, 1);
  assert.deepEqual((await store.listSnoozes(1)).map(r => r.key), ['recent', 'future']);
  assert.equal((await store.listSnoozes(2)).length, 1, 'another user\'s old snooze is untouched');
});
