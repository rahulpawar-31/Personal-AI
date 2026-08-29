import cron     from 'node-cron';
import auth     from '../services/auth.js';
import gmail    from '../services/gmail.js';
import calendar from '../services/calendar.js';
import notion   from '../services/notion.js';
import github   from '../services/github.js';
import trello   from '../services/trello.js';
import slack    from '../services/slack.js';
import content  from '../services/content.js';
import { getUserCreds, notionReady } from './creds.js';

export const _digestCache = new Map(); // uid → digest

async function getTasksForDigest(creds) {
  if (notionReady(creds)) return notion.getTasks(creds);
  if (creds.TODOIST_API_KEY) {
    const todoist = (await import('../services/todoist.js')).default;
    return todoist.getTasks('today | overdue', creds);
  }
  return [];
}

async function _runDigest(userId = null) {
  console.log('[digest] starting all sub-agents...');
  const creds = userId ? await getUserCreds(userId) : {};

  const [commsResult, calendarResult, tasksResult, contentResult] = await Promise.allSettled([
    userId && auth.isConnected(userId)
      ? gmail.triageInbox(userId, 15).then(emails => ({
          pending:  emails.filter(e => e.priority !== 'P3'),
          archived: emails.filter(e => e.priority === 'P3').length,
        }))
      : Promise.resolve({ pending: [], archived: 0 }),

    userId && auth.isConnected(userId)
      ? Promise.all([
          calendar.getUpcoming(userId, 5),
          calendar.scanConflicts(userId),
        ]).then(([events, conflicts]) => ({ events, conflicts }))
      : Promise.resolve({ events: [], conflicts: [] }),

    Promise.all([
      getTasksForDigest(creds),
      github.forEachRepo(repo => github.scanStalePRs(repo, 3, creds), creds),
      trello.scanStaleCards(5, creds),
    ]).then(([tasks, stalePRs, staleCards]) => ({
      tasks,
      blockers: [
        ...stalePRs.map(p  => ({ type: 'pr',   title: p.title, id: p.id,  source: 'github' })),
        ...staleCards.map(c => ({ type: 'card', title: c.title, id: c.id,  source: 'trello' })),
      ],
    })),

    github.forEachRepo(repo => github.getMergedPRs(undefined, repo, creds), creds).then(async prs => {
      if (!prs.length) return { drafts: [] };
      const changelog = await content.draftChangelog(undefined, creds);
      return { drafts: [changelog] };
    }),
  ]);

  const digest = {
    comms:    commsResult.status    === 'fulfilled' ? commsResult.value    : { pending: [], archived: 0 },
    calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : { events: [], conflicts: [] },
    tasks:    tasksResult.status    === 'fulfilled' ? tasksResult.value    : { tasks: [], blockers: [] },
    content:  contentResult.status  === 'fulfilled' ? contentResult.value  : { drafts: [] },
    generatedAt: new Date().toISOString(),
  };

  console.log('[digest] complete —', {
    comms:     `${digest.comms.pending.length} pending`,
    conflicts: `${digest.calendar.conflicts.length} conflicts`,
    blockers:  `${digest.tasks.blockers.length} blockers`,
  });

  await slack.sendDigest(digest, creds);
  return digest;
}

export async function runDigest(userId = null) {
  const digest = await _runDigest(userId);
  if (userId !== null && userId !== undefined) _digestCache.set(String(userId), digest);
  return digest;
}

export function setupCronJobs() {
  cron.schedule('0 9 * * *', () => {
    console.log('[cron] 9 AM digest firing');
    for (const userId of auth.getConnectedUserIds()) {
      runDigest(userId).catch(console.error);
    }
  });

  cron.schedule('0 7 * * *', async () => {
    console.log('[cron] 7 AM calendar check');
    // Each user's calendar/Slack work is independent — run concurrently
    // instead of one user at a time; a per-user error stays isolated to that
    // user via the try/catch, same as before.
    await Promise.all(auth.getConnectedUserIds().map(async userId => {
      try {
        const creds    = await getUserCreds(userId);
        const conflicts = await calendar.scanConflicts(userId);
        if (conflicts.length) {
          await slack.sendAlert(
            `${conflicts.length} calendar conflict(s) today`,
            conflicts.map(c => `${c.eventA.title} ↔ ${c.eventB.title}`).join('\n'),
            'high',
            creds
          );
        }
        await calendar.blockFocusTime(userId);
      } catch (err) {
        console.error(`[cron/calendar] user ${userId}:`, err.message);
      }
    }));
  });

  // Pre-meeting briefs: every 5 min, check each connected user's next few
  // events for one starting in ~10 minutes and push a Slack brief. Dedup via
  // an in-memory set (resets on restart — worst case a brief re-sends once,
  // never worse) since events aren't otherwise persisted anywhere to key off.
  const briefedEvents = new Set();
  cron.schedule('*/5 * * * *', async () => {
    for (const userId of auth.getConnectedUserIds()) {
      try {
        const creds = await getUserCreds(userId);
        if (!creds.SLACK_BOT_TOKEN) continue; // nothing to deliver to — skip the LLM call
        const events = await calendar.getUpcoming(userId, 5);
        for (const event of events) {
          if (!event.start?.includes('T')) continue; // all-day event, no meeting time
          const minsUntil = (new Date(event.start) - Date.now()) / 60000;
          const key = `${userId}:${event.id}`;
          if (minsUntil < 8 || minsUntil > 13 || briefedEvents.has(key)) continue;
          briefedEvents.add(key);
          const { brief } = await calendar.generateMeetingBrief(event);
          if (!brief) continue;
          const lines = [
            `*${event.title}* starts in ${Math.round(minsUntil)} min`,
            ...(brief.keyPoints ?? []).map(p => `• ${p}`),
            brief.prepAction ? `_Prep: ${brief.prepAction}_` : null,
          ].filter(Boolean);
          await slack.sendAlert('Pre-meeting brief', lines.join('\n'), 'normal', creds);
        }
      } catch (err) {
        console.error(`[cron/meeting-brief] user ${userId}:`, err.message);
      }
    }
    // Bound memory — briefed keys older than a day are irrelevant since the
    // 8-13 min window means an event can only ever match once anyway.
    if (briefedEvents.size > 500) briefedEvents.clear();
  });
}
