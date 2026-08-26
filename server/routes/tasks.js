import { Router } from 'express';
import notion   from '../services/notion.js';
import todoist  from '../services/todoist.js';
import trello   from '../services/trello.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserCreds, notionReady } from '../lib/creds.js';

const router = Router();

// ─── Trello ───────────────────────────────────────────────────────────────────

router.get('/api/trello/board', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    if (!(creds.TRELLO_API_KEY && creds.TRELLO_TOKEN && creds.TRELLO_BOARD_ID))
      return res.json({ lists: [], cards: [] });
    const [lists, cards] = await Promise.all([trello.getLists(creds), trello.getCards(creds)]);
    res.json({ lists: lists ?? [], cards: cards ?? [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/trello/move', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    const { cardId, listId } = req.body;
    if (!cardId || !listId) return res.status(400).json({ error: 'cardId and listId required' });
    const result = await trello.moveCard(cardId, listId, creds);
    if (!result) return res.status(500).json({ error: 'Trello move failed' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    const [nr, tr] = await Promise.allSettled([
      notionReady(creds)          ? notion.getTasks(creds)  : Promise.resolve([]),
      // Merge active + recently-completed: Todoist's active-tasks endpoint
      // never returns closed tasks, so without this a task ticked Done would
      // vanish from the board entirely on the next refresh instead of staying
      // in the Done column (see getRecentlyCompleted in services/todoist.js).
      todoist.isConfigured(creds)
        ? Promise.all([todoist.getTasks('today | overdue', creds), todoist.getRecentlyCompleted(creds)])
            .then(([active, completed]) => [...active, ...completed])
        : Promise.resolve([]),
    ]);
    res.json({
      notion:  nr.status === 'fulfilled' ? nr.value : [],
      todoist: tr.status === 'fulfilled' ? tr.value : [],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const trimmed = title.trim();
    const creds = await getUserCreds(req.user.userId);
    if (notionReady(creds)) {
      const [notionTask] = await Promise.all([
        notion.createTask(trimmed, 'Not started', creds),
        todoist.createTask(trimmed, 'today', creds).catch(err => console.error('[todoist sync]', err.message)),
      ]);
      return res.json(notionTask);
    }
    const task = await todoist.createTask(trimmed, 'today', creds);
    if (!task) return res.status(500).json({ error: 'Failed to create task in Todoist' });
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/task/update', requireAuth, async (req, res) => {
  try {
    const { id, status, source } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const creds = await getUserCreds(req.user.userId);
    const isTodoist = source === 'todoist' || /^\d+$/.test(id);
    const result = isTodoist
      ? await todoist.updateTaskStatus(id, status, creds)
      : await notion.updateTaskStatus(id, status, creds);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Notes ────────────────────────────────────────────────────────────────────

router.get('/api/notes', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    if (!notionReady(creds)) return res.status(404).json({ error: 'Notion not configured' });
    res.json(await notion.getNotes(creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/notes', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    if (!notionReady(creds)) return res.status(400).json({ error: 'Notion not configured — add your API key in Settings' });
    const { title, body = '' } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    res.json(await notion.createNote(title.trim(), body, creds));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/notes/export', requireAuth, async (req, res) => {
  try {
    const creds = await getUserCreds(req.user.userId);
    if (!notionReady(creds)) return res.status(400).json({ error: 'Notion not configured' });
    const files = await notion.exportNotesAsMarkdown(creds);
    res.json({ files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
