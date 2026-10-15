import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.ENCRYPTION_SECRET = 'credential-handling-test-secret-32-chars';

const { encrypt, decrypt } = await import('../services/encryption.js');
const { maskKey } = await import('../services/integrations.js');
const { sealEmailData, openEmailData } = await import('../lib/email-cache.js');

// A value written by the code before the version prefix existed: <iv>:<tag>:<body>.
function legacyEncrypt(plaintext) {
  const key    = crypto.scryptSync(process.env.ENCRYPTION_SECRET, 'devos-aes-salt-v1', 32);
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body   = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64url')).join(':');
}

test('new ciphertext carries a v1 prefix and round-trips', () => {
  const c = encrypt('ntn_secret_value');
  assert.match(c, /^v1:[^:]+:[^:]+:[^:]+$/);
  assert.equal(decrypt(c), 'ntn_secret_value');
});

test('ciphertext written before the prefix existed still decrypts', () => {
  assert.equal(decrypt(legacyEncrypt('old-key-123')), 'old-key-123');
});

test('an unknown version fails with a clear error instead of a garbled one', () => {
  const swapped = encrypt('x').replace(/^v1:/, 'v2:');
  assert.throws(() => decrypt(swapped), /Unsupported ciphertext version/);
  assert.throws(() => decrypt('not-a-ciphertext'), /format invalid/);
});

test('a tampered value is rejected', () => {
  const parts = encrypt('secret').split(':');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decrypt(parts.join(':')));
});

test('maskKey reveals at most a sixth of the value from each end (#347)', () => {
  assert.equal(maskKey('0123456789'), '0••••9', 'a 10-character secret no longer shows 9 of 10 characters');
  assert.equal(maskKey('ntn_' + 'x'.repeat(40)), 'ntn_••••xxxx');
  assert.equal(maskKey('abcde'), '••••••••');
  assert.equal(maskKey(''), '••••••••');
  for (const len of [6, 10, 12, 20, 40, 80]) {
    const plain = 'a'.repeat(len);
    const revealed = maskKey(plain).replace(/•/g, '').length;
    assert.ok(revealed * 3 <= len, `${len}-char value reveals ${revealed} characters`);
  }
});

test('cached email data is stored as ciphertext and reads back (#346)', () => {
  const emails = [{ id: 1, subject: 'Salary review', body: 'Confidential text — ☕' }];
  const stored = sealEmailData(emails);
  assert.deepEqual(Object.keys(stored), ['enc']);
  assert.doesNotMatch(JSON.stringify(stored), /Salary|Confidential/);
  assert.deepEqual(openEmailData(stored), emails);
});

test('old plaintext cache rows and unreadable rows read as a cache miss', () => {
  assert.equal(openEmailData([{ id: 1, subject: 'plain' }]), null);
  assert.equal(openEmailData({ enc: 'v1:AAAA:BBBB:CCCC' }), null);
  assert.equal(openEmailData(null), null);
  assert.equal(openEmailData(undefined), null);
});
