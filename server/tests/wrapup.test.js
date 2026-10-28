import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'wrapup-test-secret-32-characters-long-ok';

const {
  dayStartISO, completedSince, meetingsSoFar, nextDate, standupDraft, composeWrapup, withoutOpenTask,
  formatWrapupSlack, buildWrapup, withoutDoneRecurring, NOTION_DONE_NOTE, runWrapup, runDueWrapups, MAX_LISTED,
} = await import('../lib/wrapup.js');
const { createInMemoryBriefStore } = await import('../services/stores/briefStore.js');
const { effectiveSettings, validateBriefSettings, DEFAULT_BRIEF } = await import('../lib/briefSchedule.js');

const at = s => new Date(s);

// ─── "Today" is the user's day ────────────────────────────────────────────────

test('the start of the day is local midnight in the user\'s zone', () => {
  assert.equal(dayStartISO(at('2026-10-28T10:00:00Z'), 'Asia/Kolkata'), '2026-10-27T18:30:00.000Z');
  // 20:30Z on the 27th is already the 28th in Auckland (NZDT, UTC+13).
  assert.equal(dayStartISO(at('2026-10-27T20:30:00Z'), 'Pacific/Auckland'), '2026-10-27T11:00:00.000Z');
});

test('completedSince keeps tasks finished today, newest first, each once', () => {
  const start = '2026-10-28T00:00:00.000Z';
  const tasks = [
    { id: 1, source: 'todoist', title: 'old', completedAt: '2026-10-27T23:59:00Z' },
    { id: 2, source: 'todoist', title: 'morning', completedAt: '2026-10-28T08:00:00Z' },
    { id: 3, source: 'notion',  title: 'afternoon', completedAt: '2026-10-28T14:00:00Z' },
    { id: 2, source: 'todoist', title: 'morning again', completedAt: '2026-10-28T08:00:00Z' },
    { id: 4, source: 'todoist', title: 'no time' },
  ];
  assert.deepEqual(completedSince(tasks, start).map(t => t.title), ['afternoon', 'morning']);
});

test('the same id from two different tools is two tasks', () => {
  const tasks = [
    { id: 7, source: 'todoist', title: 'a', completedAt: '2026-10-28T08:00:00Z' },
    { id: 7, source: 'notion',  title: 'b', completedAt: '2026-10-28T09:00:00Z' },
  ];
  assert.equal(completedSince(tasks, '2026-10-28T00:00:00Z').length, 2);
});

test('meetingsSoFar lists only timed meetings that have ended', () => {
  const now = at('2026-10-28T12:00:00Z');
  const events = [
    { title: 'Standup',  start: '2026-10-28T09:00:00Z', end: '2026-10-28T09:15:00Z' },
    { title: 'Running',  start: '2026-10-28T11:30:00Z', end: '2026-10-28T12:30:00Z' },
    { title: 'Later',    start: '2026-10-28T15:00:00Z', end: '2026-10-28T16:00:00Z' },
    { title: 'All day',  start: '2026-10-28', end: '2026-10-29' },
  ];
  assert.deepEqual(meetingsSoFar(events, now).map(m => m.title), ['Standup']);
});

test('meetingsSoFar leaves out declined meetings and the app\'s focus blocks, and keeps the id', () => {
  const now = at('2026-10-28T12:00:00Z');
  const events = [
    { id: 'a', title: 'Standup',          start: '2026-10-28T09:00:00Z', end: '2026-10-28T09:15:00Z' },
    { id: 'b', title: 'Declined sync',    start: '2026-10-28T10:00:00Z', end: '2026-10-28T10:30:00Z', declined: true },
    { id: 'c', title: 'Focus — Deep work', start: '2026-10-28T10:30:00Z', end: '2026-10-28T11:30:00Z' },
  ];
  assert.deepEqual(meetingsSoFar(events, now).map(m => [m.id, m.title]), [['a', 'Standup']]);
});

