# The agent's `draft_email` stays immediate; `send_email` stays gated

The chat agent's `draft_email` action saves a Gmail draft straight away, while `send_email` is queued for the user's approval (`CONFIRM_REQUIRED_INTENTS` in `server/lib/actions.js`). Issue #369 asked whether `draft_email` should be queued too. We decided it should not.

## Why

- A draft is only saved into the user's own Gmail Drafts folder. Nothing is sent, and nobody else sees it, until the user opens it in Gmail and sends it themselves, which is already a human step.
- The agent's tool result carries the draft's recipient and subject, so the chat reply can tell the user what was saved (the body is not returned, so whether the reply repeats it is up to the model). The full text is in Gmail Drafts, where the user can read, edit or delete it.
- The recipient and subject go through the same validated message builder as sending (`server/lib/emailMessage.js`), so a malformed address or a subject with line breaks is rejected before Gmail is called (#341).
- Text from the inbox reaches the agent only as `get_emails` output, which is wrapped and flagged as untrusted (`untrusted: true` in `langchain-agent.js`). A message that tries to steer the agent can at worst leave a draft, never send mail.
- The approval queue is meant for actions with an effect a person or another system will see (see the comment above `CONFIRM_REQUIRED_INTENTS`). Queueing every draft would add a click to a harmless step and teach people to approve without reading, which weakens the approvals that matter.

## Considered Options

- **Gate `draft_email`**: add it to `CONFIRM_REQUIRED_INTENTS`, and make approving it create the draft. Small to build, but it adds friction for no real protection, for the reasons above.
- **Leave it immediate (chosen).**

## Consequences

`server/tests/confirm-gate.test.js` pins the choice: `send_email` must be gated and `draft_email` must not be, so a change to either is a deliberate decision and not an accident. The residual risk is accepted: an agent steered by text in an email could leave a misleading draft in Drafts, and a user who sends it from Gmail without reading it would send that text. That needs a deliberate send in Gmail, which the app does not control. Revisit this if drafts ever start leaving the user's own mailbox (for example an auto-send feature), or if a draft could be created in someone else's account.
