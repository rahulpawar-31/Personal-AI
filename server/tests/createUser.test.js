import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSignupAllowed, createUser } from '../services/users.js';

test('isSignupAllowed matches the owner username case-insensitively', () => {
  assert.equal(isSignupAllowed('owner', 'owner'), true);
  assert.equal(isSignupAllowed('Owner', 'owner'), true);
  assert.equal(isSignupAllowed('owner', 'Owner'), true);
  assert.equal(isSignupAllowed('  OWNER ', ' owner  '), true);
});

test('isSignupAllowed rejects everyone but the owner', () => {
  assert.equal(isSignupAllowed('stranger', 'owner'), false);
  assert.equal(isSignupAllowed('owner2', 'owner'), false);
});

test('isSignupAllowed is open when OWNER_USERNAME is unset', () => {
  assert.equal(isSignupAllowed('anyone', undefined), true);
  assert.equal(isSignupAllowed('anyone', ''), true);
});

test('createUser rejects a non-owner signup before touching the store', async () => {
  const prev = process.env.OWNER_USERNAME;
  process.env.OWNER_USERNAME = 'Owner';
  try {
    await assert.rejects(
      () => createUser('stranger', 'password123', 'x@example.com'),
      /invite-only/
    );
  } finally {
    if (prev === undefined) delete process.env.OWNER_USERNAME;
    else process.env.OWNER_USERNAME = prev;
  }
});