test('nextDate is the day after the wrap-up\'s date, across month and year ends', () => {
  assert.equal(nextDate('2026-10-28'), '2026-10-29');
  assert.equal(nextDate('2026-10-31'), '2026-11-01');
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
});

// ─── Content ──────────────────────────────────────────────────────────────────

test('the standup draft covers done, meetings and what carries over', () => {
  const text = standupDraft({
    done: [{ title: 'Ship settings' }, { title: 'Fix timezone bug' }],
    meetings: [{ title: 'Planning' }],
    open: [{ title: 'Write docs' }],
  });
  assert.equal(text, 'Done: Ship settings; Fix timezone bug\nMeetings: Planning\nCarrying over: Write docs');
});

test('Notion tasks are not in the standup draft, because their done time is a guess', () => {
  const done = [{ id: 1, source: 'todoist', title: 'Shipped' }, { id: 'n', source: 'notion', title: 'Edited today' }];
  const w = composeWrapup({ date: '2026-10-28', done });
  assert.equal(w.standup, 'Done: Shipped');
  assert.equal(w.done.length, 2, 'still shown in the app');
  assert.equal(composeWrapup({ date: '2026-10-28', done: [done[1]] }).standup, '');
});

test('the Slack message says when Notion tasks are counted by last edit', () => {
  const withNotion = formatWrapupSlack(composeWrapup({ date: '2026-10-28', done: [{ id: 'n', source: 'notion', title: 'x' }] }));
  assert.ok(withNotion.includes(NOTION_DONE_NOTE));
  const without = formatWrapupSlack(composeWrapup({ date: '2026-10-28', done: [{ id: 1, source: 'todoist', title: 'x' }] }));
  assert.ok(!without.includes(NOTION_DONE_NOTE));
});

test('a recurring task finished today is not also listed as still open', () => {
  const done = [{ id: 'c1', source: 'todoist', title: 'standup notes' }];
  const open = [
    { id: 5, source: 'todoist', title: 'standup notes', recurring: true },
    { id: 6, source: 'todoist', title: 'standup notes', recurring: false },
    { id: 7, source: 'todoist', title: 'other', recurring: true },
  ];
  assert.deepEqual(withoutDoneRecurring(open, done).map(t => t.id), [6, 7]);
  assert.deepEqual(withoutDoneRecurring([{ id: 'c1', source: 'todoist', title: 'renamed', recurring: true }], done), []);
});

test('the standup draft leaves out empty parts and caps long lists', () => {
  assert.equal(standupDraft({ done: [], open: [], meetings: [] }), '');
  const many = Array.from({ length: MAX_LISTED + 3 }, (_, i) => ({ title: `t${i}` }));
  assert.match(standupDraft({ done: many, open: [], meetings: [] }), /\(\+3 more\)$/);
});

test('only Todoist tasks can be moved to tomorrow', () => {
  const w = composeWrapup({
    date: '2026-10-28', now: at('2026-10-28T12:00:00Z'),
    open: [{ id: 1, source: 'todoist', title: 'a', due: '2026-10-28' }, { id: 'p', source: 'notion', title: 'b' }],
  });
  assert.deepEqual(w.open.map(t => [t.source, t.canMove]), [['todoist', true], ['notion', false]]);
});

test('a recurring Todoist task cannot be moved, because a new due date would end the recurrence', () => {
  const w = composeWrapup({
    date: '2026-10-28', now: at('2026-10-28T12:00:00Z'),
    open: [{ id: 1, source: 'todoist', title: 'standup notes', due: '2026-10-28', recurring: true }],
  });
  assert.equal(w.open[0].canMove, false);
});

test('with nothing done and nothing open it is marked empty, even if there were meetings', () => {
  const w = composeWrapup({ date: '2026-10-28', meetings: [{ title: 'Call' }] });
  assert.equal(w.empty, true);
  assert.equal(w.standup, 'Meetings: Call');
  assert.equal(composeWrapup({ date: '2026-10-28', done: [{ id: 1, source: 'todoist', title: 'x' }] }).empty, false);
});

