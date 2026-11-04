import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dbGetAlertPrefs, dbSaveAlertPrefs, dbUnlinkTelegram } from '../services/db.js';
import * as memory from '../services/memory.js';
import { getUserCreds } from '../lib/creds.js';
import github from '../services/github.js';
import telegram from '../services/telegram.js';
import { startLink, completeLink } from '../lib/alerts.js';
import { validateAlertSettings, validateVipEmail } from '../lib/alertSettings.js';

const router = Router();

// What the Settings section shows: the two switches, whether the channel is
// available on this server and linked for this user, whether GitHub is connected
// (review alerts need it), and the VIP list.
async function settingsResponse(userId) {
  const [prefs, mem, creds] = await Promise.all([dbGetAlertPrefs(userId), memory.getMemory(userId), getUserCreds(userId)]);
  return {
    vipEnabled:    prefs?.vipEnabled ?? true,
    reviewEnabled: prefs?.reviewEnabled ?? true,
    telegram: { available: telegram.isConfigured(), connected: Boolean(prefs?.telegramChatId) },
    githubConnected: github.isConfigured(creds),
    vips: (mem.vipContacts ?? []).map(v => ({ email: v.email, name: v.name ?? '' })),
  };
}

router.get('/api/alerts/settings', requireAuth, async (req, res) => {
  try {
    res.json(await settingsResponse(req.user.userId));
  } catch (err) {
    console.error('[alerts/settings]', err);
    res.status(500).json({ error: 'Could not load your alert settings' });
  }
});

router.put('/api/alerts/settings', requireAuth, async (req, res) => {
  let patch;
  try {
    patch = validateAlertSettings(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await dbSaveAlertPrefs(req.user.userId, patch);
    res.json(await settingsResponse(req.user.userId));
  } catch (err) {
    console.error('[alerts/settings]', err);
    res.status(500).json({ error: 'Could not save your alert settings' });
  }
});

router.post('/api/alerts/vips', requireAuth, async (req, res) => {
  let email;
  try {
    email = validateVipEmail(req.body?.email);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    await memory.addVIP(req.user.userId, email, name);
    res.json(await settingsResponse(req.user.userId));
  } catch (err) {
    console.error('[alerts/vips]', err);
    res.status(500).json({ error: 'Could not add that VIP' });
  }
});

// The address goes in the body, not the URL, like the snooze keys: "@" and "+"
// in a path are easy for a proxy to rewrite.
router.delete('/api/alerts/vips', requireAuth, async (req, res) => {
  let email;
  try {
    email = validateVipEmail(req.body?.email);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await memory.removeVIP(req.user.userId, email);
    res.json(await settingsResponse(req.user.userId));
  } catch (err) {
    console.error('[alerts/vips]', err);
    res.status(500).json({ error: 'Could not remove that VIP' });
  }
});

// Starts linking Telegram: returns the link to open (it contains a one-time code
// that expires in a few minutes).
router.post('/api/alerts/telegram/link', requireAuth, async (req, res) => {
  if (!telegram.isConfigured()) {
    return res.status(503).json({ error: 'Telegram alerts are not set up on this server yet.' });
  }
  try {
    const code = await startLink(req.user.userId);
    res.json({ url: telegram.deepLink(code) });
  } catch (err) {
    console.error('[alerts/telegram]', err);
    res.status(500).json({ error: 'Could not start linking Telegram' });
  }
});

router.delete('/api/alerts/telegram', requireAuth, async (req, res) => {
  try {
    await dbUnlinkTelegram(req.user.userId);
    res.json(await settingsResponse(req.user.userId));
  } catch (err) {
    console.error('[alerts/telegram]', err);
    res.status(500).json({ error: 'Could not disconnect Telegram' });
  }
});

// Telegram calls this for every message sent to the bot. It is public, so the
// secret Telegram echoes back in a header is what proves the caller. Always
// answers 200 once authenticated: a non-200 makes Telegram retry the update.
router.post('/api/telegram/webhook', async (req, res) => {
  if (!telegram.webhookSecretMatches(req.get('x-telegram-bot-api-secret-token'))) {
    return res.status(401).json({ error: 'invalid secret' });
  }
  res.json({ ok: true });

  const start = telegram.parseStartCommand(req.body);
  if (!start) return;
  try {
    const userId = await completeLink(start);
    await telegram.sendMessage(start.chatId, userId !== null
      ? 'Connected. You will get alerts for VIP email and review requests here.'
      : 'That link has expired or was already used. Open Settings in the app and connect Telegram again.');
  } catch (err) {
    console.error('[telegram/webhook]', err.message);
  }
});

export default router;
