import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_SPECS, wrapperFor } from '../services/langchain-agent.js';
import { CONFIRM_REQUIRED_INTENTS } from '../lib/actions.js';

// Guards the SEC-2 confirmation gate: a write-capable intent in
// CONFIRM_REQUIRED_INTENTS must be queued for human approval (mkPending) when
// exposed as a LangChain agent tool, never run immediately (mk). Before this
// test existed, that correspondence was maintained by hand per tool with
// nothing to catch drift.

test('every agent tool is queued for approval iff its intent requires confirmation', () => {
  for (const spec of TOOL_SPECS) {
    if (spec.untrusted) continue; // untrusted-wrapping is orthogonal to approval-gating
    const requiresConfirmation = CONFIRM_REQUIRED_INTENTS.has(spec.intent);
    const wrapsAsPending = wrapperFor(spec.intent) === 'pending';
    assert.equal(
      wrapsAsPending,
      requiresConfirmation,
      `${spec.name} (intent "${spec.intent}"): wraps as ${wrapsAsPending ? 'pending' : 'immediate'} but CONFIRM_REQUIRED_INTENTS says ${requiresConfirmation ? 'pending' : 'immediate'}`
    );
  }
});

test('TOOL_SPECS covers at least one confirm-required intent (test is not vacuous)', () => {
  const pendingSpecs = TOOL_SPECS.filter((s) => CONFIRM_REQUIRED_INTENTS.has(s.intent));
  assert.ok(pendingSpecs.length > 0, 'expected at least one registered tool to require confirmation');
});

// docs/adr/0004: drafting an email only saves a draft in the user's own Gmail,
// sending it is what needs approval. Change either on purpose, not by accident.
test('send_email is queued for approval and draft_email is deliberately not (ADR-0004)', () => {
  assert.ok(CONFIRM_REQUIRED_INTENTS.has('send_email'));
  assert.ok(!CONFIRM_REQUIRED_INTENTS.has('draft_email'));
  const drafting = TOOL_SPECS.find((s) => s.intent === 'draft_email');
  assert.ok(drafting, 'draft_email is still offered to the agent');
  assert.equal(wrapperFor('draft_email'), 'immediate');
  assert.equal(wrapperFor('send_email'), 'pending');
});
