import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptionSummary } from '../src/encryptionStatus.js';

test('nothing is shown when no rotation is under way and nothing needs moving', () => {
  assert.equal(encryptionSummary({ total: 11, onCurrent: 11, toMove: 0, unreadable: 0, previousSecretSet: false }), null);
  assert.equal(encryptionSummary(undefined), null);
  assert.equal(encryptionSummary({}), null);
  assert.equal(encryptionSummary(null), null);
});

test('values still on the old secret can be re-encrypted', () => {
  const s = encryptionSummary({ total: 16, onCurrent: 4, toMove: 12, unreadable: 0, previousSecretSet: true });
  assert.match(s.headline, /12 of 16 saved values still on the old secret/);
  assert.equal(s.canReencrypt, true);
  assert.match(s.hint, /before removing the previous secret/);
});

test('once everything is moved it says the previous secret can go', () => {
  const s = encryptionSummary({ total: 16, onCurrent: 16, toMove: 0, unreadable: 0, previousSecretSet: true });
  assert.match(s.headline, /All 16 saved values are on the current secret/);
  assert.equal(s.canReencrypt, false);
  assert.match(s.hint, /remove ENCRYPTION_SECRET_PREVIOUS/);
});

test('unreadable values are called out and are not offered for re-encryption', () => {
  const s = encryptionSummary({ total: 5, onCurrent: 4, toMove: 0, unreadable: 1, previousSecretSet: false });
  assert.match(s.headline, /1 can no longer be read/);
  assert.equal(s.canReencrypt, false);
});

test('wording is right for a single value', () => {
  assert.match(encryptionSummary({ total: 1, onCurrent: 0, toMove: 1, unreadable: 0, previousSecretSet: true }).headline, /1 of 1 saved value still/);
  assert.match(encryptionSummary({ total: 1, onCurrent: 1, toMove: 0, unreadable: 0, previousSecretSet: true }).headline, /All 1 saved value is on/);
});
