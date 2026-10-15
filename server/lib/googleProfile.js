// server/lib/googleProfile.js
// Decides whether a Google profile may be matched to a local account by email.
//
// Matching by email is only safe if Google vouches for that address: an account
// with an unverified email could otherwise be used to claim someone else's
// address and be linked to their account. Returns the normalised (trimmed,
// lowercased) email, or null when there is none or Google has not verified it.
export function trustedGoogleEmail(profile) {
  const email = typeof profile?.email === 'string' ? profile.email.trim().toLowerCase() : '';
  if (!email || profile?.verified_email !== true) return null;
  return email;
}
