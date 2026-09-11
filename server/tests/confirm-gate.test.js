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
