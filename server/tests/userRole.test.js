import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'user-role-test-secret-32-characters-long';

const users = await import('../services/users.js');
const { ROLES, isValidRole } = await import('../lib/roles.js');
const { createInMemoryUserStore } = await import('../services/stores/userStore.js');

test('a new account has no role until it picks one', async () => {
  const store = createInMemoryUserStore();
  const a = await store.createUser({ username: 'ada', email: null, passwordHash: 'x' });
  assert.equal(a.role, null);
  assert.equal((await store.findById(a.id)).role, null);
});

test('a saved role is read back on lookup and only for that account', async () => {
  const store = createInMemoryUserStore();
  const a = await store.createUser({ username: 'ada', email: null, passwordHash: 'x' });
  const b = await store.createUser({ username: 'bob', email: null, passwordHash: 'x' });
  await store.updateRole(a.id, 'sales');
  assert.equal((await store.findById(a.id)).role, 'sales');
  assert.equal((await store.findById(b.id)).role, null, 'another account is untouched');
  await store.updateRole(a.id, 'developer');
  assert.equal((await store.findById(a.id)).role, 'developer', 'the role can be changed later');
});

test('saving a role for a missing account is an error', async () => {
  const store = createInMemoryUserStore();
  await assert.rejects(() => store.updateRole(999, 'sales'), /User not found/);
});

test('updateRole accepts every launch role and saves it', async () => {
  for (const role of ROLES) {
    const saved = [];
    await users.updateRole(1, role, { saveRole: async (id, r) => saved.push([id, r]) });
    assert.deepEqual(saved, [[1, role]]);
  }
});

test('updateRole rejects an unknown or malformed role without saving', async () => {
  for (const bad of ['admin', 'Developer', '', null, undefined, 42, ['sales']]) {
    const saved = [];
    await assert.rejects(
      () => users.updateRole(1, bad, { saveRole: async (id, r) => saved.push([id, r]) }),
      /Invalid role/,
      `expected ${JSON.stringify(bad)} to be rejected`
    );
    assert.deepEqual(saved, [], `nothing should be saved for ${JSON.stringify(bad)}`);
  }
});

test('the launch roles are the four from the roadmap', () => {
  assert.deepEqual(ROLES, ['developer', 'sales', 'freelancer-founder', 'custom']);
  assert.equal(isValidRole('custom'), true);
  assert.equal(isValidRole('hr'), false);
});
