import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryUserStore } from '../services/stores/userStore.js';

// Exercises the array-backed store's shared logic via the in-memory adapter —
// the JSON-file adapter runs the exact same core, swapping only how rows are
// read/written, so this also covers that adapter's business logic. File I/O
// itself is exercised for real by server/tests/smoke-auth.sh (JSON-file mode).

test('createUser rejects a duplicate username (case-insensitive)', async () => {
  const store = createInMemoryUserStore();
  await store.createUser({ username: 'Ada', email: 'ada@example.com', passwordHash: 'h' });
  await assert.rejects(
    () => store.createUser({ username: 'ada', email: 'other@example.com', passwordHash: 'h2' }),
    /Username already taken/
  );
});

test('findByUsername is case-insensitive and returns null when missing', async () => {
  const store = createInMemoryUserStore();
  await store.createUser({ username: 'Ada', email: 'ada@example.com', passwordHash: 'h' });
  assert.equal((await store.findByUsername('ADA')).username, 'ada');
  assert.equal(await store.findByUsername('nobody'), null);
});

test('ids are assigned via a monotonic counter, never collide even when created in the same tick', async () => {
  const store = createInMemoryUserStore();
  const [a, b, c] = await Promise.all([
    store.createUser({ username: 'a', email: null, passwordHash: 'h' }),
    store.createUser({ username: 'b', email: null, passwordHash: 'h' }),
    store.createUser({ username: 'c', email: null, passwordHash: 'h' }),
  ]);
  const ids = [a.id, b.id, c.id];
  assert.equal(new Set(ids).size, 3, `expected 3 distinct ids, got ${JSON.stringify(ids)}`);
});

test('updateEmail, updatePasswordHash, deleteUser round-trip through findById', async () => {
  const store = createInMemoryUserStore();
  const user = await store.createUser({ username: 'ada', email: null, passwordHash: 'h1' });

  await store.updateEmail(user.id, 'new@example.com');
  assert.equal((await store.findById(user.id)).email, 'new@example.com');

  await store.updatePasswordHash(user.id, 'h2');
  // updatePasswordHash isn't part of the public findById shape, but the call
  // itself must not throw and the user must still be findable afterward.
  assert.ok(await store.findById(user.id));

  await store.deleteUser(user.id);
  assert.equal(await store.findById(user.id), null);
});

test('findByGoogleId / linkGoogleId / createGoogleUser', async () => {
  const store = createInMemoryUserStore();
  const user = await store.createUser({ username: 'ada', email: null, passwordHash: 'h' });
  assert.equal(await store.findByGoogleId('g-1'), null);

  await store.linkGoogleId(user.id, 'g-1');
  assert.equal((await store.findByGoogleId('g-1')).id, user.id);

  const googleUser = await store.createGoogleUser({ username: 'grace', email: 'g@example.com', googleId: 'g-2' });
  assert.equal((await store.findByGoogleId('g-2')).id, googleUser.id);
});

test('listUsers, setAdmin, isAdmin', async () => {
  const store = createInMemoryUserStore();
  const user = await store.createUser({ username: 'ada', email: null, passwordHash: 'h' });
  assert.equal(await store.isAdmin(user.id), false);

  await store.setAdmin(user.id, true);
  assert.equal(await store.isAdmin(user.id), true);

  const listed = await store.listUsers();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].isAdmin, true);
});
