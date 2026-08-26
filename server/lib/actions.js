import llm      from '../services/llm.js';
import notion   from '../services/notion.js';
import gmail    from '../services/gmail.js';
import calendar from '../services/calendar.js';
import github   from '../services/github.js';
import trello   from '../services/trello.js';
import content  from '../services/content.js';
import todoist  from '../services/todoist.js';
import memory   from '../services/memory.js';
import { runDigest, _digestCache } from './digest.js';
import { notionReady } from './creds.js';

// ─── Intent sets ─────────────────────────────────────────────────────────────

export const TASK_ACTION_INTENTS     = new Set(['add_task', 'update_task', 'delete_task', 'get_tasks']);
export const CALENDAR_ACTION_INTENTS = new Set(['create_event', 'update_event', 'delete_event', 'get_calendar', 'scan_conflicts', 'block_focus_time']);
export const GITHUB_ACTION_INTENTS   = new Set(['create_issue', 'delete_issue', 'close_issue', 'reopen_issue', 'update_issue', 'comment_issue', 'close_pr', 'get_issues', 'get_prs']);
export const EMAIL_ACTION_INTENTS    = new Set(['draft_email', 'send_email', 'get_emails', 'get_emails_range', 'archive_email']);
export const DIGEST_ACTION_INTENTS   = new Set(['run_digest', 'get_digest']);
export const QUERY_INTENTS_SET       = new Set(['get_tasks','get_emails','get_emails_range','get_calendar','get_notes','get_prs','get_trello','get_digest','get_issues']);

export const ACTION_STATUS = {
  add_task:         'Adding task…',
  update_task:      'Updating task…',
  delete_task:      'Deleting task…',
  get_tasks:        'Fetching tasks…',
  create_note:      'Creating note…',
  get_notes:        'Fetching notes…',
  draft_email:      'Drafting email…',
  send_email:       'Sending email…',
  get_emails:       'Checking inbox…',
  get_emails_range: 'Fetching emails…',
  archive_email:    'Archiving email…',
  create_event:     'Creating calendar event…',
  update_event:     'Updating event…',
  delete_event:     'Deleting event…',
  get_calendar:     'Checking calendar…',
  scan_conflicts:   'Scanning for conflicts…',
  block_focus_time: 'Blocking focus time…',
  get_prs:          'Fetching pull requests…',
  get_issues:       'Fetching issues…',
  create_issue:     'Creating issue…',
  close_issue:      'Closing issue…',
  run_digest:       'Running digest…',
  draft_linkedin:   'Drafting LinkedIn post…',
  get_trello:       'Fetching Trello board…',
  general_chat:     'Thinking…',
};

// ─── Schema ───────────────────────────────────────────────────────────────────

export const AGENT_SCHEMA = `{"actions":[{"intent":"add_task|update_task|delete_task|get_tasks|create_note|get_notes|draft_email|send_email|get_emails|get_emails_range|archive_email|create_event|update_event|delete_event|get_calendar|scan_conflicts|block_focus_time|get_prs|get_issues|create_issue|delete_issue|close_issue|reopen_issue|update_issue|comment_issue|close_pr|get_trello|run_digest|get_digest|add_vip|save_memory|draft_linkedin|general_chat","params":{"title":null,"body":null,"to":null,"date":null,"startDate":null,"endDate":null,"duration":null,"status":null,"taskId":null,"email":null,"source":null,"memKey":null,"memValue":null,"labels":null,"repo":null,"recurring":false,"days":null,"time":null}}],"reply":"brief reply"}`;

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function buildDateAnchors() {
  const now  = new Date();
  const iso  = d => d.toISOString().slice(0, 10);
  const add  = n => new Date(now.getTime() + n * 86400000);
  const prevWeekday = wday => {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() - wday + 7) % 7 || 7));
    return d;
  };
  return [
    `today=${iso(now)}`,
    `yesterday=${iso(add(-1))}`,
    `2_days_ago=${iso(add(-2))}`,
    `3_days_ago=${iso(add(-3))}`,
    `7_days_ago=${iso(add(-7))}`,
    `30_days_ago=${iso(add(-30))}`,
    `last_monday=${iso(prevWeekday(1))}`,
    `last_friday=${iso(prevWeekday(5))}`,
  ].join(', ');
}

