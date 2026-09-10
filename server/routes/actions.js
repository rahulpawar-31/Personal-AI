import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds } from '../lib/creds.js';
import { executeAction } from '../lib/actions.js';
import { dbListPendingActions, dbGetPendingAction, dbResolvePendingAction } from '../services/db.js';
import memory from '../services/memory.js';

// Pending agent actions — state-changing tool calls the LangChain agent queued
// instead of running immediately (see SEC-2 remediation in langchain-agent.js).
// A human approves or rejects each one here before executeAction actually runs.

const router = Router();

router.get('/api/actions/pending', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    res.json(await dbListPendingActions(uid, 'pending'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/actions/:id/approve', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  const { id } = req.params;
  try {
    const pending = await dbGetPendingAction(uid, id);
    if (!pending) return res.status(404).json({ error: 'Pending action not found' });
    if (pending.status !== 'pending') return res.status(409).json({ error: `Already ${pending.status}` });

    const finalParams = { ...pending.params, ...(req.body?.edited ?? {}) };
    const creds  = await getUserCreds(uid);
    const result = await executeAction(pending.actionType, finalParams, pending.sourceMessage ?? '', creds, uid);
    const isErr  = !!result?.error;

    await dbResolvePendingAction(uid, id, isErr ? 'error' : 'approved', result);
    memory.recordApprovedDraft(uid, JSON.stringify(pending.params), JSON.stringify(finalParams), pending.actionType);
    memory.logActivity(uid, pending.actionType, finalParams, isErr ? 'error' : 'success', isErr ? result.error : null);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/actions/:id/reject', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  const { id } = req.params;
  try {
    const pending = await dbGetPendingAction(uid, id);
    if (!pending) return res.status(404).json({ error: 'Pending action not found' });
    if (pending.status !== 'pending') return res.status(409).json({ error: `Already ${pending.status}` });

    await dbResolvePendingAction(uid, id, 'rejected', null);
    memory.logActivity(uid, pending.actionType, pending.params, 'rejected');
    res.json({ rejected: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
