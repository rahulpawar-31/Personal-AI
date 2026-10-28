import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { digestLimiter } from '../middleware/rateLimiter.js';
import { runDigest, getLatestDigest } from '../lib/digest.js';
import { dbGetBriefPrefs, dbSaveBriefPrefs } from '../services/db.js';
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
