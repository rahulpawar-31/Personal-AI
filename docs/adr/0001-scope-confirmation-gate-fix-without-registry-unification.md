# Scope the confirmation-gate fix without unifying the tool registry

`langchain-agent.js`'s `buildTools()` now derives `mk` vs `mkPending` per tool from `CONFIRM_REQUIRED_INTENTS` (via a `wrapFor()` helper) instead of hand-picking the wrapper per call site. We deliberately did **not** also unify tool descriptions/schemas with `lib/actions.js`'s `AGENT_SCHEMA` string and `executeAction`'s handler map into one shared per-intent registry, even though that would remove real duplication between the two chat engines.

## Considered Options

- **Full registry**: one per-intent table (name, description, zod schema, intent) consumed by both the plain-classifier path (`AGENT_SCHEMA`) and the LangChain tool path (`buildTools()`). Rejected for this change — it touches the plain-classifier path, which isn't part of the security gap being closed here, and is a separate, larger deepening in its own right.

## Consequences

A future architecture review will likely re-notice the `AGENT_SCHEMA`/`buildTools()` description-and-schema duplication. That's real and still open — it was scoped out deliberately, not missed.
