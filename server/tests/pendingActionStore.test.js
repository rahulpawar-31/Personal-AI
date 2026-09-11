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
  await store.transitionPendingAction(1, a.id, 'pending', 'approved', { ok: true });

  assert.deepEqual((await store.listPendingActions(1, 'pending')).map(r => r.id), []);
  assert.deepEqual((await store.listPendingActions(2, 'pending')).map(r => r.id).length, 1);
});

test('transitionPendingAction only transitions a row currently in fromStatus, and is scoped to the owning user', async () => {
  const store = createInMemoryPendingActionStore();
  const row = await store.createPendingAction(1, 'add_task', {}, '');

  assert.equal(await store.transitionPendingAction(2, row.id, 'pending', 'approved', null), null, 'wrong user must not transition it');
  const resolved = await store.transitionPendingAction(1, row.id, 'pending', 'approved', { ok: true });
  assert.equal(resolved.status, 'approved');

  // already resolved — transitioning again from 'pending' must return null, not silently overwrite
  assert.equal(await store.transitionPendingAction(1, row.id, 'pending', 'rejected', null), null);
});

test('transitionPendingAction stamps resolvedAt on a terminal status but not on an intermediate one', async () => {
  const store = createInMemoryPendingActionStore();
  const row = await store.createPendingAction(1, 'add_task', {}, '');

  const claimed = await store.transitionPendingAction(1, row.id, 'pending', 'processing');
  assert.equal(claimed.resolvedAt, null, 'processing is not a terminal state');

  const finalized = await store.transitionPendingAction(1, row.id, 'processing', 'approved', { ok: true });
  assert.ok(finalized.resolvedAt, 'approved is terminal — resolvedAt must be set');
});

test('claim-before-execute prevents a pending action from being processed twice, even under concurrent claim attempts', async () => {
  const store = createInMemoryPendingActionStore();
  const row = await store.createPendingAction(1, 'send_email', {}, '');

  let executeCount = 0;
  async function simulateApprove() {
    const claimed = await store.transitionPendingAction(1, row.id, 'pending', 'processing');
    if (!claimed) return { claimed: false };
    executeCount += 1; // stand-in for the real executeAction() side effect actually running
    const finalized = await store.transitionPendingAction(1, row.id, 'processing', 'approved', { ok: true });
    return { claimed: true, finalized };
  }

  const [a, b] = await Promise.all([simulateApprove(), simulateApprove()]);
  const claimedCount = [a, b].filter(r => r.claimed).length;

  assert.equal(claimedCount, 1, 'exactly one concurrent approval attempt should win the claim');
  assert.equal(executeCount, 1, 'the side effect must run exactly once');
  assert.equal((await store.getPendingAction(1, row.id)).status, 'approved');
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
