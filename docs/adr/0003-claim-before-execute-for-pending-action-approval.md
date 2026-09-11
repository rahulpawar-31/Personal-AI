# Claim before execute for pending-action approval

`POST /api/actions/:id/approve` used to check the row was still `pending`, run `executeAction` (the real side effect — send an email, create a GitHub issue), then write the result back guarded by `WHERE status = 'pending'`. Two concurrent approve requests (double-click, a retried request after a slow response) could both pass the check and both run `executeAction`, even though the guarded write meant only one of them actually got recorded — and the route never checked the write's return value, so the losing request still responded as if it had succeeded.

Verified via a `/prototype` session (`server/routes/actions.approval-flow.prototype.html`, captured on the `prototype/pending-action-race` branch) before fixing: the demo made the double-execution directly visible by running two simulated approvals against the same starting state. Confirmed for real afterward by seeding a pending action and firing two concurrent HTTP approve requests at a live server — the losing request got a proper `409 Already error` instead of a false success, and the server log showed the side effect (`gmail.sendEmail`) firing exactly once, not twice.

## Decision

Split approval into two atomic transitions around the side effect instead of one check-then-act: **claim** (`pending → processing`, before `executeAction` runs) and **finalize** (`processing → approved/error`, after). A concurrent request that loses the claim never runs `executeAction` at all, rather than running it and then losing only the write. `PendingActionStore.transitionPendingAction(userId, id, fromStatus, toStatus, result)` is the one atomic primitive behind claim, finalize, and reject (`pending → rejected`, which never needed the two-phase split since it has no side effect to guard).

## Consequences

A `processing` status now exists between `pending` and a terminal one. It's excluded from `GET /api/actions/pending`'s listing (which filters on `status = 'pending'`) — correct, since a row mid-approval shouldn't offer to be approved again. No schema migration needed: `pending_actions.status` was already an unconstrained `TEXT` column.
