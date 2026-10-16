// client/src/endServerSession.js
// Signing out always clears the browser at once, but the refresh cookie is httpOnly
// and only the server's response removes it, so a failed request means the session
// is still alive on the server. Say so instead of letting the sign-out look complete.
// `request` must be called synchronously (it reads the token before it is cleared).
// Nothing to end when there was no token, so no warning in that case.

export async function endServerSession(request, { hadToken, warn }) {
  if (!hadToken) return;
  try {
    const res = await request();
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.revoked === false) warn();
  } catch {
    warn();
  }
}
