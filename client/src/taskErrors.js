// client/src/taskErrors.js
// The Tasks board reloads often (every refresh, every change). A source that
// keeps failing should say so once, not toast on every reload. `seen` is a Set
// kept by the caller for the life of the page; returns only messages not yet shown.

export function newTaskErrors(errors, seen) {
  const fresh = [];
  for (const message of Object.values(errors ?? {})) {
    if (typeof message === 'string' && message && !seen.has(message)) {
      seen.add(message);
      fresh.push(message);
    }
  }
  return fresh;
}
