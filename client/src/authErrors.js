// client/src/authErrors.js
// Turns the ?auth_error= / ?detail= parameters of the sign-in redirect into text.
//
// The page URL is attacker-controllable, so the wording only ever comes from
// the fixed table below. An unknown code, or free text in `detail`, is ignored
// rather than shown — otherwise a crafted link could put any message on the
// sign-in page.
const DETAIL_MESSAGES = {
  invalid_state: 'That sign-in link has expired. Please try again.',
};

export function authErrorMessage(params) {
  const code = params.get('auth_error');
  if (code === 'google_failed') {
    return DETAIL_MESSAGES[params.get('detail')] ?? 'Google sign-in failed. Please try again.';
  }
  if (code === 'signup_disabled') return 'Signups are currently invite-only.';
  if (code === 'email_not_verified') {
    return "Google didn't confirm your email address, so you can't sign in with it. Verify the email on your Google account and try again.";
  }
  return '';
}
