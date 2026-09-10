import { Router } from 'express';
import llm             from '../services/llm.js';
import memory          from '../services/memory.js';
import auth            from '../services/auth.js';
import todoist         from '../services/todoist.js';
import langchainAgent  from '../services/langchain-agent.js';
import { requireAuth } from '../middleware/auth.js';
import { chatLimiter } from '../middleware/rateLimiter.js';
import { getUserCreds, notionReady } from '../lib/creds.js';
import { dbCreatePendingAction } from '../services/db.js';
import {
  executeAction, preClassify, buildRoutingRules, AGENT_SCHEMA,
  ACTION_STATUS, TASK_ACTION_INTENTS, CALENDAR_ACTION_INTENTS,
  GITHUB_ACTION_INTENTS, EMAIL_ACTION_INTENTS, DIGEST_ACTION_INTENTS,
  QUERY_INTENTS_SET, CONFIRM_REQUIRED_INTENTS,
} from '../lib/actions.js';

const router = Router();

router.post('/api/chat', requireAuth, chatLimiter, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(obj) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    const creds = await getUserCreds(req.user.userId);
    const apiKeys = { GEMINI_API_KEY: creds.GEMINI_API_KEY, GROQ_API_KEY: creds.GROQ_API_KEY };

    const connectedTools = [
      notionReady(creds)                      && 'Notion (tasks & notes)',
      todoist.isConfigured(creds)             && 'Todoist (tasks)',
      auth.isConnected(req.user.userId)       && 'Gmail & Google Calendar',
      creds.SLACK_BOT_TOKEN  && 'Slack',
      creds.GITHUB_TOKEN     && 'GitHub',
      creds.TRELLO_API_KEY   && 'Trello',
    ].filter(Boolean).join(', ');

    const memContext = await memory.buildContextSummary(req.user.userId);

    send({ type: 'status', text: 'Thinking…' });

    const memContextLine = memContext ? ` User context: ${memContext}` : '';
    const classified = preClassify(message) ?? await llm.classify(
      `Today is ${new Date().toDateString()}. Connected tools: ${connectedTools}.${memContextLine}\n${buildRoutingRules()}\nUser message: "${message}"`,
      AGENT_SCHEMA,
      apiKeys
    );

    const actions = classified.actions ?? [];
    const isChat  = actions.length === 0 || (actions.length === 1 && actions[0].intent === 'general_chat');
    const intents = [];
    const results = [];

    if (!isChat) {
      const statusText = actions.map(a => ACTION_STATUS[a.intent] ?? 'Working…').join(' & ');
      send({ type: 'status', text: statusText });

      // Destructive/externally-visible writes (send/cancel/delete, and the
      // create/update actions called out in P4) never run straight off the
      // classifier's output — they queue as a pending_actions row and wait for
      // the user to approve or reject via the card the client renders from
      // GET /api/actions/pending (see ChatPanel.jsx PendingActionCard). This
      // mirrors the LangChain agent path's mkPending gate (langchain-agent.js)
      // so both chat engines honor the same confirmation requirement — P4/SEC-2.
      const settled = await Promise.allSettled(
        actions.map(async a => {
          if (CONFIRM_REQUIRED_INTENTS.has(a.intent)) {
            const pending = await dbCreatePendingAction(req.user.userId, a.intent, a.params ?? {}, message);
            return { pending: true, pendingId: pending.id };
          }
          return executeAction(a.intent, a.params ?? {}, message, creds, req.user.userId);
        })
      );
      settled.forEach((s, i) => {
        const intent = actions[i].intent;
        const params = actions[i].params ?? {};
        const result = s.status === 'fulfilled'
          ? (s.value ?? { error: 'Action returned no result' })
          : { error: s.reason?.message ?? 'Unknown error' };
        const isErr = s.status === 'rejected' || result?.error;
        const status = result?.pending ? 'pending' : (isErr ? 'error' : 'success');
        memory.logActivity(req.user.userId, intent, params, status, isErr ? (s.reason?.message ?? result?.error) : null);
        intents.push(intent);
        results.push(result);
      });
    }

    // affectedPanels only reflects intents that actually ran — a queued action
    // hasn't changed anything yet, so its panel shouldn't refresh as if it had.
    const executedIntents = intents.filter((_, i) => !results[i]?.pending);
    const queuedIntents   = intents.filter((_, i) => results[i]?.pending);

    const affectedPanels = [
      executedIntents.some(i => TASK_ACTION_INTENTS.has(i))     && 'tasks',
      executedIntents.some(i => CALENDAR_ACTION_INTENTS.has(i)) && 'calendar',
      executedIntents.some(i => GITHUB_ACTION_INTENTS.has(i))   && 'github',
      executedIntents.some(i => EMAIL_ACTION_INTENTS.has(i))    && 'comms',
      executedIntents.some(i => DIGEST_ACTION_INTENTS.has(i))   && 'digest',
    ].filter(Boolean);

    const needsSummary = intents.some(i => QUERY_INTENTS_SET.has(i));
    const failedResult = results.find(r => r?.error);
    // Never let the pre-execution classifier reply imply a queued action is
    // done — append an explicit note instead so the user knows to confirm it.
    const pendingNote = queuedIntents.length
      ? ` ${queuedIntents.map(i => (ACTION_STATUS[i] ?? i).replace(/…$/, '')).join(', ')} queued for your approval — confirm it below before it runs.`
      : '';

    if (results.length > 0 && failedResult) {
      send({ type: 'done', reply: `I ran into an issue: ${failedResult.error ?? 'unknown error'}${pendingNote}`, intents, affectedPanels });

    } else if (results.length > 0 && !needsSummary) {
      const baseReply = queuedIntents.length === intents.length ? 'Got it.' : (classified.reply ?? 'Done.');
      send({ type: 'done', reply: `${baseReply}${pendingNote}`, intents, affectedPanels });

    } else {
      send({ type: 'status', text: needsSummary ? 'Summarizing…' : 'Thinking…' });

      let summaryGuide;
      if (intents.includes('get_emails_range')) {
        summaryGuide = 'List each email as: **sender** — subject — one-line summary. Group by date. End with a total count. If the emails array is empty, say "No emails found for that period."';
      } else if (intents.includes('get_issues')) {
        summaryGuide = 'List each open issue with its number, title, and labels. End with a count. If the issues array is empty, say "No open issues."';
      } else if (intents.includes('get_prs')) {
        summaryGuide = 'List each PR with number, title, age, and reviewer. End with counts of open vs stale. If empty, say "No open pull requests."';
      } else if (intents.some(i => i === 'get_calendar' || i === 'get_tasks')) {
        summaryGuide = 'Report ONLY what is in the data provided. For calendar: list each event with its exact time and title. For tasks: list each task with its status. If an array is empty, explicitly say so (e.g. "No upcoming events", "No open tasks"). NEVER invent events, tasks, or names not present in the data.';
      } else {
        summaryGuide = 'Summarise clearly in 2-4 sentences using ONLY the data provided. Never invent details.';
      }

      let streamMessages;
      if (needsSummary) {
        const dataSummary = actions.map((a, i) =>
          `${a.intent}: ${results[i]?.pending ? 'queued for approval — not executed yet' : JSON.stringify(results[i])}`
        ).join('\n');
        streamMessages = [
          { role: 'system', content: `You are a data reporter. CRITICAL: Only report what exists in the JSON data below. Never invent, assume, or hallucinate any events, tasks, emails, names, or times. If a list is empty, say so clearly. ${summaryGuide}` },
          { role: 'user',   content: `User asked: "${message}"\nData:\n${dataSummary}` },
        ];
      } else {
        const memContextSuffix = memContext ? ` ${memContext}` : '';
        streamMessages = [
          { role: 'system', content: `You are DevOS, a personal AI agent. Connected tools: ${connectedTools}. Be concise and direct. IMPORTANT: You do NOT have access to the user's real calendar, emails, or tasks in this message — if the user asks what they have today or about specific data, tell them to ask again so the agent can fetch it, rather than guessing or making up any information.${memContextSuffix}` },
          ...history.slice(-6).map(m => ({ role: m.role, content: m.content })),
          { role: 'user',   content: message },
        ];
      }

      let fullReply = '';
      for await (const token of llm.streamTokens(streamMessages, { taskType: 'chat', maxTokens: 600, apiKeys })) {
        fullReply += token;
        send({ type: 'token', text: token });
      }
      if (pendingNote) {
        // Client prefers the concatenated 'token' stream over the final
        // 'reply' field once any tokens were sent, so the note has to be
        // streamed too, not just appended to the 'done' payload below.
        send({ type: 'token', text: pendingNote });
        fullReply += pendingNote;
      }
      send({ type: 'done', reply: fullReply, intents: intents.length ? intents : ['general_chat'], affectedPanels });
    }

  } catch (err) {
    console.error('[chat]', err);
    send({ type: 'error', text: err.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

router.post('/api/chat/agent', requireAuth, chatLimiter, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });
  try {
    const creds = await getUserCreds(req.user.userId);
    const connectedTools = [
      notionReady(creds)                && 'Notion (tasks & notes)',
      creds.TODOIST_API_KEY             && 'Todoist (tasks)',
      auth.isConnected(req.user.userId) && 'Gmail & Google Calendar',
      creds.SLACK_BOT_TOKEN  && 'Slack',
      creds.GITHUB_TOKEN     && 'GitHub',
      creds.TRELLO_API_KEY   && 'Trello',
    ].filter(Boolean).join(', ');

    const { reply, toolsUsed } = await langchainAgent.runAgent({
      message, history, creds, userId: req.user.userId,
      executeAction, connectedTools, memContext: await memory.buildContextSummary(req.user.userId),
    });

    toolsUsed.forEach(intent => memory.logActivity(req.user.userId, intent, {}, 'success', null));
    const affectedPanels = [
      toolsUsed.some(i => TASK_ACTION_INTENTS.has(i))     && 'tasks',
      toolsUsed.some(i => CALENDAR_ACTION_INTENTS.has(i)) && 'calendar',
      toolsUsed.some(i => GITHUB_ACTION_INTENTS.has(i))   && 'github',
      toolsUsed.some(i => EMAIL_ACTION_INTENTS.has(i))    && 'comms',
      toolsUsed.some(i => DIGEST_ACTION_INTENTS.has(i))   && 'digest',
    ].filter(Boolean);

    res.json({ reply, intents: toolsUsed.length ? toolsUsed : ['general_chat'], affectedPanels });
  } catch (err) {
    console.error('[chat/agent]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/chat/agent/clear', requireAuth, (req, res) => {
  langchainAgent.clearMemory(req.user.userId);
  res.json({ ok: true });
});

export default router;
