// server/lib/wrapup.js
// The end-of-day wrap-up: what got done today, what is still open (and can move
// to tomorrow), the meetings that happened, and a standup draft to copy.
//
// Built from the same sources as the morning brief (Todoist, Notion, Google
// Calendar), scheduled like it (per user, in their timezone, once a day, with the
// last-sent date saved), delivered the same way (Slack if they chose it; the
// latest one is always saved so the app can show it).
//
// The standup draft is plain text built from the lists. It makes no AI call, so
// a wrap-up always goes out, costs nothing to build, and reads the same way
// every day.
import auth from '../services/auth.js';
import todoist from '../services/todoist.js';
import * as notion from '../services/notion.js';
import calendar from '../services/calendar.js';
import slack from '../services/slack.js';
import { getUserCreds, notionReady } from './creds.js';
import { getUserTimezone } from './userTimezone.js';
import { dueBriefDate, effectiveSettings } from './briefSchedule.js';
import { zonedInstant, localDate } from './zonedTime.js';
import {
  dbListUsers, dbListBriefPrefs, dbClaimWrapup, dbReleaseWrapup, dbSaveWrapup, dbGetWrapup,
} from '../services/db.js';

// How many items of each kind a message lists before saying "and N more".
export const MAX_LISTED = 8;

// ─── Pure pieces ──────────────────────────────────────────────────────────────

// The start of the user's local day, as an ISO instant.
export function dayStartISO(now, timezone) {
  return zonedInstant(localDate(now, timezone), '00:00', timezone).toISOString();
}

