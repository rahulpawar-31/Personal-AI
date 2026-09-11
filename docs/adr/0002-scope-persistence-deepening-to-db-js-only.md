# Scope the persistence deepening to db.js only, not auth.js's token storage

`server/services/db.js`'s 17 functions each repeated an inline `if (pool) {pg} else {JSON file}` — a clean backend-selection branch, now collapsed into `UserStore`/`PendingActionStore` interfaces (`server/services/stores/`) with three adapters each (Postgres, JSON-file, in-memory-for-tests), selected once in `initDB()`.

`server/services/auth.js` has a structurally different duplication: it doesn't select one backend, it writes to *both* the token file and the DB on every token refresh, and that "merge and write to both" invariant is repeated across 2 call sites. This is a real finding from the same architecture review (Candidate 2's original writeup), but a different shape of fix (extract one `persistTokens()` helper, not a store interface) — deliberately left for a separate pass.

## Considered Options

- **Both in one PR**: touches two structurally different problems in one changeset, makes the diff harder to review and revert independently.

## Consequences

A future architecture review may re-notice `auth.js`'s token-persistence duplication — that's real and still open, not missed.
