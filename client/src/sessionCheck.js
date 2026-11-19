// client/src/sessionCheck.js
// Asks the server who the stored token belongs to, and says what the answer means:
//   { status: 'ok', user }    the session is good
//   { status: 'invalid' }     the server rejected the token (401): sign in again
//   { status: 'unavailable' } the server could not say (502/503, no network, a reply
//                             that is not JSON, or no reply in time): the token may be
//                             fine, so keep it and let the user retry (#423)
// fetchMe() does the request (the app passes apiFetch('/api/users/me')).
const DEFAULT_TIMEOUT_MS = 15_000;

export async function checkSession(fetchMe, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let timer;
  // Without this, a request that never answers leaves the app on "Loading…" for good.
  const gaveUp = new Promise(resolve => {
    timer = setTimeout(() => resolve({ status: 'unavailable' }), timeoutMs);
  });
  const asked = (async () => {
    try {
      const r = await fetchMe();
      if (r.ok) {
        const user = await r.json();
        return user && typeof user === 'object' ? { status: 'ok', user } : { status: 'unavailable' };
      }
      return r.status === 401 ? { status: 'invalid' } : { status: 'unavailable' };
    } catch {
      return { status: 'unavailable' };
    }
  })();
  try {
    return await Promise.race([asked, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