// Tasks completed since `startISO`, each listed once, newest first.
export function completedSince(tasks, startISO) {
  const start = Date.parse(startISO);
  const seen = new Set();
  return tasks
    .filter(t => t?.completedAt && Date.parse(t.completedAt) >= start)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    .filter(t => {
      const key = `${t.source}:${t.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// The app's own focus blocks (see calendar.blockFocusTime) are time the user
// set aside, not meetings.
const isFocusBlock = e => String(e.title ?? '').startsWith('Focus — ');

// Meetings that have finished: timed events (not all-day) that ended by `now`,
// leaving out ones the user declined and the app's own focus blocks.
export function meetingsSoFar(events, now) {
  return events
    .filter(e => e?.start && String(e.start).includes('T') && e.end && Date.parse(e.end) <= now.getTime())
    .filter(e => !e.declined && !isFocusBlock(e))
    .map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end }));
}

// The calendar date after `date` ('YYYY-MM-DD'), for "move to tomorrow": the
// day after the wrap-up's own day, however long after it the button is pressed.
export function nextDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Whether a task belongs in "still open". A Todoist task is open until it is
// done, and the list is already limited to today and overdue. Notion tasks have
// no due date, so the whole backlog would be "open"; only the ones the user is
// working on (the board's In progress column) count as today's.
export function isOpenToday(t) {
  if (t?.status === 'Done') return false;
  if (t?.source === 'notion') return /^in progress$/i.test(String(t.status ?? '').trim());
  return true;
}

// A recurring Todoist task you finished today comes back as the next occurrence,
// which can still be due today or overdue. It is done for today, so it is not
// "still open". Matched by id and by title, because Todoist's completed list
// does not always carry the open task's id.
export function withoutDoneRecurring(open, done) {
  const ids    = new Set(done.filter(t => t.source === 'todoist').map(t => String(t.id)));
  const titles = new Set(done.filter(t => t.source === 'todoist').map(t => t.title));
  return open.filter(t => !(t.source === 'todoist' && t.recurring && (ids.has(String(t.id)) || titles.has(t.title))));
}

const more = (total, shown) => (total > shown ? ` (+${total - shown} more)` : '');
const titles = (list, n = MAX_LISTED) => list.slice(0, n).map(i => i.title).join('; ') + more(list.length, n);

// Notion does not record when a task was finished, so its "done today" is "edited
// today" (see notion.getCompletedSince). That is fine to show with a caveat, but
// not to put in a note that gets pasted to other people as fact.
export const NOTION_DONE_NOTE = 'Notion does not record when a task was finished, so its tasks are counted when they were last edited today.';

// A short note to paste into a standup channel. Empty when there is nothing to say.
export function standupDraft({ done, open, meetings }) {
  const lines = [];
  const doneForStandup = done.filter(t => t.source !== 'notion');
  if (doneForStandup.length) lines.push(`Done: ${titles(doneForStandup)}`);
  if (meetings.length) lines.push(`Meetings: ${titles(meetings)}`);
  if (open.length)     lines.push(`Carrying over: ${titles(open)}`);
  return lines.join('\n');
}

// The saved shape. Only Todoist tasks can move to tomorrow: Notion tasks here
// have no due date to change. A recurring Todoist task stays put too, because
// giving it a new due date would turn it into a one-off.
export function composeWrapup({ date, now = new Date(), done = [], open = [], meetings = [] }) {
  const doneItems = done.map(t => ({ id: t.id, title: t.title, source: t.source }));
  const openItems = open.map(t => ({
    id: t.id, title: t.title, source: t.source, due: t.due ?? null,
    canMove: t.source === 'todoist' && !t.recurring,
  }));
  return {
    date,
    generatedAt: now.toISOString(),
    // Nothing finished and nothing left: say so briefly. Meetings alone do not make a wrap-up.
    empty: doneItems.length === 0 && openItems.length === 0,
    done: doneItems,
    open: openItems,
    meetings,
    standup: standupDraft({ done: doneItems, open: openItems, meetings }),
  };
}

// Drops one open task after it has been moved to tomorrow.
export function withoutOpenTask(wrapup, taskId) {
  const open = wrapup.open.filter(t => String(t.id) !== String(taskId));
  const next = { ...wrapup, open };
  next.empty = next.done.length === 0 && open.length === 0;
  next.standup = standupDraft({ done: next.done, open, meetings: next.meetings });
  return next;
}

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

const bullets = (list, n = MAX_LISTED) => [
  ...list.slice(0, n).map(i => `• ${i.title}`),
  ...(list.length > n ? [`…and ${list.length - n} more`] : []),
];

// The Slack message.
export function formatWrapupSlack(w) {
  const head = `*End of day, ${dateLabel(w.date)}*`;
  if (w.empty) {
    const met = w.meetings.length ? ` You had ${w.meetings.length} ${w.meetings.length === 1 ? 'meeting' : 'meetings'}.` : '';
    return `${head}\nNothing completed and nothing left open today.${met}`;
  }
  const parts = [head];
  if (w.done.length)     parts.push(`*Done today (${w.done.length})*`, ...bullets(w.done));
  if (w.done.some(t => t.source === 'notion')) parts.push(`_${NOTION_DONE_NOTE}_`);
  if (w.open.length)     parts.push(`*Still open (${w.open.length})*`, ...bullets(w.open));
  if (w.meetings.length) parts.push(`*Meetings (${w.meetings.length})*`, ...bullets(w.meetings));
  if (w.standup)         parts.push('*Standup draft*', ...w.standup.split('\n').map(l => `> ${l}`));
  return parts.join('\n');
}

// ─── Gathering ────────────────────────────────────────────────────────────────

const defaultGatherDeps = {
  timezone:  getUserTimezone,
  creds:     getUserCreds,
  connected: userId => auth.isConnected(userId),
  todoistDone: (creds) => todoist.getRecentlyCompleted(creds, 2),
  todoistOpen: (creds) => todoist.getTasks('today | overdue', creds),
  notionDone:  (creds, sinceISO) => (notionReady(creds) ? notion.getCompletedSince(creds, sinceISO) : []),
  notionOpen:  (creds) => (notionReady(creds) ? notion.getTasks(creds) : []),
  events:      (userId, startISO, endISO) => calendar.getEventsBetween(userId, startISO, endISO),
};

// Reads the user's tasks and calendar and composes today's wrap-up. A source
// that fails is left out (and logged) rather than failing the whole wrap-up.
export async function buildWrapup(userId, { now = new Date(), deps = defaultGatherDeps } = {}) {
  const timezone = await deps.timezone(userId);
  const date     = localDate(now, timezone);
  const startISO = dayStartISO(now, timezone);
  const creds    = await deps.creds(userId);
  const hasCalendar = deps.connected(userId);

  const names = ['todoistDone', 'notionDone', 'todoistOpen', 'notionOpen', 'events'];
  const results = await Promise.allSettled([
    deps.todoistDone(creds),
    deps.notionDone(creds, startISO),
    deps.todoistOpen(creds),
    deps.notionOpen(creds),
    hasCalendar ? deps.events(userId, startISO, now.toISOString()) : [],
  ]);
  const got = {};
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[wrapup] user ${userId} ${names[i]}:`, r.reason?.message);
    got[names[i]] = r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [];
  });

  const done = completedSince([...got.todoistDone, ...got.notionDone], startISO);
  return composeWrapup({
    date, now,
    done,
    open:     withoutDoneRecurring([...got.todoistOpen, ...got.notionOpen].filter(isOpenToday), done),
    meetings: meetingsSoFar(got.events, now),
  });
}

