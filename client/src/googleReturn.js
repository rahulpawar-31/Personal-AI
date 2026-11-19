// client/src/googleReturn.js
// Reads what the server's Google callback left in the address bar (see
// server/lib/googleReturn.js): ?connected=true after a connection started anywhere,
// ?google_connected=true after one started from Settings.
//
// Each name is matched exactly. A plain substring test for "connected=true" also
// matches "google_connected=true", which is how the Settings return used to be
// handled by the wrong branch and never opened Settings.
export function parseGoogleReturn(search) {
  const params = new URLSearchParams(search);
  const fromSettings = params.get('google_connected') === 'true';
  const connected = fromSettings || params.get('connected') === 'true';
  return { connected, fromSettings };
}
