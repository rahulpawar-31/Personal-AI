import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bareAddress, matchesVIP } from '../services/memory.js';

// Regression tests for #406: isVIP() used String.includes, so any address that
// merely contained a VIP address was treated as a VIP.

const vips = [{ email: 'bob@acme.com' }, { email: 'ann@x.co' }];

test('bareAddress extracts and lowercases the address', () => {
  assert.equal(bareAddress('Bob Smith <Bob@Acme.com>'), 'bob@acme.com');
  assert.equal(bareAddress('"Smith, Bob" <bob@acme.com>'), 'bob@acme.com');
  assert.equal(bareAddress('  BOB@acme.com '), 'bob@acme.com');
  assert.equal(bareAddress(undefined), '');
  assert.equal(bareAddress(null), '');
});

test('exact address matches, regardless of case or display name', () => {
  assert.equal(matchesVIP(vips, 'bob@acme.com'), true);
  assert.equal(matchesVIP(vips, 'BOB@ACME.COM'), true);
  assert.equal(matchesVIP(vips, 'Bob <bob@acme.com>'), true);
});

test('addresses that merely contain a VIP address do not match', () => {
  assert.equal(matchesVIP(vips, 'bigbob@acme.com'), false);
  assert.equal(matchesVIP(vips, 'bob@acme.com.evil.io'), false);
  assert.equal(matchesVIP(vips, 'joann@x.co'), false);
  assert.equal(matchesVIP(vips, 'Evil <bigbob@acme.com>'), false);
});

test('legacy mixed-case stored entries still match', () => {
  assert.equal(matchesVIP([{ email: 'Bob@Acme.com' }], 'bob@acme.com'), true);
});

test('empty or missing input never matches', () => {
  assert.equal(matchesVIP(vips, ''), false);
  assert.equal(matchesVIP(vips, undefined), false);
  assert.equal(matchesVIP([], 'bob@acme.com'), false);
  assert.equal(matchesVIP(undefined, 'bob@acme.com'), false);
});
