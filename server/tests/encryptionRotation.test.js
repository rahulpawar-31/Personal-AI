import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCipher } from '../services/encryption.js';
import { encryptionStatus, reencryptAll } from '../services/reencrypt.js';
import { createInMemoryIntegrationStore } from '../services/stores/integrationStore.js';

const OLD = 'old-secret-at-least-thirty-two-characters-long';
const NEW = 'new-secret-at-least-thirty-two-characters-long';
const oldOnly = createCipher({ secret: OLD });
const newOnly = createCipher({ secret: NEW });
const rotating = createCipher({ secret: NEW, previousSecret: OLD });

test('a value written under the old secret is read once the old secret is kept as previous', () => {
  const stored = oldOnly.encrypt('ghp_oldtoken');
  assert.equal(rotating.decrypt(stored), 'ghp_oldtoken');
  assert.throws(() => newOnly.decrypt(stored), 'without the previous secret it is unreadable');
});

test('new values are always written under the new secret', () => {
  const stored = rotating.encrypt('fresh');
  assert.equal(newOnly.decrypt(stored), 'fresh', 'readable with the new secret alone');
  assert.throws(() => oldOnly.decrypt(stored));
});

test('a value under neither secret is unreadable and reports the failure', () => {
  const stranger = createCipher({ secret: 'a-third-secret-also-thirty-two-chars-long!' });
  assert.throws(() => rotating.decrypt(stranger.encrypt('x')));
  assert.throws(() => rotating.inspect(stranger.encrypt('x')));
});

test('inspect says which secret opened the value', () => {
  assert.equal(rotating.inspect(newOnly.encrypt('a')).key, 'current');
  assert.equal(rotating.inspect(oldOnly.encrypt('a')).key, 'previous');
  assert.equal(rotating.inspect(oldOnly.encrypt('a')).plaintext, 'a');
});

// A value from before the "v1:" prefix existed has three parts, not four.
function legacyValue(secret, plaintext) {
  const key = crypto.scryptSync(secret, 'devos-aes-salt-v1', 32);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
}

test('a value from before the version prefix is still read, and is marked for re-encryption', () => {
  const legacy = legacyValue(NEW, 'old-format');
  assert.equal(newOnly.decrypt(legacy), 'old-format');
  assert.equal(newOnly.needsReencrypt(legacy), true);
  assert.equal(newOnly.needsReencrypt(newOnly.encrypt('x')), false);
});

test('needsReencrypt is true for a value under the previous secret and false for one under the current', () => {
  assert.equal(rotating.needsReencrypt(oldOnly.encrypt('x')), true);
  assert.equal(rotating.needsReencrypt(rotating.encrypt('x')), false);
});

test('shapes we do not know fail at once instead of trying the previous secret', () => {
  assert.throws(() => rotating.decrypt('v9:a:b:c'), /Unsupported ciphertext version/);
  assert.throws(() => rotating.decrypt('nonsense'), /format invalid/);
  assert.throws(() => rotating.decrypt(''), /format invalid/);
});

test('a previous secret equal to the current one is ignored', () => {
  assert.equal(createCipher({ secret: NEW, previousSecret: NEW }).hasPreviousSecret, false);
  assert.equal(createCipher({ secret: NEW, previousSecret: '' }).hasPreviousSecret, false);
  assert.equal(rotating.hasPreviousSecret, true);
});

async function seededStore() {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'github', 'GITHUB_TOKEN', oldOnly.encrypt('gh-secret-value'));
  await store.set(1, 'slack', 'SLACK_BOT_TOKEN', newOnly.encrypt('slack-secret-value'));
  await store.set(2, 'notion', 'NOTION_API_KEY', legacyValue(NEW, 'notion-secret-value'));
  await store.set(2, 'gemini', 'GEMINI_API_KEY', createCipher({ secret: 'lost-secret-thirty-two-characters-long!!' }).encrypt('lost'));
  return store;
}

