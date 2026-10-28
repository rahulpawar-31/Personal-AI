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
import { dbListUsers, dbListBriefPrefs, dbClaimBrief, dbClaimCalendarCheck, dbSaveDigest, dbGetDigest } from '../services/db.js';
import { dueBriefDate, effectiveSettings } from './briefSchedule.js';

async function getTasksForDigest(creds) {
  if (notionReady(creds)) return notion.getTasks(creds);
  if (creds.TODOIST_API_KEY) {
    const todoist = (await import('../services/todoist.js')).default;
    return todoist.getTasks('today | overdue', creds);
  }
  return [];
}

async function _runDigest(userId = null, { sendToSlack = false } = {}) {
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

  if (sendToSlack) await slack.sendDigest(digest, creds);
  return digest;
}

// Builds a user's digest and saves it as their latest. It goes to Slack only
// when the caller says so: the scheduled brief does for users who chose Slack,
// and the Slack page's "Run now" does. A run from the Today page or the chat
// agent only refreshes what the app shows.
export async function runDigest(userId = null, { sendToSlack = false } = {}) {
  const digest = await _runDigest(userId, { sendToSlack });
  if (userId !== null && userId !== undefined) {
    // A failed save must not lose a digest that was built (and maybe sent).
    await dbSaveDigest(userId, digest).catch(err => console.error(`[digest] could not save digest for user ${userId}:`, err.message));
  }
  return digest;
}

export async function getLatestDigest(userId) {
  return dbGetDigest(userId);
}

const defaultBriefDeps = {
  listUsers: dbListUsers,
  listPrefs: dbListBriefPrefs,
  claim:     dbClaimBrief,
  run:       runDigest,
};

// Sends the morning brief to every user whose chosen local time has just
// passed. Users come from the database (not the Google token files), so someone
// with Slack or Notion but no Google still gets one. Each user is claimed for
// their local date before the digest runs, so a restart or an overlapping tick
// cannot send a second brief that day. Returns the ids that were sent a brief.
export async function runDueBriefs({ now = new Date(), deps = defaultBriefDeps } = {}) {
  const [users, prefRows] = await Promise.all([deps.listUsers(), deps.listPrefs()]);
  const prefsById = new Map(prefRows.map(row => [String(row.userId), row]));

  const due = [];
  for (const user of users) {
    if (user.isActive === false) continue;
    const row  = prefsById.get(String(user.id));
    const prefs = effectiveSettings(row);
    if (!prefs.enabled) continue;
    const date = dueBriefDate({ now, time: prefs.time, timezone: prefs.timezone, lastSentDate: row?.lastSentDate });
    if (!date) continue;
    if (!(await deps.claim(user.id, date))) continue;
    due.push({ userId: user.id, sendToSlack: prefs.channel === 'slack' });
  }

  // Users in the same tick are independent; one failing must not stop the rest.
  await Promise.allSettled(due.map(({ userId, sendToSlack }) =>
    deps.run(userId, { sendToSlack }).catch(err => console.error(`[cron/brief] user ${userId}:`, err.message))
  ));
  return due.map(d => d.userId);
}

export const CALENDAR_CHECK_TIME = '07:00';

// The 7 AM check for one user: warn on Slack about double-booked meetings today,
// then protect a focus block.
async function checkCalendarFor(userId) {
  const creds     = await getUserCreds(userId);
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
}

const defaultCalendarCheckDeps = {
  connectedUserIds: () => auth.getConnectedUserIds(),
  listPrefs:        dbListBriefPrefs,
  claim:            dbClaimCalendarCheck,
  check:            checkCalendarFor,
};

// Runs the calendar check for every Google-connected user whose own 7:00 has
// just passed, in their saved timezone (the server's if they have not saved
// one). The local date is claimed first, so it runs once per user per day even
// across restarts or overlapping ticks. Returns the ids it ran for.
export async function runDueCalendarChecks({ now = new Date(), deps = defaultCalendarCheckDeps } = {}) {
  const prefRows  = await deps.listPrefs();
  const prefsById = new Map(prefRows.map(row => [String(row.userId), row]));

  const due = [];
  for (const userId of deps.connectedUserIds()) {
    try {
      const row  = prefsById.get(String(userId));
      const date = dueBriefDate({ now, time: CALENDAR_CHECK_TIME, timezone: row?.timezone, lastSentDate: row?.lastCalendarCheckDate });
      if (!date) continue;
      if (!(await deps.claim(userId, date))) continue;
      due.push(userId);
    } catch (err) {
      console.error(`[cron/calendar] user ${userId}:`, err.message);
    }
  }

  // Each user's calendar/Slack work is independent; one failing must not stop the rest.
  await Promise.allSettled(due.map(userId =>
    deps.check(userId).catch(err => console.error(`[cron/calendar] user ${userId}:`, err.message))
  ));
  return due;
}

export function setupCronJobs() {
  // Morning brief: every 5 minutes, send to whoever's chosen local time has just
  // passed (see runDueBriefs). Replaces the old fixed 9 AM server-time job.
  cron.schedule('*/5 * * * *', () => {
    runDueBriefs().catch(err => console.error('[cron/brief]', err.message));
  });

  // 7 AM calendar check: every 5 minutes, run it for whoever's own 7 AM has just
  // passed (see runDueCalendarChecks), not at 7 AM server time for everyone.
  cron.schedule('*/5 * * * *', () => {
    runDueCalendarChecks().catch(err => console.error('[cron/calendar]', err.message));
  });

  // Pre-meeting briefs: every 5 min, check each connected user's next few
  // events for one starting in ~10 minutes and push a Slack brief. Dedup via
  // an in-memory set (resets on restart — worst case a brief re-sends once,
  // never worse) since events aren't otherwise persisted anywhere to key off.
  const briefedEvents = new Set();
  cron.schedule('*/5 * * * *', async () => {
    // Sequential on purpose: each upcoming meeting a user is briefed on costs an
    // LLM call and a Slack post, and running users in parallel would burst the
    // provider's rate limit. Users without Slack or a matching event make none.
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
