// client/src/healthLoader.js
// Loads the connected-services status (GET /api/health) for whoever is signed in.
//
// Two rules, both because the status belongs to one account:
//  - the newest request wins, so a slow reply that was started for an account that
//    has since signed out (or for an older request) never overwrites newer state;
//  - reset() clears the status at once and also cancels anything still in flight, so
//    one account's connected services are never shown to the next account (#420).
//
// request() resolves with the health object, or null when the server did not give a
// usable one (an error status); null is ignored, so a failed refresh keeps what is shown.
// apply(health) is called with the object to show; reset() calls it with {}.
export function createHealthLoader(request, apply) {
  let latest = 0;
  return {
    async load() {
      const mine = ++latest;
      let health;
      try { health = await request(); } catch { return; }
      if (mine !== latest || !health || typeof health !== 'object') return;
      apply(health);
    },
    reset() {
      latest += 1;
      apply({});
    },
  };
}
