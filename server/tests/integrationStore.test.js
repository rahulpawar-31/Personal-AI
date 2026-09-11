import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryIntegrationStore } from '../services/stores/integrationStore.js';

// Store deals in plain strings — encryption/decryption is a separate concern
// that stays in integrations.js's wrapper functions, same as today. The
// in-memory adapter shares its core with the JSON-file adapter (same
// rationale as userStore.test.js), so this covers both.

test('set then get round-trips a value, scoped to (userId, service, keyName)', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'google', 'GOOGLE_OAUTH_TOKENS', 'enc-value');
  assert.equal(await store.get(1, 'google', 'GOOGLE_OAUTH_TOKENS'), 'enc-value');
  assert.equal(await store.get(1, 'google', 'OTHER_KEY'), null);
  assert.equal(await store.get(2, 'google', 'GOOGLE_OAUTH_TOKENS'), null, 'must not leak across users');
});

test('set overwrites an existing (userId, service, keyName), not duplicates it', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'notion', 'NOTION_API_KEY', 'v1');
  await store.set(1, 'notion', 'NOTION_API_KEY', 'v2');
  assert.equal(await store.get(1, 'notion', 'NOTION_API_KEY'), 'v2');
  assert.equal((await store.listForUser(1)).length, 1);
});

test('delete removes only the targeted key', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'notion', 'A', 'a');
  await store.set(1, 'notion', 'B', 'b');
  await store.delete(1, 'notion', 'A');
  assert.equal(await store.get(1, 'notion', 'A'), null);
  assert.equal(await store.get(1, 'notion', 'B'), 'b');
});

test('deleteAllForService removes every key for that service, leaves other services alone', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'google', 'GOOGLE_OAUTH_TOKENS', 'g');
  await store.set(1, 'notion', 'NOTION_API_KEY', 'n');
  await store.deleteAllForService(1, 'google');
  assert.equal(await store.get(1, 'google', 'GOOGLE_OAUTH_TOKENS'), null);
  assert.equal(await store.get(1, 'notion', 'NOTION_API_KEY'), 'n');
});

test('listForUser returns every row for that user, scoped correctly, with service/keyName/keyValue/updatedAt', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'google', 'GOOGLE_OAUTH_TOKENS', 'g');
  await store.set(1, 'notion', 'NOTION_API_KEY', 'n');
  await store.set(2, 'google', 'GOOGLE_OAUTH_TOKENS', 'other-user');

  const rows = await store.listForUser(1);
  assert.equal(rows.length, 2);
  const byService = Object.fromEntries(rows.map(r => [r.service, r]));
  assert.equal(byService.google.keyName, 'GOOGLE_OAUTH_TOKENS');
  assert.equal(byService.google.keyValue, 'g');
  assert.ok(byService.google.updatedAt);
});