test('moving the last open task away leaves the wrap-up empty and the note updated', () => {
  const w = composeWrapup({ date: '2026-10-28', open: [{ id: 5, source: 'todoist', title: 'Only one' }] });
  const next = withoutOpenTask(w, '5');
  assert.deepEqual(next.open, []);
  assert.equal(next.empty, true);
  assert.equal(next.standup, '');
  assert.equal(w.open.length, 1, 'the original is not changed');
});

// ─── The Slack message ────────────────────────────────────────────────────────

test('the Slack message has a section for what is there and a standup quote', () => {
  const text = formatWrapupSlack(composeWrapup({
    date: '2026-10-28',
    done: [{ id: 1, source: 'todoist', title: 'Ship settings' }],
    open: [{ id: 2, source: 'todoist', title: 'Write docs' }],
    meetings: [{ title: 'Planning' }],
  }));
  assert.match(text, /\*End of day, Wed,? 28 Oct\*/);
  assert.match(text, /\*Done today \(1\)\*\n• Ship settings/);
  assert.match(text, /\*Still open \(1\)\*\n• Write docs/);
  assert.match(text, /\*Meetings \(1\)\*\n• Planning/);
  assert.match(text, /\*Standup draft\*\n> Done: Ship settings/);
});

test('an empty day gets one short line, not empty sections', () => {
  const text = formatWrapupSlack(composeWrapup({ date: '2026-10-28' }));
  assert.match(text, /Nothing completed and nothing left open today\.$/);
  assert.doesNotMatch(text, /Done today|Still open|Standup/);
  assert.match(formatWrapupSlack(composeWrapup({ date: '2026-10-28', meetings: [{ title: 'a' }, { title: 'b' }] })), /You had 2 meetings\.$/);
  assert.match(formatWrapupSlack(composeWrapup({ date: '2026-10-28', meetings: [{ title: 'a' }] })), /You had 1 meeting\.$/);
});

test('a long list is cut with a count of the rest', () => {
  const done = Array.from({ length: MAX_LISTED + 2 }, (_, i) => ({ id: i, source: 'todoist', title: `task ${i}` }));
  const text = formatWrapupSlack(composeWrapup({ date: '2026-10-28', done }));
  assert.match(text, /\*Done today \(10\)\*/);
  assert.match(text, /…and 2 more/);
  assert.doesNotMatch(text, /task 9/);
});

// ─── Gathering ────────────────────────────────────────────────────────────────

function gatherDeps(overrides = {}) {
  return {
    timezone: async () => 'UTC',
    creds: async () => ({}),
    connected: () => true,
    todoistDone: async () => [],
    todoistOpen: async () => [],
    notionDone: async () => [],
    notionOpen: async () => [],
    events: async () => [],
    ...overrides,
  };
}

test('buildWrapup combines Todoist, Notion and the calendar for today', async () => {
  const deps = gatherDeps({
    todoistDone: async () => [{ id: 1, source: 'todoist', title: 'Todoist done', completedAt: '2026-10-28T08:00:00Z' }],
    notionDone:  async () => [{ id: 'n1', source: 'notion', title: 'Notion done', completedAt: '2026-10-28T09:00:00Z' }],
    todoistOpen: async () => [{ id: 2, source: 'todoist', title: 'Overdue', status: 'Not started', due: '2026-10-27' }],
    notionOpen:  async () => [{ id: 'n2', source: 'notion', title: 'Notion open', status: 'In progress' }],
    events:      async () => [{ title: 'Standup', start: '2026-10-28T09:00:00Z', end: '2026-10-28T09:15:00Z' }],
  });
  const w = await buildWrapup(1, { now: at('2026-10-28T17:30:00Z'), deps });
  assert.deepEqual(w.done.map(t => t.title), ['Notion done', 'Todoist done']);
  assert.deepEqual(w.open.map(t => t.title), ['Overdue', 'Notion open']);
  assert.deepEqual(w.meetings.map(m => m.title), ['Standup']);
  assert.equal(w.date, '2026-10-28');
});

