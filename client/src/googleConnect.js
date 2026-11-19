// client/src/googleConnect.js
// The first step of connecting Google, shared by the sidebar action, the onboarding
// step and Settings so they react the same way: ask the server for Google's consent
// URL, and say plainly what went wrong when that does not work (#424).
//
// fetchInit() makes the request (callers pass apiFetch('/api/auth/google/init...')).
// Resolves with { url } to go to, or { error, message }, where error is
//   'session'  the server rejected the sign-in (401): sign in again
//   'network'  the request itself failed
//   'server'   any other error status
//   'response' a success reply that was not JSON or carried no usable URL
// message is fixed wording that is safe to show: never text taken from the server,
// which could carry internals.
export const GOOGLE_CONNECT_MESSAGES = {
  session:  'Your session has expired. Sign in again, then connect Google.',
  network:  "Couldn't reach the server. Check your connection and try again.",
  server:   "Google sign-in couldn't be started. Please try again in a moment.",
  response: "Google sign-in couldn't be started. Please try again in a moment.",
};

const fail = error => ({ error, message: GOOGLE_CONNECT_MESSAGES[error] });

export async function startGoogleConnect(fetchInit) {
  let r;
  try {
    r = await fetchInit();
  } catch {
    return fail('network');
  }
  if (r.status === 401) return fail('session');
  if (!r.ok) return fail('server');
  let data;
  try {
    data = await r.json();
  } catch {
    return fail('response');
  }
  // Only ever send the browser to an https address (Google's consent page is one).
  if (typeof data?.url !== 'string' || !/^https:\/\//i.test(data.url)) return fail('response');
  return { url: data.url };
}
