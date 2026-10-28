import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'calendar-timezone-test-secret-32-characters';

const { recurringEventBody } = await import('../services/calendar.js');
const { resolveDate } = await import('../lib/actions.js');
const { getUserTimezone } = await import('../lib/userTimezone.js');
const { runDueCalendarChecks } = await import('../lib/digest.js');
const { createInMemoryBriefStore } = await import('../services/stores/briefStore.js');

const at = s => new Date(s);

// ─── The bug from #400 ────────────────────────────────────────────────────────

test('a recurring event is created at the time asked for in the user\'s zone, not the server\'s', () => {
  // The case from the issue: asking for 09:00 as a user in Kolkata must not become 14:30.
  const body = recurringEventBody({
    title: 'Standup', days: [1, 3], time: '09:00', timezone: 'Asia/Kolkata', now: at('2026-10-28T10:00:00Z'),
  });
  assert.equal(body.start.dateTime, '2026-11-02T03:30:00.000Z');
  assert.equal(body.start.timeZone, 'Asia/Kolkata');
  const shown = new Date(body.start.dateTime).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  assert.equal(shown, '09:00');
  assert.equal(body.end.dateTime, '2026-11-02T04:30:00.000Z', 'default length is an hour');
  assert.deepEqual(body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']);
});

test('the recurring start is the same instant whatever zone the server runs in', () => {
  const args = { title: 'x', days: [3], time: '15:00', timezone: 'Pacific/Auckland', now: at('2026-10-27T20:30:00Z') };
  const before = process.env.TZ;
  try {
    const results = [];
    for (const serverZone of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata']) {
      process.env.TZ = serverZone;
      results.push(recurringEventBody(args).start.dateTime);
    }
    assert.deepEqual(new Set(results).size, 1, `got ${JSON.stringify(results)}`);
    assert.equal(results[0], '2026-10-28T02:00:00.000Z');
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test('a recurring event with a custom length and description keeps them', () => {
  const body = recurringEventBody({
    title: 'Review', description: 'weekly', days: [5], time: '16:30', durationMinutes: 45,
    timezone: 'America/New_York', now: at('2026-10-28T10:00:00Z'),
  });
  assert.equal(body.description, 'weekly');
  assert.equal(body.start.dateTime, '2026-10-30T20:30:00.000Z'); // Friday 16:30 EDT
  assert.equal(body.end.dateTime, '2026-10-30T21:15:00.000Z');
});

// ─── Dates from chat ──────────────────────────────────────────────────────────

test('resolveDate reads a time with no offset in the user\'s zone', () => {
  assert.equal(resolveDate('2026-10-30T15:00', 'Asia/Kolkata'), '2026-10-30T09:30:00.000Z');
});

test('resolveDate leaves a full timestamp alone', () => {
  assert.equal(resolveDate('2026-10-30T15:00:00Z', 'Asia/Kolkata'), '2026-10-30T15:00:00.000Z');
});

test('"tomorrow at 3pm" means 3 PM tomorrow for the user', () => {
  // Wednesday 15:30 in Kolkata; tomorrow 15:00 IST is 09:30Z.
  assert.equal(resolveDate('tomorrow at 3pm', 'Asia/Kolkata', at('2026-10-28T10:00:00Z')), '2026-10-29T09:30:00.000Z');
});

test('"tomorrow" is the user\'s tomorrow when it is already a different day than UTC', () => {
  // 20:30Z Tuesday is Wednesday 09:30 in Auckland; tomorrow is Thursday, 09:00 NZDT by default.
  assert.equal(resolveDate('tomorrow', 'Pacific/Auckland', at('2026-10-27T20:30:00Z')), '2026-10-28T20:00:00.000Z');
});

test('a weekday name is the next such day in the user\'s zone, and a same-day name means next week', () => {
  const now = at('2026-10-28T10:00:00Z'); // Wednesday in Kolkata
  assert.equal(resolveDate('friday 10:30', 'Asia/Kolkata', now), '2026-10-30T05:00:00.000Z');
  assert.equal(resolveDate('wednesday at 9am', 'Asia/Kolkata', now), '2026-11-04T03:30:00.000Z');
});

test('resolveDate returns null for something it cannot read', () => {
  assert.equal(resolveDate('whenever', 'Asia/Kolkata'), null);
  assert.equal(resolveDate('', 'Asia/Kolkata'), null);
});

// ─── Which timezone a user has ────────────────────────────────────────────────

test('getUserTimezone prefers the saved zone, then USER_TIMEZONE, then the server\'s', async () => {
  const before = process.env.USER_TIMEZONE;
  try {
    process.env.USER_TIMEZONE = 'Europe/Paris';
    assert.equal(await getUserTimezone(1, async () => ({ timezone: 'Asia/Kolkata' })), 'Asia/Kolkata');
    assert.equal(await getUserTimezone(1, async () => ({ timezone: null })), 'Europe/Paris');
    assert.equal(await getUserTimezone(1, async () => null), 'Europe/Paris');
    delete process.env.USER_TIMEZONE;
    assert.equal(await getUserTimezone(1, async () => null), Intl.DateTimeFormat().resolvedOptions().timeZone);
  } finally {
    if (before === undefined) delete process.env.USER_TIMEZONE; else process.env.USER_TIMEZONE = before;
  }
});

test('a bad saved zone or a failing lookup falls back instead of throwing', async () => {
  const before = process.env.USER_TIMEZONE;
  try {
    process.env.USER_TIMEZONE = 'Europe/Paris';
    assert.equal(await getUserTimezone(1, async () => ({ timezone: 'Not/AZone' })), 'Europe/Paris');
    assert.equal(await getUserTimezone(1, async () => { throw new Error('db down'); }), 'Europe/Paris');
  } finally {
    if (before === undefined) delete process.env.USER_TIMEZONE; else process.env.USER_TIMEZONE = before;
  }
});

// ─── The 7 AM calendar check ──────────────────────────────────────────────────

function calendarSetup({ connected, prefs = {}, failFor = [] }) {
  const store = createInMemoryBriefStore();
  const ran = [];
  const ready = (async () => {
    for (const [id, patch] of Object.entries(prefs)) await store.savePrefs(Number(id), patch);
  })();
  const deps = {
    connectedUserIds: () => connected,
    listPrefs: async () => { await ready; return store.listPrefs(); },
    claim: (id, date) => store.claimCalendarCheck(id, date),
    check: async id => { if (failFor.includes(id)) throw new Error('boom'); ran.push(id); },
  };
  return { deps, ran, store };
}

const KOLKATA_SEVEN = at('2026-10-28T01:35:00Z'); // 07:05 in Kolkata, 01:35 in UTC

test('the check runs at each user\'s own 7 AM', async () => {
  const { deps, ran } = calendarSetup({
    connected: ['1', '2'],
    prefs: { 1: { timezone: 'Asia/Kolkata' }, 2: { timezone: 'UTC' } },
  });
  const sent = await runDueCalendarChecks({ now: KOLKATA_SEVEN, deps });
  assert.deepEqual(sent, ['1']);
  assert.deepEqual(ran, ['1']);
});

test('a user with no saved zone follows USER_TIMEZONE, as before', async () => {
  const before = process.env.USER_TIMEZONE;
  try {
    process.env.USER_TIMEZONE = 'Asia/Kolkata';
    const { deps, ran } = calendarSetup({ connected: ['9'] });
    await runDueCalendarChecks({ now: KOLKATA_SEVEN, deps });
    assert.deepEqual(ran, ['9']);
  } finally {
    if (before === undefined) delete process.env.USER_TIMEZONE; else process.env.USER_TIMEZONE = before;
  }
});

test('the check runs once per user per local day, across repeated and overlapping ticks', async () => {
  const { deps, ran } = calendarSetup({ connected: ['1'], prefs: { 1: { timezone: 'Asia/Kolkata' } } });
  await runDueCalendarChecks({ now: KOLKATA_SEVEN, deps });
  await runDueCalendarChecks({ now: at('2026-10-28T01:40:00Z'), deps });
  await Promise.all([
    runDueCalendarChecks({ now: at('2026-10-28T02:00:00Z'), deps }),
    runDueCalendarChecks({ now: at('2026-10-28T02:00:00Z'), deps }),
  ]);
  assert.equal(ran.length, 1);
  await runDueCalendarChecks({ now: at('2026-10-29T01:35:00Z'), deps });
  assert.equal(ran.length, 2, 'the next local day runs again');
});

test('the calendar check and the morning brief do not block each other', async () => {
  const { store } = calendarSetup({ connected: [] });
  assert.equal(await store.claimBrief(1, '2026-10-28'), true);
  assert.equal(await store.claimCalendarCheck(1, '2026-10-28'), true);
  assert.equal(await store.claimCalendarCheck(1, '2026-10-28'), false);
  assert.equal(await store.claimBrief(1, '2026-10-28'), false);
});

test('saving settings keeps the calendar check\'s record for the day', async () => {
  const { store } = calendarSetup({ connected: [] });
  await store.claimCalendarCheck(1, '2026-10-28');
  await store.savePrefs(1, { timezone: 'Asia/Kolkata' });
  assert.equal((await store.getPrefs(1)).lastCalendarCheckDate, '2026-10-28');
});

test('one user\'s failure does not stop the others', async () => {
  const { deps, ran } = calendarSetup({
    connected: ['1', '2'],
    prefs: { 1: { timezone: 'Asia/Kolkata' }, 2: { timezone: 'Asia/Kolkata' } },
    failFor: ['1'],
  });
  const sent = await runDueCalendarChecks({ now: KOLKATA_SEVEN, deps });
  assert.deepEqual(sent, ['1', '2']);
  assert.deepEqual(ran, ['2']);
});