const defaultRunDeps = {
  build: buildWrapup,
  save:  dbSaveWrapup,
  creds: getUserCreds,
  send:  (text, creds) => slack.sendDM(text, creds),
};

// Builds a user's wrap-up and saves it as their latest. It goes to Slack only
// when asked (the scheduled one does for users who chose Slack).
export async function runWrapup(userId, { sendToSlack = false, now = new Date(), deps = defaultRunDeps } = {}) {
  const wrapup = await deps.build(userId, { now });
  // A failed save must not lose a wrap-up that was built (and maybe sent).
  await deps.save(userId, wrapup).catch(err => console.error(`[wrapup] could not save for user ${userId}:`, err.message));
  // A day with nothing done and nothing open stays in the app: a DM saying so
  // every weekend and holiday is noise.
  if (sendToSlack && !wrapup.empty) await deps.send(formatWrapupSlack(wrapup), await deps.creds(userId));
  return wrapup;
}

export async function getLatestWrapup(userId) {
  return dbGetWrapup(userId);
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

const defaultDueDeps = {
  listUsers: dbListUsers,
  listPrefs: dbListBriefPrefs,
  claim:     dbClaimWrapup,
  release:   dbReleaseWrapup,
  run:       runWrapup,
};

// Sends the wrap-up to every user who turned it on and whose chosen local time
// has just passed. Same rules as the morning brief (runDueBriefs): users come
// from the database, the local date is claimed before the wrap-up is built so a
// restart or overlapping tick cannot send a second one that day, and one user
// failing does not stop the rest. A user whose wrap-up fails has the day's
// claim given back, so a later tick in the window tries again. Returns the ids
// it ran for.
export async function runDueWrapups({ now = new Date(), deps = defaultDueDeps } = {}) {
  const [users, prefRows] = await Promise.all([deps.listUsers(), deps.listPrefs()]);
  const prefsById = new Map(prefRows.map(row => [String(row.userId), row]));

  const due = [];
  for (const user of users) {
    if (user.isActive === false) continue;
    const row   = prefsById.get(String(user.id));
    const prefs = effectiveSettings(row);
    if (!prefs.wrapupEnabled) continue;
    const date = dueBriefDate({ now, time: prefs.wrapupTime, timezone: prefs.timezone, lastSentDate: row?.lastWrapupDate });
    if (!date) continue;
    if (!(await deps.claim(user.id, date))) continue;
    due.push({ userId: user.id, date, sendToSlack: prefs.channel === 'slack' });
  }

  await Promise.allSettled(due.map(({ userId, date, sendToSlack }) =>
    deps.run(userId, { sendToSlack, now }).catch(async err => {
      console.error(`[cron/wrapup] user ${userId}:`, err.message);
      await deps.release?.(userId, date).catch(e => console.error(`[cron/wrapup] could not release user ${userId}:`, e.message));
    })
  ));
  return due.map(d => d.userId);
}
