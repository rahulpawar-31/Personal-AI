import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsableKey } from '../src/lib/keyStatus.js';

test('a saved, readable key is usable', () => {
  assert.equal(isUsableKey({ updatedAt: 'now', keyHint: 'ntn_••••xxxx' }), true);
});

test('a missing key is not usable', () => {
  assert.equal(isUsableKey(undefined), false);
  assert.equal(isUsableKey(null), false);
});

test('a key the server cannot decrypt is not usable', () => {
  assert.equal(isUsableKey({ keyHint: '••••••••', unreadable: true }), false);
});
