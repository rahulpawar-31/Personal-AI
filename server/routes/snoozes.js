import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dbListSnoozes, dbUpsertSnooze, dbRemoveSnooze, dbRemoveReturnedSnoozes } from '../services/db.js';
import { getUserTimezone } from '../lib/userTimezone.js';
import { validateSnoozeRequest, returnedCutoff } from '../lib/snooze.js';

const router = Router();

// The user's snoozes, past and future. Past ones are what the app marks "back
// from snooze"; any left unacted for a week are dropped here first.
router.get('/api/snoozes', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    await dbRemoveReturnedSnoozes(uid, returnedCutoff());
    res.json(await dbListSnoozes(uid));
  } catch (err) {
    console.error('[snoozes]', err);
    res.status(500).json({ error: 'Could not load your snoozed items' });
  }
});

// Body: { key, title, preset: 'later-today' | 'tomorrow' | 'custom', at? }.
router.put('/api/snoozes', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  let snooze;
  try {
    snooze = validateSnoozeRequest(req.body, { timezone: await getUserTimezone(uid) });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    res.json(await dbUpsertSnooze(uid, snooze));
  } catch (err) {
    console.error('[snoozes]', err);
    res.status(500).json({ error: 'Could not snooze that item' });
  }
});

// Bring an item back now, or clear its "back from snooze" mark after acting on
// it. The key goes in the body, not the URL: keys contain "/" and "#", which a
// proxy in front of the server can rewrite in a path.
router.delete('/api/snoozes', requireAuth, async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!key) return res.status(400).json({ error: 'Missing or invalid item' });
  try {
    await dbRemoveSnooze(req.user.userId, key);
    res.json({ ok: true });
  } catch (err) {
    console.error('[snoozes]', err);
    res.status(500).json({ error: 'Could not update that item' });
  }
});

export default router;
