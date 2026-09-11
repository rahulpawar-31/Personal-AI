// client/src/api.js
// Thin fetch wrapper that attaches the auth token to every request, and the
// session module: getToken/setToken/clearSession are the only code that
// should touch 'devos_token' directly.
const TOKEN_KEY      = 'devos_token';
const ONBOARDING_KEY = 'devos_onboarding'; // cleared alongside the token — see clearSession()

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

// Token-only clear — for call sites that must not touch the onboarding flag
// (e.g. a 401 mid-onboarding, or account deletion). Does not navigate or
// reset React state; callers keep doing that themselves.
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Clears the token and the onboarding flag together — the two are cleared
// in lockstep at logout and at a 401 on the startup auth check.
export function clearSession() {
  clearToken();
  localStorage.removeItem(ONBOARDING_KEY);
}

// The access token is short-lived (15m) — the server keeps a long-lived
// refresh token in an httpOnly cookie and exposes POST /api/auth/refresh to
// silently mint a new access token from it. Share one in-flight refresh
// across concurrent 401s so we don't hit the endpoint once per request.
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST' })
      .then(async r => {
        if (!r.ok) throw new Error('refresh failed');
        const data = await r.json();
        setToken(data.token);
        return data.token;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function apiFetch(url, opts = {}) {
  const token   = getToken();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...opts, headers });

  // Access token expired mid-session — refresh once and retry transparently.
  if (res.status === 401 && token) {
    try {
      const newToken = await refreshAccessToken();
      return fetch(url, { ...opts, headers: { ...headers, Authorization: `Bearer ${newToken}` } });
    } catch {
      // Refresh token is also gone — surface the original 401 to the caller.
    }
  }

  return res;
}
