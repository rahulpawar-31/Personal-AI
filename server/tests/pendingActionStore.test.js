import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryPendingActionStore } from '../services/stores/pendingActionStore.js';

// Same rationale as userStore.test.js: the in-memory adapter shares its core
// with the JSON-file adapter, so this covers both. File I/O is exercised for
// real by server/tests/smoke-auth.sh.

test('createPendingAction / getPendingAction round-trip, scoped to the owning user', async () => {
  const store = createInMemoryPendingActionStore();
  const row = await store.createPendingAction(1, 'add_task', { title: 'x' }, 'add x');
  assert.equal(row.status, 'pending');
  assert.equal((await store.getPendingAction(1, row.id)).actionType, 'add_task');
  assert.equal(await store.getPendingAction(2, row.id), null, 'must not leak across users');
});

test('listPendingActions filters by user and status', async () => {
  const store = createInMemoryPendingActionStore();
  const a = await store.createPendingAction(1, 'add_task', {}, '');
  await store.createPendingAction(2, 'add_task', {}, '');
  await store.resolvePendingAction(1, a.id, 'approved', { ok: true });

  assert.deepEqual((await store.listPendingActions(1, 'pending')).map(r => r.id), []);
  assert.deepEqual((await store.listPendingActions(2, 'pending')).map(r => r.id).length, 1);
});

test('resolvePendingAction only resolves a row that is still pending, and is scoped to the owning user', async () => {
  const store = createInMemoryPendingActionStore();
  const row = await store.createPendingAction(1, 'add_task', {}, '');

  assert.equal(await store.resolvePendingAction(2, row.id, 'approved', null), null, 'wrong user must not resolve it');
  const resolved = await store.resolvePendingAction(1, row.id, 'approved', { ok: true });
  assert.equal(resolved.status, 'approved');

  // already resolved — resolving again must return null, not silently overwrite
  assert.equal(await store.resolvePendingAction(1, row.id, 'rejected', null), null);
});

test('ids are assigned via a monotonic counter, never collide even when created in the same tick', async () => {
  const store = createInMemoryPendingActionStore();
  const rows = await Promise.all([
    store.createPendingAction(1, 'add_task', {}, ''),
    store.createPendingAction(1, 'add_task', {}, ''),
    store.createPendingAction(1, 'add_task', {}, ''),
  ]);
  assert.equal(new Set(rows.map(r => r.id)).size, 3);
});
