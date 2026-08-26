// client/src/api.js
// Thin fetch wrapper that attaches the auth token to every request.
export function getToken() {
  return localStorage.getItem('devos_token');
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
        localStorage.setItem('devos_token', data.token);
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