export function buildRoutingRules() {
  return `
ROUTING RULES (follow exactly):
- "what do I have today / what's on today / show my day / what's my schedule" → TWO actions: get_calendar AND get_tasks (both in the actions array)
- "show my calendar / upcoming events / what meetings do I have" → intent:get_calendar
- "show my tasks / open tasks / todo list" → intent:get_tasks
- "add task / todo / reminder" → intent:add_task → Todoist only
- "add note / write note / save note" → intent:create_note → Notion only
- "read emails from <date>" → intent:get_emails_range, resolve dates using anchors: ${buildDateAnchors()}
- "add event tomorrow at 3pm / on May 20 at 2pm" → intent:create_event, date must be ISO format YYYY-MM-DDTHH:MM using date anchors above; duration in minutes
- "add event on Monday and Wednesday at 3pm" → intent:create_event, set recurring:true, days:[1,3] (Mon=1,Tue=2,Wed=3,Thu=4,Fri=5,Sat=6,Sun=7), time:"15:00", title
- "create issue in <repo>" → intent:create_issue, set repo to EXACTLY the repo name mentioned; NEVER create in a repo not mentioned
- "issues in <repo> / summary of <repo>" → intent:get_issues, set repo to the repo mentioned
- NEVER guess a repo; if no repo is mentioned and multiple are configured, ask the user which repo
- "delete event X / cancel meeting X" → intent:delete_event, title:X
- "reschedule event X to tomorrow at 3pm" → intent:update_event, title:X (to find it), date:ISO, duration optional
- "rename event X to Y" → intent:update_event, title:X, body:Y (body = new title)
- "delete task / remove task" → intent:delete_task, taskId if known, else title to search
- "rename task X to Y" → intent:update_task, taskId:X, title:Y
- "delete issue #N / remove issue #N / permanently delete issue #N" → intent:delete_issue, taskId:N (number only), repo; this uses GraphQL to truly delete
- "close issue #N" → intent:close_issue, taskId:N, repo (keeps issue, just closes it)
- "reopen issue #N" → intent:reopen_issue, taskId:N, repo
- "update issue #N title/body/labels" → intent:update_issue, taskId:N, title/body/labels, repo
- "comment on issue #N: ..." → intent:comment_issue, taskId:N, body:comment, repo
- "close PR #N / delete PR #N" → intent:close_pr, taskId:N, repo
- NEVER respond with general_chat for any GitHub issue/PR action — always use the correct intent
- NEVER respond with general_chat when the user asks about their calendar, tasks, emails, or PRs — always use the correct data-fetching intent`.trim();
}

