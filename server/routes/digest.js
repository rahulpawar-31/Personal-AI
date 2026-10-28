import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { digestLimiter } from '../middleware/rateLimiter.js';
import { runDigest, getLatestDigest } from '../lib/digest.js';
import { runWrapup, getLatestWrapup, withoutOpenTask, nextDate } from '../lib/wrapup.js';
import { dbGetBriefPrefs, dbSaveBriefPrefs, dbSaveWrapup } from '../services/db.js';
import { getUserCreds } from '../lib/creds.js';
import todoist from '../services/todoist.js';
import { effectiveSettings, validateBriefSettings, serverTimezone } from '../lib/briefSchedule.js';

const router = Router();

// Only the Slack page asks for `sendToSlack`; running the digest from Today
// just refreshes what the app shows.
router.post('/api/digest/run', requireAuth, digestLimiter, async (req, res) => {
  try {
    const digest = await runDigest(req.user.userId, { sendToSlack: req.body?.sendToSlack === true });
    res.json(digest);
  } catch (err) {
    console.error('[digest/run]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/digest/latest', requireAuth, async (req, res) => {
  try {
    res.json(await getLatestDigest(req.user.userId));
  } catch (err) {
    console.error('[digest/latest]', err);
    res.status(500).json({ error: 'Could not load your latest digest' });
  }
});

// ─── End-of-day wrap-up ───────────────────────────────────────────────────────

// Turning the wrap-up off in Settings hides the card; the saved one is kept.
router.get('/api/wrapup/latest', requireAuth, async (req, res) => {
  try {
    const prefs = effectiveSettings(await dbGetBriefPrefs(req.user.userId));
    res.json(prefs.wrapupEnabled ? await getLatestWrapup(req.user.userId) : null);
  } catch (err) {
    console.error('[wrapup/latest]', err);
    res.status(500).json({ error: 'Could not load your latest wrap-up' });
  }
});

// Builds a wrap-up now and shows it in the app. It does not post to Slack.
router.post('/api/wrapup/run', requireAuth, digestLimiter, async (req, res) => {
  try {
    res.json(await runWrapup(req.user.userId));
  } catch (err) {
    console.error('[wrapup/run]', err);
    res.status(500).json({ error: 'Could not build your wrap-up' });
  }
});

// One move at a time per user. Each move reads the saved wrap-up and writes it
// back, so two overlapping moves would let the later write bring back a task the
// earlier one had dropped.
const moveQueues = new Map();
function inQueue(key, job) {
  const run = (moveQueues.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  moveQueues.set(key, tail);
  tail.then(() => { if (moveQueues.get(key) === tail) moveQueues.delete(key); });
  return run;
}

// Moves one still-open Todoist task to the day after the wrap-up's date (not
// after the day the button is pressed), then drops it from the saved wrap-up so
// a reload does not offer it again.
router.post('/api/wrapup/move-to-tomorrow', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  const taskId = typeof req.body?.taskId === 'string' || typeof req.body?.taskId === 'number' ? String(req.body.taskId) : '';
  if (!taskId) return res.status(400).json({ error: 'taskId is required' });
  try {
    const result = await inQueue(String(uid), async () => {
      const saved = await getLatestWrapup(uid);
      const item  = saved?.open?.find(t => String(t.id) === taskId);
      if (!item?.canMove) return { status: 400, body: { error: 'That task cannot be moved to tomorrow' } };
      const moved = await todoist.updateTask(taskId, { dueDate: nextDate(saved.date) }, await getUserCreds(uid));
      if (!moved) return { status: 400, body: { error: 'Todoist is not connected' } };
      const next = withoutOpenTask(saved, taskId);
      await dbSaveWrapup(uid, next);
      return { status: 200, body: next };
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[wrapup/move]', err);
    res.status(500).json({ error: 'Could not move that task' });
  }
});

// What the Settings page shows. `timezoneSaved` is false until the user (or the
// page, on first visit) saves one; until then briefs follow the server's zone.
function briefSettingsResponse(row) {
  const settings = effectiveSettings(row);
  return { ...settings, timezoneSaved: Boolean(settings.timezone), serverTimezone: serverTimezone() };
}

router.get('/api/digest/settings', requireAuth, async (req, res) => {
  try {
    res.json(briefSettingsResponse(await dbGetBriefPrefs(req.user.userId)));
  } catch (err) {
    console.error('[digest/settings]', err);
    res.status(500).json({ error: 'Could not load your brief settings' });
  }
});

router.put('/api/digest/settings', requireAuth, async (req, res) => {
  let patch;
  try {
    patch = validateBriefSettings(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    res.json(briefSettingsResponse(await dbSaveBriefPrefs(req.user.userId, patch)));
  } catch (err) {
    console.error('[digest/settings]', err);
    res.status(500).json({ error: 'Could not save your brief settings' });
  }
});

export default router;