test('status counts values on the current secret, to move, and unreadable, and never returns a value', async () => {
  const store = await seededStore();
  const status = await encryptionStatus({ store, cipher: rotating });
  assert.deepEqual(status, { total: 4, onCurrent: 1, toMove: 2, unreadable: 1, previousSecretSet: true });
  const text = JSON.stringify(status);
  for (const secret of ['gh-secret-value', 'slack-secret-value', 'notion-secret-value']) assert.ok(!text.includes(secret));
});

test('a dry run changes nothing', async () => {
  const store = await seededStore();
  const before = JSON.stringify(await store.listAll());
  const result = await reencryptAll({ store, cipher: rotating, dryRun: true });
  assert.deepEqual([result.reencrypted, result.alreadyCurrent, result.unreadable], [2, 1, 1]);
  assert.equal(JSON.stringify(await store.listAll()), before);
});

test('re-encrypting moves every readable value to the new secret, so the old one can be removed', async () => {
  const store = await seededStore();
  const result = await reencryptAll({ store, cipher: rotating });
  assert.deepEqual([result.reencrypted, result.alreadyCurrent, result.unreadable, result.skippedChanged], [2, 1, 1, 0]);

  // After removing the previous secret, everything that was readable still is.
  const after = Object.fromEntries((await store.listAll()).map(r => [r.keyName, r.keyValue]));
  assert.equal(newOnly.decrypt(after.GITHUB_TOKEN), 'gh-secret-value');
  assert.equal(newOnly.decrypt(after.SLACK_BOT_TOKEN), 'slack-secret-value');
  assert.equal(newOnly.decrypt(after.NOTION_API_KEY), 'notion-secret-value');
  assert.equal(newOnly.needsReencrypt(after.NOTION_API_KEY), false, 'the legacy format was upgraded too');
  assert.throws(() => newOnly.decrypt(after.GEMINI_API_KEY), 'a value that was already unreadable stays that way');

  const status = await encryptionStatus({ store, cipher: newOnly });
  assert.deepEqual([status.toMove, status.unreadable, status.onCurrent], [0, 1, 3]);
});

test('running it again changes nothing', async () => {
  const store = await seededStore();
  await reencryptAll({ store, cipher: rotating });
  const snapshot = JSON.stringify(await store.listAll());
  const second = await reencryptAll({ store, cipher: rotating });
  assert.deepEqual([second.reencrypted, second.alreadyCurrent], [0, 3]);
  assert.equal(JSON.stringify(await store.listAll()), snapshot);
});

test('a key saved while it runs is not overwritten with the older value', async () => {
  const store = await seededStore();
  const original = store.replaceIfUnchanged.bind(store);
  store.replaceIfUnchanged = async (userId, service, keyName, expected, value) => {
    if (service === 'github') await store.set(userId, service, keyName, newOnly.encrypt('saved-meanwhile'));
    return original(userId, service, keyName, expected, value);
  };
  const result = await reencryptAll({ store, cipher: rotating });
  assert.equal(result.skippedChanged, 1);
  assert.equal(newOnly.decrypt(await store.get(1, 'github', 'GITHUB_TOKEN')), 'saved-meanwhile');
});

test('the result holds counts only', async () => {
  const store = await seededStore();
  const text = JSON.stringify(await reencryptAll({ store, cipher: rotating }));
  for (const secret of ['gh-secret-value', 'slack-secret-value', 'notion-secret-value', 'GITHUB_TOKEN']) assert.ok(!text.includes(secret));
});

test('replaceIfUnchanged keeps the saved date', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(1, 'github', 'GITHUB_TOKEN', 'one');
  const before = (await store.listForUser(1))[0].updatedAt;
  await new Promise(r => setTimeout(r, 15));
  assert.equal(await store.replaceIfUnchanged(1, 'github', 'GITHUB_TOKEN', 'one', 'two'), true);
  const [row] = await store.listForUser(1);
  assert.equal(row.keyValue, 'two');
  assert.equal(row.updatedAt, before);
  assert.equal(await store.replaceIfUnchanged(1, 'github', 'GITHUB_TOKEN', 'wrong', 'three'), false);
  assert.equal(await store.replaceIfUnchanged(9, 'x', 'y', 'a', 'b'), false);
});