export function resolveDate(raw) {
  if (!raw) return null;
  const direct = new Date(raw);
  if (!isNaN(direct)) return direct.toISOString();

  const s   = String(raw).toLowerCase().trim();
  const now = new Date();
  const add = n => new Date(now.getTime() + n * 86400000);

  const relMap = { 'today': now, 'tomorrow': add(1), 'yesterday': add(-1) };
  for (const [kw, d] of Object.entries(relMap)) {
    if (s.includes(kw)) {
      const time = extractTime(s);
      if (time) d.setHours(time.h, time.m, 0, 0);
      else      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }

  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (s.includes(days[i])) {
      const d    = new Date(now);
      const diff = (i - now.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      const time = extractTime(s);
      if (time) d.setHours(time.h, time.m, 0, 0);
      else      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
  return null;
}

function extractTime(s) {
  const m12 = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const min = parseInt(m12[2] ?? '0');
    if (m12[3].toLowerCase() === 'pm' && h !== 12) h += 12;
    if (m12[3].toLowerCase() === 'am' && h === 12) h = 0;
    return { h, m: min };
  }
  const m24 = s.match(/(\d{1,2}):(\d{2})/);
  if (m24) return { h: parseInt(m24[1]), m: parseInt(m24[2]) };
  return null;
}

function extractIssueBody(message, title) {
  const mdStart = message.search(/##\s+\w/);
  if (mdStart > 0) return message.slice(mdStart).trim();
  return message
    .replace(/^creates?\s+(?:a\s+)?(?:github\s+)?issue(?:\s+in\s+\S+)?[^:]*:\s*/i, '')
    .replace(new RegExp(`^#?\\s*Issue\\s*\\d*\\s*:?\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    .replace(/^\*\*Labels:\*\*[^\n]*\n?/im, '')
    .trim() || message;
}

// ─── Pre-classifier ───────────────────────────────────────────────────────────

export function preClassify(message) {
  const m = message.toLowerCase().trim();
  const acts = (...intents) => ({ actions: intents.map(intent => ({ intent, params: {} })), reply: '' });

  if (/what.*(do i have|'?s on|s on).*(today|this week)|show.*(my day|today'?s?|schedule)|today.*(schedule|plan|agenda|on)|what'?s? (up|happening) today|what'?s? my (schedule|day|plan)/i.test(m))
    return acts('get_calendar', 'get_tasks');
  if (/show.*(my )?(calendar|events?|meetings?)|upcoming (events?|meetings?)|what.*(meetings?|events?).*(today|this week|tomorrow)|check.*(calendar|schedule)/i.test(m))
    return acts('get_calendar');
  if (/show.*(my )?(tasks?|todos?|to-dos?)|what.*(tasks?|todos?).*have|open tasks?|list.*tasks?/i.test(m))
    return acts('get_tasks');
  if (/show.*(my )?(emails?|inbox)|check.*(emails?|inbox)|any.*(urgent|unread|new).*(emails?|messages?)|what.*emails?/i.test(m))
    return acts('get_emails');
  if (/show.*(my )?(open )?(prs?|pull requests?)|open prs?|any.*(prs?|pull requests?)/i.test(m))
    return acts('get_prs');
  if (/show.*(my |open )?(github )?issues?|open issues?|list.*issues?/i.test(m))
    return acts('get_issues');
  if (/run.*(digest|briefing)|morning (digest|brief|summary)|daily (digest|brief)/i.test(m))
    return acts('run_digest');
  if (/(get|show|latest|today'?s?).*(digest|briefing)|what'?s? (the |my )?(digest|briefing)/i.test(m))
    return acts('get_digest');
  return null;
}

// ─── Action executor ──────────────────────────────────────────────────────────

export async function executeAction(intent, params, originalMessage = '', creds = {}, userId = null) {
  const apiKeys = { GEMINI_API_KEY: creds.GEMINI_API_KEY, GROQ_API_KEY: creds.GROQ_API_KEY };

  switch (intent) {

    case 'add_task': {
      if (!params.title?.trim()) return { error: 'Could not extract a task title from your message — please try again with a clear title.' };
      if (todoist.isConfigured(creds)) return await todoist.createTask(params.title.trim(), 'today', creds);
      if (notionReady(creds))          return await notion.createTask(params.title.trim(), 'Not started', creds);
      return { error: 'No task service configured. Add a Todoist or Notion key in Settings.' };
    }

    case 'update_task': {
      if (!params.taskId) return { error: 'taskId is required' };
      const isTodoist = /^\d+$/.test(params.taskId) || params.source === 'todoist';
      if (params.status && !params.title) {
        return isTodoist
          ? await todoist.updateTaskStatus(params.taskId, params.status, creds)
          : await notion.updateTaskStatus(params.taskId, params.status, creds);
      }
      const patches = {};
      if (params.title)  patches.title  = params.title;
      if (params.status) patches.status = params.status;
      return isTodoist
        ? await todoist.updateTask(params.taskId, patches, creds)
        : await notion.updateTask(params.taskId, patches, creds);
    }

    case 'get_tasks': {
      const [nt, tt] = await Promise.all([
        notionReady(creds)          ? notion.getTasks(creds)  : [],
        todoist.isConfigured(creds) ? todoist.getTasks('today | overdue', creds) : [],
      ]);
      return { notion: nt, todoist: tt };
    }

    case 'delete_task': {
      if (!params.taskId) return { error: 'taskId is required' };
      const isTodoist = /^\d+$/.test(params.taskId) || params.source === 'todoist';
      return isTodoist
        ? await todoist.deleteTask(params.taskId, creds)
        : await notion.deleteTask(params.taskId, creds);
    }

    case 'create_note':
      if (!params.title) return null;
      if (!notionReady(creds)) return { error: 'Notion is not configured' };
      return await notion.createNote(params.title, params.body ?? '', creds);

    case 'get_notes':
      return { notes: await notion.getNotes(creds) };

    case 'get_emails':
      return { emails: await gmail.triageInbox(userId, 10) };

    case 'get_emails_range': {
      const { startDate, endDate } = params;
      if (!startDate) return { error: 'startDate is required' };
      const emails = await gmail.getEmailsByDateRange(userId, startDate, endDate ?? new Date().toISOString().slice(0, 10));
      return { emails, count: emails.length, range: { startDate, endDate } };
    }

    case 'draft_email':
      if (params.to && params.body) {
        return await gmail.createDraft(userId, params.to, params.title ?? 'No subject', params.body);
      }
      return null;

    case 'send_email':
      if (params.to && params.body) {
        return await gmail.sendEmail(userId, params.to, params.title ?? 'No subject', params.body);
      }
      return null;

    case 'archive_email':
      return params.taskId ? await gmail.archiveEmail(userId, params.taskId) : null;

    case 'create_event': {
      if (!params.title) return { error: 'title is required' };
      if (params.recurring && params.days?.length && params.time) {
        return await calendar.createRecurringEvent(userId, params.title, params.days, params.time, params.duration ?? 60);
      }
      if (params.date) {
        const resolved = resolveDate(params.date);
        if (!resolved) return { error: `Could not parse date "${params.date}". Use format: YYYY-MM-DDTHH:MM` };
        console.log(`[create_event] title="${params.title}" raw="${params.date}" resolved="${resolved}"`);
        return await calendar.createEvent(userId, params.title, resolved, params.duration ?? 60);
      }
      return { error: 'Provide a date for a single event, or days + time for a recurring event.' };
    }

    case 'delete_event': {
      const target = params.title || params.taskId;
      if (!target) return { error: 'Provide the event name to delete' };
      return await calendar.deleteEvent(userId, target);
    }

    case 'update_event': {
      const target = params.title || params.taskId;
      if (!target) return { error: 'Provide the event name to update' };
      const patches = {};
      if (params.body)     patches.title    = params.body;
      if (params.date)     patches.date     = resolveDate(params.date) ?? params.date;
      if (params.duration) patches.duration = Number(params.duration);
      return await calendar.updateEvent(userId, target, patches);
    }

    case 'get_calendar':
      return { events: await calendar.getUpcoming(userId, 5) };

    case 'scan_conflicts':
      return { conflicts: await calendar.scanConflicts(userId) };

    case 'block_focus_time':
      return { blocks: await calendar.blockFocusTime(userId, params.title ?? 'Deep work') };

    case 'get_prs':
      return { prs: await github.getOpenPRs(params.repo, creds), stale: await github.scanStalePRs(3, params.repo, creds) };

    case 'create_issue': {
      if (!params.title) return { error: 'title is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) {
        return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      }
      const labels = Array.isArray(params.labels)
        ? params.labels.map(l => String(l).trim()).filter(Boolean)
        : params.labels ? String(params.labels).split(',').map(l => l.trim()).filter(Boolean) : [];
      const userContext = extractIssueBody(originalMessage, params.title);
      const body = await llm.generate(
        `Write a detailed GitHub issue body in markdown for the issue titled: "${params.title}"\n\nUser context: ${userContext}\n\n` +
        `Structure it with these sections (use only the ones that apply):\n` +
        `## Summary\n## Goals\n## Suggested approach\n## Tests\n## Considerations\n\n` +
        `Use bullet points. Be specific and actionable. Do not repeat the title. Output only the markdown body.`,
        '', 'content', apiKeys
      ).catch(() => userContext);
      return await github.createIssue(params.title, body, labels, params.repo, creds);
    }

    case 'get_issues': {
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) {
        return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      }
      return { issues: await github.getIssues('open', params.repo, creds), repo: params.repo };
    }

    case 'delete_issue': {
      if (!params.taskId) return { error: 'Issue number is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      return await github.deleteIssue(params.taskId, params.repo, creds);
    }

    case 'close_issue': {
      if (!params.taskId) return { error: 'Issue number (taskId) is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      try {
        return await github.closeIssue(params.taskId, params.repo, creds);
      } catch (err) {
        const open = await github.getIssues('open', params.repo, creds).catch(() => []);
        const list = open.length ? open.map(i => `#${i.id} ${i.title}`).join(', ') : 'none';
        return { error: `Issue #${params.taskId} not found. Open issues: ${list}` };
      }
    }

    case 'reopen_issue': {
      if (!params.taskId) return { error: 'Issue number (taskId) is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      return await github.reopenIssue(params.taskId, params.repo, creds);
    }

    case 'update_issue': {
      if (!params.taskId) return { error: 'Issue number (taskId) is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      const patches = {};
      if (params.title)  patches.title  = params.title;
      if (params.body)   patches.body   = params.body;
      if (params.labels) patches.labels = Array.isArray(params.labels) ? params.labels : String(params.labels).split(',').map(l => l.trim());
      if (params.status) patches.state  = params.status === 'closed' ? 'closed' : 'open';
      return await github.updateIssue(params.taskId, patches, params.repo, creds);
    }

    case 'comment_issue': {
      if (!params.taskId || !params.body) return { error: 'Issue number and comment body are required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      return await github.commentOnIssue(params.taskId, params.body, params.repo, creds);
    }

    case 'close_pr': {
      if (!params.taskId) return { error: 'PR number (taskId) is required' };
      const repos = github.getRepos(creds);
      if (!params.repo && repos.length > 1) return { error: `Which repo? Available: ${repos.map(r => r.split('/')[1]).join(', ')}` };
      return await github.closePR(params.taskId, params.repo, creds);
    }

    case 'get_trello':
      return { cards: await trello.getCards(creds), stale: await trello.scanStaleCards(5, creds) };

    case 'run_digest':
      runDigest(userId).catch(console.error);
      return { triggered: true, message: 'Digest is running in the background.' };

    case 'get_digest':
      return _digestCache.get(String(userId)) ?? { message: 'No digest yet — run one first.' };

    case 'add_vip':
      return params.email ? { vips: await memory.addVIP(userId, params.email) } : null;

    case 'save_memory': {
      if (!params.memKey || !params.memValue) return null;
      const facts = await memory.saveFact(userId, params.memKey, params.memValue);
      return { saved: true, key: params.memKey, value: params.memValue, totalFacts: facts.length };
    }

    case 'draft_linkedin':
      return params.source ? await content.draftLinkedInPost(params.source, userId) : null;

    default:
      return null;
  }
}
