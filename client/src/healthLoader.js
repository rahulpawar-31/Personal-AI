// client/src/healthLoader.js
// Loads the connected-services status (GET /api/health) for whoever is signed in.
//
// Two rules, both because the status belongs to one account:
//  - the newest successful request wins, so a failed refresh does not discard a
//    usable answer, and a slower answer cannot overwrite newer successful state;
//  - reset() clears the status at once and also cancels anything still in flight, so
//    one account's connected services are never shown to the next account (#420).
//
// request() resolves with the health object, or null when the server did not give a
// usable one (an error status); null is ignored, so a failed refresh keeps what is shown.
// apply(health) is called with the object to show; reset() calls it with {}.
export function createHealthLoader(request, apply) {
  let generation = 0;
  let requested = 0;
  let applied = 0;
  return {
    async load() {
      const mine = ++requested;
      const account = generation;
      let health;
      try { health = await request(); } catch { return; }
      if (account !== generation || mine < applied || !health || typeof health !== 'object' || Array.isArray(health)) return;
      applied = mine;
      apply(health);
    },
    reset() {
      generation += 1;
      apply({});
    },
  };
}
