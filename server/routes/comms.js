import { Router } from 'express';
import auth     from '../services/auth.js';
import gmail    from '../services/gmail.js';
import calendar from '../services/calendar.js';
import memory   from '../services/memory.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds } from '../lib/creds.js';
import { getEmailCache, setEmailCache, invalidateEmailCache } from '../lib/email-cache.js';

const router = Router();

// ─── Email ────────────────────────────────────────────────────────────────────

router.get('/api/emails', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  if (!auth.isConnected(uid)) return res.json([]);
  const cached = await getEmailCache(uid);
  if (cached) return res.json(cached.data);
  try {
    const data = await gmail.triageInbox(uid, 15);
    await setEmailCache(uid, data);
    res.json(data);
  } catch (e) {
    if (e.code === 'GOOGLE_AUTH_REQUIRED') return res.status(401).json({ error: 'google_auth_required' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/email/:id', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  if (!auth.isConnected(uid)) return res.status(403).json({ error: 'Google not connected for this account' });
  try {
    const email = await gmail.getEmail(uid, req.params.id);
    if (!email) return res.status(404).json({ error: 'not found' });
    res.json(email);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/email/send', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    const { to, subject, body } = req.body;
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: 'valid "to" email required' });
    if (!body?.trim()) return res.status(400).json({ error: 'body required' });
    const result = await gmail.sendEmail(uid, to, subject ?? '(no subject)', body);
    memory.logActivity(uid, 'send_email', { to, title: subject }, 'success');
    console.log(`[email] sent to=${to} subject="${subject}"`);
    res.json(result);
  } catch (e) {
    console.error(`[email] send failed to=${req.body?.to}: ${e.message}`);
    memory.logActivity(uid, 'send_email', { to: req.body?.to, title: req.body?.subject }, 'error', e.message);
    res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }
});

router.post('/api/email/archive', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    invalidateEmailCache(uid);
    res.json(await gmail.archiveEmail(uid, req.body.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/email/approve-draft', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    const { to, subject, original, edited } = req.body;
    if (!to || !edited?.trim()) return res.status(400).json({ error: 'to and edited body are required' });
    invalidateEmailCache(uid);
    const sent = await gmail.sendEmail(uid, to, subject, edited);
    memory.recordApprovedDraft(uid, original, edited, 'email');
    memory.logActivity(uid, 'approve_draft', { to, title: subject }, 'success');
    console.log(`[email] draft approved and sent to=${to} subject="${subject}"`);
    res.json(sent);
  } catch (e) {
    console.error(`[email] approve-draft failed to=${req.body?.to}: ${e.message}`);
    memory.logActivity(uid, 'approve_draft', { to: req.body?.to }, 'error', e.message);
    res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }
});

// ─── Calendar ─────────────────────────────────────────────────────────────────

router.get('/api/calendar', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  if (!auth.isConnected(uid)) return res.json([]);
  try {
    res.json(await calendar.getUpcoming(uid, 10));
  } catch (e) {
    if (e.code === 'GOOGLE_AUTH_REQUIRED') return res.status(401).json({ error: 'google_auth_required' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/calendar', requireAuth, async (req, res) => {
  const uid = req.user.userId;
  try {
    const { title, date, duration = 60, description = '', recurring, days, time } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (recurring) {
      if (!days?.length) return res.status(400).json({ error: 'days array is required for recurring events' });
      if (!time)         return res.status(400).json({ error: 'time (HH:MM) is required for recurring events' });
      return res.json(await calendar.createRecurringEvent(uid, title, days, time, Number(duration), description));
    }
    if (!date) return res.status(400).json({ error: 'date is required for single events' });
    res.json(await calendar.createEvent(uid, title, date, Number(duration), description));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