test('of the Notion backlog, only tasks In progress count as still open', async () => {
  const deps = gatherDeps({
    notionOpen: async () => [
      { id: 'a', source: 'notion', title: 'Working on it', status: 'In progress' },
      { id: 'b', source: 'notion', title: 'Board spelling', status: 'In Progress' },
      { id: 'c', source: 'notion', title: 'Next month', status: 'Not started' },
    ],
  });
  const w = await buildWrapup(1, { now: at('2026-10-28T17:30:00Z'), deps });
  assert.deepEqual(w.open.map(t => t.title), ['Working on it', 'Board spelling']);
});

test('"today" follows the user\'s timezone', async () => {
  // Finished at 23:00Z on the 27th: yesterday in UTC, but 12:00 on the 28th in Auckland.
  const done = [{ id: 1, source: 'todoist', title: 'Late one', completedAt: '2026-10-27T23:00:00Z' }];
  const now  = at('2026-10-28T04:00:00Z');
  const utc = await buildWrapup(1, { now, deps: gatherDeps({ todoistDone: async () => done }) });
  const nz  = await buildWrapup(1, { now, deps: gatherDeps({ timezone: async () => 'Pacific/Auckland', todoistDone: async () => done }) });
  assert.equal(utc.done.length, 0);
  assert.equal(nz.done.length, 1);
});

test('a task that is already Done is not listed as still open', async () => {
  const deps = gatherDeps({ todoistOpen: async () => [{ id: 1, source: 'todoist', title: 'x', status: 'Done' }] });
  assert.equal((await buildWrapup(1, { now: at('2026-10-28T17:00:00Z'), deps })).open.length, 0);
});

test('a source that fails is left out and the rest still goes through', async () => {
  const deps = gatherDeps({
    todoistDone: async () => { throw new Error('Todoist 500'); },
    notionDone:  async () => [{ id: 'n', source: 'notion', title: 'Still here', completedAt: '2026-10-28T09:00:00Z' }],
  });
  const w = await buildWrapup(1, { now: at('2026-10-28T17:00:00Z'), deps });
  assert.deepEqual(w.done.map(t => t.title), ['Still here']);
});

test('without Google connected there are no meetings and no calendar call', async () => {
  let called = false;
  const deps = gatherDeps({ connected: () => false, events: async () => { called = true; return []; } });
  const w = await buildWrapup(1, { now: at('2026-10-28T17:00:00Z'), deps });
  assert.equal(called, false);
  assert.deepEqual(w.meetings, []);
});

// ─── Running one ──────────────────────────────────────────────────────────────

function runDeps({ saveFails = false } = {}) {
  const log = { saved: [], sent: [] };
  return {
    log,
    deps: {
      build: async () => composeWrapup({ date: '2026-10-28', done: [{ id: 1, source: 'todoist', title: 'x' }] }),
      save:  async (id, w) => { if (saveFails) throw new Error('db down'); log.saved.push([id, w.date]); },
      creds: async () => ({ SLACK_BOT_TOKEN: 't' }),
      send:  async (text, creds) => { log.sent.push([text, creds]); },
    },
  };
}

test('a wrap-up is saved, and sent to Slack only when asked', async () => {
  const quiet = runDeps();
  await runWrapup(1, { deps: quiet.deps });
  assert.deepEqual(quiet.log.saved, [[1, '2026-10-28']]);
  assert.deepEqual(quiet.log.sent, []);

  const loud = runDeps();
  await runWrapup(1, { sendToSlack: true, deps: loud.deps });
  assert.equal(loud.log.sent.length, 1);
  assert.match(loud.log.sent[0][0], /End of day/);
  assert.deepEqual(loud.log.sent[0][1], { SLACK_BOT_TOKEN: 't' });
});

