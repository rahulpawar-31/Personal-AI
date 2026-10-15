import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../src/authErrors.js';

const msg = qs => authErrorMessage(new URLSearchParams(qs));

test('known sign-in errors map to fixed messages', () => {
  assert.match(msg('auth_error=google_failed'), /Google sign-in failed/);
  assert.match(msg('auth_error=google_failed&detail=invalid_state'), /expired/);
  assert.match(msg('auth_error=signup_disabled'), /invite-only/);
  assert.match(msg('auth_error=email_not_verified'), /confirm your email/);
});

test('free text in detail is never shown (a crafted link cannot write its own message)', () => {
  const text = msg('auth_error=google_failed&detail=' + encodeURIComponent('Your account is locked, call 555-0100'));
  assert.equal(text, 'Google sign-in failed. Please try again.');
  assert.doesNotMatch(text, /555/);
  assert.equal(msg('auth_error=google_failed&detail=server_error'), 'Google sign-in failed. Please try again.');
});

test('an unknown or missing error code shows nothing', () => {
  assert.equal(msg(''), '');
  assert.equal(msg('auth_error=made_up_by_an_attacker'), '');
});
