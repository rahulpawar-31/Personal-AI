import { Router } from 'express';
import slack   from '../services/slack.js';
import trello  from '../services/trello.js';
import content from '../services/content.js';
import memory  from '../services/memory.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds } from '../lib/creds.js';

const router = Router();

router.post('/api/slack/send', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });
    const creds = await getUserCreds(req.user.userId);
    const ts = await slack.sendDM(text.trim(), creds);
    res.json({ ok: Boolean(ts), ts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/cards', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    res.json(await trello.getCards(creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/memory', requireAuth, async (req, res) => {
  res.json(await memory.getMemory(req.user.userId));
});

router.get('/api/activity', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  res.json(await memory.getActivityLog(req.user.userId, limit));
});

router.post('/api/memory/vip', requireAuth, async (req, res) => {
  res.json({ vips: await memory.addVIP(req.user.userId, req.body.email, req.body.name) });
});

router.get('/api/content/linkedin/history', requireAuth, async (req, res) => {
  const { voiceProfile } = await memory.getMemory(req.user.userId);
  const posts = voiceProfile.approvedDrafts
    .filter(d => d.type === 'linkedin')
    .slice(-20)
    .reverse();
  res.json(posts);
});

router.post('/api/content/linkedin', requireAuth, async (req, res) => {
  try {
    res.json(await content.draftLinkedInPost(req.body.source, req.user.userId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/content/approve', requireAuth, async (req, res) => {
  const { original, edited, type = 'linkedin', postNow = false } = req.body;
  await memory.recordApprovedDraft(req.user.userId, original, edited, type);

  let posted = false;
  if (postNow) {
    const creds = await getUserCreds(req.user.userId);
    const webhookUrl = creds.LINKEDIN_WEBHOOK_URL || process.env.LINKEDIN_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const hook = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: edited, type }),
        });
        posted = hook.ok;
        if (!hook.ok) console.error('[linkedin webhook] status:', hook.status);
      } catch (err) {
        console.error('[linkedin webhook]', err.message);
      }
    }
  }

  res.json({ ok: true, posted });
});

export default router;
