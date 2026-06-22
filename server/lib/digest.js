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
      notionReady(creds) ? notion.getTasks(creds) : (
        creds.TODOIST_API_KEY
          ? (await import('../services/todoist.js')).default.getTasks('today | overdue', creds)
          : []
      ),
      github.scanStalePRs(3, undefined, creds),
      trello.scanStaleCards(5, creds),
    ]).then(([tasks, stalePRs, staleCards]) => ({
      tasks,
      blockers: [
        ...stalePRs.map(p  => ({ type: 'pr',   title: p.title, id: p.id,  source: 'github' })),
        ...staleCards.map(c => ({ type: 'card', title: c.title, id: c.id,  source: 'trello' })),
      ],
    })),

    github.getMergedPRs(undefined, undefined, creds).then(async prs => {
      if (!prs.length) return { drafts: [] };
      const changelog = await content.draftChangelog();
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
    comms:     digest.comms.pending.length     + ' pending',
    conflicts: digest.calendar.conflicts.length + ' conflicts',
    blockers:  digest.tasks.blockers.length    + ' blockers',
  });

  await slack.sendDigest(digest);
  return digest;
}

export async function runDigest(userId = null) {
  const digest = await _runDigest(userId);
  if (userId != null) _digestCache.set(String(userId), digest);
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
    for (const userId of auth.getConnectedUserIds()) {
      try {
        const conflicts = await calendar.scanConflicts(userId);
        if (conflicts.length) {
          await slack.sendAlert(
            `${conflicts.length} calendar conflict(s) today`,
            conflicts.map(c => `${c.eventA.title} ↔ ${c.eventB.title}`).join('\n'),
            'high'
          );
        }
        await calendar.blockFocusTime(userId);
      } catch (err) {
        console.error(`[cron/calendar] user ${userId}:`, err.message);
      }
    }
  });
}