test('an empty wrap-up is saved but not sent to Slack', async () => {
  const log = { saved: [], sent: [] };
  const deps = {
    build: async () => composeWrapup({ date: '2026-10-28' }),
    save:  async (id, w) => { log.saved.push([id, w.date]); },
    creds: async () => ({}),
    send:  async text => { log.sent.push(text); },
  };
  await runWrapup(1, { sendToSlack: true, deps });
  assert.equal(log.saved.length, 1);
  assert.deepEqual(log.sent, []);
});

test('a failed save does not stop the wrap-up being sent', async () => {
  const { deps, log } = runDeps({ saveFails: true });
  const w = await runWrapup(1, { sendToSlack: true, deps });
  assert.equal(w.date, '2026-10-28');
  assert.equal(log.sent.length, 1);
});

// ─── The schedule ─────────────────────────────────────────────────────────────

function dueSetup({ users, prefs = {}, failFor = [] }) {
  const store = createInMemoryBriefStore();
  const ran = [];
  const ready = (async () => {
    for (const [id, patch] of Object.entries(prefs)) await store.savePrefs(Number(id), patch);
  })();
  const deps = {
    listUsers: async () => { await ready; return users; },
    listPrefs: async () => { await ready; return store.listPrefs(); },
    claim: (id, date) => store.claimWrapup(id, date),
    release: (id, date) => store.releaseWrapup(id, date),
    run: async (id, opts) => { if (failFor.includes(id)) throw new Error('boom'); ran.push({ id, sendToSlack: opts.sendToSlack }); },
  };
  return { deps, ran, store };
}

const FIVE_THIRTY_FIVE_UTC = at('2026-10-28T17:35:00Z');
const on = (extra = {}) => ({ timezone: 'UTC', wrapupEnabled: true, ...extra });

test('the wrap-up is off by default', async () => {
  assert.equal(DEFAULT_BRIEF.wrapupEnabled, false);
  assert.equal(effectiveSettings(undefined).wrapupEnabled, false);
  assert.equal(effectiveSettings(undefined).wrapupTime, '17:30');
  const { deps, ran } = dueSetup({ users: [{ id: 1 }], prefs: { 1: { timezone: 'UTC' } } });
  assert.deepEqual(await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps }), []);
  assert.deepEqual(ran, []);
});

test('a user who turned it on gets one at their chosen local time, and not before', async () => {
  const { deps, ran } = dueSetup({ users: [{ id: 1 }], prefs: { 1: on() } });
  assert.deepEqual(await runDueWrapups({ now: at('2026-10-28T17:25:00Z'), deps }), [], 'five minutes early');
  assert.deepEqual(await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps }), [1]);
  assert.deepEqual(ran.map(r => r.id), [1]);
});

test('each user is due at their own local time', async () => {
  const { deps, ran } = dueSetup({
    users: [{ id: 1 }, { id: 2 }],
    prefs: { 1: on({ timezone: 'UTC' }), 2: on({ timezone: 'Asia/Kolkata' }) }, // 17:35 and 23:05 local
  });
  await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  assert.deepEqual(ran.map(r => r.id), [1]);
});

test('a custom wrap-up time is used', async () => {
  const { deps, ran } = dueSetup({ users: [{ id: 1 }], prefs: { 1: on({ wrapupTime: '19:00' }) } });
  await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  assert.deepEqual(ran, []);
  await runDueWrapups({ now: at('2026-10-28T19:05:00Z'), deps });
  assert.deepEqual(ran.map(r => r.id), [1]);
});

test('it goes to Slack only for users whose channel is Slack', async () => {
  const { deps, ran } = dueSetup({
    users: [{ id: 1 }, { id: 2 }],
    prefs: { 1: on({ channel: 'slack' }), 2: on({ channel: 'app' }) },
  });
  await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  assert.equal(ran.find(r => r.id === 1).sendToSlack, true);
  assert.equal(ran.find(r => r.id === 2).sendToSlack, false);
});

