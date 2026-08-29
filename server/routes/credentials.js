import { Router } from 'express';
import OpenAI       from 'openai';
import * as integrations from '../services/integrations.js';
import { requireAuth } from '../middleware/auth.js';
import { credLimiter } from '../middleware/rateLimiter.js';

const router = Router();

function extractNotionId(input) {
  if (!input?.trim()) return null;
  const s = input.trim().replace(/-/g, '');
  const match = s.match(/[0-9a-f]{32}/i);
  return match ? match[0] : null;
}

// Strips zero-width/invisible Unicode characters users sometimes accidentally
// paste alongside an API key (zero-width space/joiners, BOM, soft hyphen, word
// joiner) — written as explicit \u escapes rather than literal invisible bytes
// so the source stays readable and can't be silently corrupted by an editor.
function sanitizeKey(raw) {
  return (raw ?? '').trim()
    .replace(/\u200b/g, '').replace(/\u200c/g, '').replace(/\u200d/g, '')
    .replace(/\ufeff/g, '').replace(/\xad/g, '').replace(/\u2060/g, '');
}

// ─── Integration key CRUD ─────────────────────────────────────────────────────

router.get('/api/integrations', requireAuth, async (req, res) => {
  try {
    res.json(await integrations.listKeysWithMeta(req.user.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/integrations', requireAuth, async (req, res) => {
  try {
    const { service, keyName, keyValue } = req.body;
    if (!service?.trim())  return res.status(400).json({ error: 'service is required' });
    if (!keyName?.trim())  return res.status(400).json({ error: 'keyName is required' });
    if (!keyValue?.trim()) return res.status(400).json({ error: 'keyValue is required' });
    await integrations.saveKey(req.user.userId, service.trim(), keyName.trim(), keyValue.trim());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/integrations/:service/:keyName', requireAuth, async (req, res) => {
  try {
    await integrations.deleteKey(req.user.userId, req.params.service, req.params.keyName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/integrations/:service', requireAuth, async (req, res) => {
  try {
    await integrations.deleteService(req.user.userId, req.params.service);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Credential test + save ────────────────────────────────────────────────────

router.post('/api/credentials/test/:service', requireAuth, credLimiter, async (req, res) => {
  const { service } = req.params;
  const body        = req.body ?? {};
  const uid         = req.user.userId;

  try {
    switch (service) {

      case 'gemini': {
        const geminiKey = sanitizeKey(body.key);
        if (!geminiKey) return res.status(400).json({ ok: false, error: 'API key is required' });
        if (!geminiKey.startsWith('AIza')) return res.status(400).json({ ok: false, error: 'Invalid format. Gemini keys start with AIza — get one at aistudio.google.com/apikey.' });
        const client = new OpenAI({ apiKey: geminiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
        try {
          await client.chat.completions.create({ model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'Reply with the single word OK' }], max_tokens: 10 });
        } catch (apiErr) {
          const status = apiErr?.status ?? apiErr?.response?.status;
          if (status === 429) {
            await integrations.saveKey(uid, 'gemini', 'GEMINI_API_KEY', geminiKey);
            return res.json({ ok: true, warning: 'Key saved. Gemini is rate-limited right now (free-tier quota). It will work once the limit resets.' });
          }
          const msg = apiErr?.error?.message || apiErr?.error?.error?.message || apiErr?.message || 'Gemini API request failed';
          return res.status(400).json({ ok: false, error: `Gemini: ${msg}` });
        }
        await integrations.saveKey(uid, 'gemini', 'GEMINI_API_KEY', geminiKey);
        return res.json({ ok: true });
      }

      case 'groq': {
        const groqKey = sanitizeKey(body.key);
        if (!groqKey) return res.status(400).json({ ok: false, error: 'API key is required' });
        if (!groqKey.startsWith('gsk_')) return res.status(400).json({ ok: false, error: 'Invalid format. Groq keys start with gsk_ — get one at console.groq.com/keys.' });
        const client = new OpenAI({ apiKey: groqKey, baseURL: 'https://api.groq.com/openai/v1' });
        try {
          await client.chat.completions.create({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Reply with the single word OK' }], max_tokens: 10 });
        } catch (apiErr) {
          const msg = apiErr?.error?.error?.message || apiErr?.message || 'Groq API request failed';
          return res.status(400).json({ ok: false, error: `Groq: ${msg}` });
        }
        await integrations.saveKey(uid, 'groq', 'GROQ_API_KEY', groqKey);
        return res.json({ ok: true });
      }

      case 'notion': {
        const notionKey = sanitizeKey(body.apiKey).replace(/\s+/g, '');
        const { taskDbId, notesDbId } = body;
        console.log(`[notion/test] received key prefix="${notionKey.slice(0, 15)}" len=${notionKey.length}`);
        if (!notionKey) return res.status(400).json({ ok: false, error: 'API key is required' });
        const cleanKey = notionKey.startsWith('secret_ntn_') ? notionKey.slice('secret_'.length) : notionKey;
        if (!cleanKey.startsWith('ntn_') && !cleanKey.startsWith('secret_')) {
          return res.status(400).json({ ok: false, error: `Wrong key format — received "${notionKey.slice(0, 12)}…". Copy the Access token from app.notion.com/developers/connections — it starts with ntn_` });
        }
        const meResp = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cleanKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_size: 1 }),
        });
        console.log(`[notion/test] Notion /search status=${meResp.status}`);
        if (!meResp.ok) {
          const e = await meResp.json().catch(() => ({}));
          console.error('[notion/test] Notion error:', e);
          const diag = `Server received: "${cleanKey.slice(0, 12)}…" (${cleanKey.length} chars). `;
          const hint = e.code === 'unauthorized' || meResp.status === 401
            ? 'Notion says the token is invalid. Try: notion.so/profile/integrations (new URL) or notion.so/my-integrations → open your integration → click "Show" next to the secret → copy it fresh. If this keeps failing, use "Save anyway" below.'
            : `Notion error: ${e.message || meResp.status}`;
          return res.status(400).json({ ok: false, error: diag + hint });
        }
        const resolvedTaskId  = extractNotionId(taskDbId);
        const resolvedNotesId = extractNotionId(notesDbId);
        for (const [label, dbId] of [['Tasks', resolvedTaskId], ['Notes', resolvedNotesId]]) {
          if (!dbId) continue;
          const dbResp = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
            headers: { 'Authorization': `Bearer ${cleanKey}`, 'Notion-Version': '2022-06-28' },
          });
          if (!dbResp.ok) {
            const e = await dbResp.json().catch(() => ({}));
            const msg = e.code === 'object_not_found'
              ? `${label} database not found. Open the database in Notion → click ··· → Connections → add your integration, then try again.`
              : `${label} database error: ${e.message || dbResp.status}`;
            return res.status(400).json({ ok: false, error: msg });
          }
        }
        await integrations.saveKey(uid, 'notion', 'NOTION_API_KEY', cleanKey);
        if (resolvedTaskId)  await integrations.saveKey(uid, 'notion', 'NOTION_TASKS_DB_ID',  resolvedTaskId);
        if (resolvedNotesId) await integrations.saveKey(uid, 'notion', 'NOTION_NOTES_DB_ID', resolvedNotesId);
        return res.json({ ok: true, meta: { userName: 'Integration' } });
      }

      case 'github': {
        const ghToken = sanitizeKey(body.token);
        const ghOwner = sanitizeKey(body.owner);
        const ghRepo  = sanitizeKey(body.repo);
        if (!ghToken) return res.status(400).json({ ok: false, error: 'Token is required' });
        if (!ghOwner) return res.status(400).json({ ok: false, error: 'Username / org is required' });
        if (!ghRepo)  return res.status(400).json({ ok: false, error: 'Repository name is required' });
        if (!ghToken.startsWith('ghp_') && !ghToken.startsWith('gho_') && !ghToken.startsWith('github_pat_') && !/^[0-9a-f]{40}$/i.test(ghToken)) {
          return res.status(400).json({ ok: false, error: 'Invalid token format. GitHub personal access tokens start with ghp_ (classic) or github_pat_ (fine-grained). Generate one at github.com/settings/tokens.' });
        }
        const resp = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          return res.status(400).json({ ok: false, error: e.message || `GitHub returned ${resp.status}` });
        }
        const ghUser = await resp.json();
        await integrations.saveKey(uid, 'github', 'GITHUB_TOKEN', ghToken);
        await integrations.saveKey(uid, 'github', 'GITHUB_OWNER', ghOwner);
        await integrations.saveKey(uid, 'github', 'GITHUB_REPO',  ghRepo);
        return res.json({ ok: true, meta: { username: ghUser.login } });
      }

      case 'trello': {
        const trelloKey     = sanitizeKey(body.apiKey);
        const trelloToken   = sanitizeKey(body.token);
        const trelloBoardId = sanitizeKey(body.boardId);
        if (!trelloKey || !trelloToken) return res.status(400).json({ ok: false, error: 'API key and token are required' });
        const resp = await fetch(`https://api.trello.com/1/members/me?key=${encodeURIComponent(trelloKey)}&token=${encodeURIComponent(trelloToken)}&boards=open`);
        if (!resp.ok) {
          const e = await resp.text().catch(() => '');
          return res.status(400).json({ ok: false, error: e || `Trello returned ${resp.status}` });
        }
        const trelloUser = await resp.json();
        if (trelloBoardId) {
          const boards = trelloUser.boards ?? [];
          const found  = boards.find(b => b.id === trelloBoardId || b.shortLink === trelloBoardId);
          if (!found) {
            const names = boards.map(b => b.name).join(', ') || 'none';
            return res.status(400).json({ ok: false, error: `Board not found. Your boards: ${names}` });
          }
          await integrations.saveKey(uid, 'trello', 'TRELLO_BOARD_ID', trelloBoardId);
        }
        await integrations.saveKey(uid, 'trello', 'TRELLO_API_KEY', trelloKey);
        await integrations.saveKey(uid, 'trello', 'TRELLO_TOKEN',   trelloToken);
        return res.json({ ok: true, meta: { fullName: trelloUser.fullName } });
      }

      case 'slack': {
        const slackToken  = sanitizeKey(body.botToken);
        const slackUserId = sanitizeKey(body.userId);
        if (!slackToken) return res.status(400).json({ ok: false, error: 'Bot token is required' });
        if (!slackToken.startsWith('xoxb-')) return res.status(400).json({ ok: false, error: 'Invalid format. Slack bot tokens start with xoxb- — get one at api.slack.com/apps → OAuth & Permissions.' });
        const resp = await fetch('https://slack.com/api/auth.test', {
          method: 'POST', headers: { 'Authorization': `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
        });
        const data = await resp.json();
        if (!data.ok) return res.status(400).json({ ok: false, error: data.error || 'Invalid Slack token' });
        await integrations.saveKey(uid, 'slack', 'SLACK_BOT_TOKEN', slackToken);
        if (slackUserId) await integrations.saveKey(uid, 'slack', 'SLACK_USER_ID', slackUserId);
        return res.json({ ok: true, meta: { teamName: data.team, botName: data.user } });
      }

      case 'linkedin': {
        const webhookUrl = sanitizeKey(body.webhookUrl);
        if (!webhookUrl) return res.status(400).json({ ok: false, error: 'Webhook URL is required' });
        if (!webhookUrl.startsWith('https://')) return res.status(400).json({ ok: false, error: 'Webhook URL must start with https://' });
        await integrations.saveKey(uid, 'linkedin', 'LINKEDIN_WEBHOOK_URL', webhookUrl);
        return res.json({ ok: true });
      }

      case 'todoist': {
        const todoistKey = sanitizeKey(body.key);
        if (!todoistKey) return res.status(400).json({ ok: false, error: 'API key is required' });
        if (todoistKey.length < 20) return res.status(400).json({ ok: false, error: 'Key looks too short. Paste the full API token from Todoist → Settings → Integrations → Developer.' });
        const resp = await fetch('https://api.todoist.com/api/v1/tasks', {
          headers: { Authorization: `Bearer ${todoistKey}` },
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          return res.status(400).json({ ok: false, error: e.error || e.message || `Todoist returned ${resp.status}` });
        }
        await integrations.saveKey(uid, 'todoist', 'TODOIST_API_KEY', todoistKey);
        return res.json({ ok: true });
      }

      default:
        return res.status(400).json({ ok: false, error: `Unknown service: ${service}` });
    }
  } catch (err) {
    console.error(`[credentials/test/${service}]`, err.message);
    return res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/api/credentials/save/notion', requireAuth, credLimiter, async (req, res) => {
  try {
    const uid       = req.user.userId;
    const raw       = sanitizeKey(req.body.apiKey ?? '').replace(/\s+/g, '');
    const notionKey = raw.startsWith('secret_ntn_') ? raw.slice('secret_'.length) : raw;
    const taskDbId  = extractNotionId(req.body.taskDbId  ?? '');
    const notesDbId = extractNotionId(req.body.notesDbId ?? '');
    if (!notionKey) return res.status(400).json({ ok: false, error: 'API key is required' });
    await integrations.saveKey(uid, 'notion', 'NOTION_API_KEY', notionKey);
    if (taskDbId)  await integrations.saveKey(uid, 'notion', 'NOTION_TASKS_DB_ID',  taskDbId);
    if (notesDbId) await integrations.saveKey(uid, 'notion', 'NOTION_NOTES_DB_ID', notesDbId);
    res.json({ ok: true, warning: 'Saved without verifying — if Notion features stay empty, the token or database IDs may be wrong.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
