import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustedGoogleEmail } from '../lib/googleProfile.js';
import { createInMemoryUserStore } from '../services/stores/userStore.js';

test('a verified Google email is returned trimmed and lowercased', () => {
  assert.equal(trustedGoogleEmail({ email: '  Ada@Example.COM ', verified_email: true }), 'ada@example.com');
});

test('an unverified, missing or malformed email is not trusted', () => {
  for (const profile of [
    { email: 'ada@example.com', verified_email: false },
    { email: 'ada@example.com' },
    { email: 'ada@example.com', verified_email: 'true' }, // only a real boolean true counts
    { email: '', verified_email: true },
    { email: '   ', verified_email: true },
    { email: null, verified_email: true },
    { verified_email: true },
    null,
    undefined,
  ]) {
    assert.equal(trustedGoogleEmail(profile), null, JSON.stringify(profile));
  }
});

test('findByEmail ignores case and surrounding spaces', async () => {
  const store = createInMemoryUserStore();
  await store.createUser({ username: 'ada', email: 'Ada@Example.com', passwordHash: 'h' });
  assert.equal((await store.findByEmail('ada@example.com')).username, 'ada');
  assert.equal((await store.findByEmail('  ADA@EXAMPLE.COM ')).username, 'ada');
  assert.equal(await store.findByEmail('someone@else.com'), null);
});

test('findByEmail never matches on an empty or non-string email', async () => {
  const store = createInMemoryUserStore();
  await store.createUser({ username: 'noemail', email: null, passwordHash: 'h' });
  for (const e of ['', '   ', null, undefined, 42]) assert.equal(await store.findByEmail(e), null, String(e));
});
