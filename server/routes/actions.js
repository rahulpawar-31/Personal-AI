import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds } from '../lib/creds.js';
import { executeAction } from '../lib/actions.js';
import { dbListPendingActions, dbGetPendingAction, dbTransitionPendingAction } from '../services/db.js';
import memory from '../services/memory.js';

// Pending agent actions — state-changing tool calls the LangChain agent queued
// instead of running immediately (see SEC-2 remediation in langchain-agent.js).
// A human approves or rejects each one here before executeAction actually runs.
//
// Approve is two atomic steps around the side effect, not a check-then-act:
// claim (pending -> processing) happens BEFORE executeAction runs, so a
// second concurrent approve request can't also pass the check and also run
// executeAction — its own claim attempt loses the race and it never
// executes anything. See docs/adr/0003 and the prototype this replaced,
// server/routes/actions.approval-flow.prototype.html (see git history).

const router = Router();

router.get('/api/actions/pending', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    res.json(await dbListPendingActions(uid, 'pending'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared by approve/reject: once a transition attempt loses the race (or the
// row never existed), report the same 404/409 shape the caller always got.
async function notActionable(uid, id, res) {
  const existing = await dbGetPendingAction(uid, id);
  if (!existing) { res.status(404).json({ error: 'Pending action not found' }); return true; }
  res.status(409).json({ error: `Already ${existing.status}` });
  return true;
}

router.post('/api/actions/:id/approve', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  const { id } = req.params;
  try {
    // Atomic claim — only the request that wins this proceeds to execute.
    const claimed = await dbTransitionPendingAction(uid, id, 'pending', 'processing');
    if (!claimed) { await notActionable(uid, id, res); return; }

    const finalParams = { ...claimed.params, ...(req.body?.edited ?? {}) };
    const creds  = await getUserCreds(uid);

    // executeAction can reject (e.g. an unconfigured/expired integration
    // throwing) as well as resolve with a `{ error }` payload. Either way the
    // pending row must still be resolved and logged — otherwise a failed run
    // is left stuck in "processing" forever with no audit trail of the attempt.
    let result, isErr;
    try {
      result = await executeAction(claimed.actionType, finalParams, claimed.sourceMessage ?? '', creds, uid);
      isErr  = !!result?.error;
    } catch (execErr) {
      result = { error: execErr.message };
      isErr  = true;
    }

    await dbTransitionPendingAction(uid, id, 'processing', isErr ? 'error' : 'approved', result);
    memory.recordApprovedDraft(uid, JSON.stringify(claimed.params), JSON.stringify(finalParams), claimed.actionType);
    memory.logActivity(uid, claimed.actionType, finalParams, isErr ? 'error' : 'success', isErr ? result.error : null);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/actions/:id/reject', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  const { id } = req.params;
  try {
    const rejected = await dbTransitionPendingAction(uid, id, 'pending', 'rejected');
    if (!rejected) { await notActionable(uid, id, res); return; }

    memory.logActivity(uid, rejected.actionType, rejected.params, 'rejected');
    res.json({ rejected: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