test('it runs once per user per local day, across repeated and overlapping ticks', async () => {
  const { deps, ran } = dueSetup({ users: [{ id: 1 }], prefs: { 1: on() } });
  await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  await runDueWrapups({ now: at('2026-10-28T17:40:00Z'), deps });
  await Promise.all([
    runDueWrapups({ now: at('2026-10-28T18:00:00Z'), deps }),
    runDueWrapups({ now: at('2026-10-28T18:00:00Z'), deps }),
  ]);
  assert.equal(ran.length, 1);
  await runDueWrapups({ now: at('2026-10-29T17:35:00Z'), deps });
  assert.equal(ran.length, 2, 'the next day runs again');
});

test('it does not block, or get blocked by, the morning brief', async () => {
  const { store } = dueSetup({ users: [] });
  assert.equal(await store.claimBrief(1, '2026-10-28'), true);
  assert.equal(await store.claimWrapup(1, '2026-10-28'), true);
  assert.equal(await store.claimWrapup(1, '2026-10-28'), false);
});

test('a user whose wrap-up failed is tried again on a later tick the same day', async () => {
  const { deps, ran } = dueSetup({ users: [{ id: 1 }], prefs: { 1: on() }, failFor: [1] });
  await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  assert.deepEqual(ran, []);
  const retry = { ...deps, run: async (id, opts) => { ran.push({ id, sendToSlack: opts.sendToSlack }); } };
  await runDueWrapups({ now: at('2026-10-28T17:45:00Z'), deps: retry });
  assert.deepEqual(ran.map(r => r.id), [1]);
});

test('inactive accounts and one user failing do not stop the others', async () => {
  const { deps, ran } = dueSetup({
    users: [{ id: 1 }, { id: 2 }, { id: 3, isActive: false }],
    prefs: { 1: on(), 2: on(), 3: on() },
    failFor: [1],
  });
  const sent = await runDueWrapups({ now: FIVE_THIRTY_FIVE_UTC, deps });
  assert.deepEqual(sent, [1, 2]);
  assert.deepEqual(ran.map(r => r.id), [2]);
});

// ─── Settings and the store ───────────────────────────────────────────────────

test('wrap-up settings are checked like the brief\'s', () => {
  assert.deepEqual(validateBriefSettings({ wrapupEnabled: true, wrapupTime: '18:15' }), { wrapupEnabled: true, wrapupTime: '18:15' });
  assert.throws(() => validateBriefSettings({ wrapupEnabled: 'yes' }), /true or false/);
  assert.throws(() => validateBriefSettings({ wrapupTime: '6pm' }), /17:30/);
  assert.throws(() => validateBriefSettings({ wrapupTime: '25:00' }), /17:30/);
});

test('saved wrap-up settings survive other changes, and the claimed date survives saving settings', async () => {
  const store = createInMemoryBriefStore();
  await store.savePrefs(1, { wrapupEnabled: true, wrapupTime: '18:00' });
  await store.savePrefs(1, { timezone: 'Asia/Kolkata' });
  await store.claimWrapup(1, '2026-10-28');
  await store.savePrefs(1, { channel: 'app' });
  const row = await store.getPrefs(1);
  assert.equal(row.wrapupEnabled, true);
  assert.equal(row.wrapupTime, '18:00');
  assert.equal(row.lastWrapupDate, '2026-10-28');
});

test('the latest wrap-up is saved per user and replaced by the next', async () => {
  const store = createInMemoryBriefStore();
  assert.equal(await store.getWrapup(1), null);
  await store.saveWrapup(1, { date: '2026-10-27' });
  await store.saveWrapup(2, { date: '2026-10-26' });
  await store.saveWrapup(1, { date: '2026-10-28' });
  assert.equal((await store.getWrapup(1)).date, '2026-10-28');
  assert.equal((await store.getWrapup(2)).date, '2026-10-26');
});
