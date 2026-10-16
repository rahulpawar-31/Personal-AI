import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllDay, parseEventDate, eventsOnDay, eventTimeLabel, eventDurationLabel, dayCellLabel, sameDay, dayCoverage, dayCoverageNote, EVENT_LIMIT } from '../src/calendarEvents.js';
import { subscribeToMedia } from '../src/useMediaQuery.js';

function inZone(tz, fn) {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
}

const timed = (title, start, end) => ({ id: title, title, start, end });

test('an all-day date is read as a local date, not midnight UTC', () => {
  for (const tz of ['Asia/Kolkata', 'America/Los_Angeles', 'UTC']) {
    inZone(tz, () => {
      const d = parseEventDate('2026-10-20');
      assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 20, 0], tz);
    });
  }
  assert.equal(isAllDay({ start: '2026-10-20' }), true);
  assert.equal(isAllDay({ start: '2026-10-20T09:00:00+05:30' }), false);
  assert.equal(parseEventDate('nonsense'), null);
  assert.equal(parseEventDate(undefined), null);
});

test('events on a day are sorted by start and ignore other days', () => {
  inZone('Asia/Kolkata', () => {
    const events = [
      timed('Late', '2026-10-16T16:00:00+05:30', '2026-10-16T17:00:00+05:30'),
      timed('Early', '2026-10-16T09:00:00+05:30', '2026-10-16T09:30:00+05:30'),
      timed('Other day', '2026-10-17T09:00:00+05:30', '2026-10-17T10:00:00+05:30'),
      { id: 'bad', title: 'No start' },
    ];
    assert.deepEqual(eventsOnDay(events, new Date(2026, 9, 16)).map(e => e.title), ['Early', 'Late']);
    assert.deepEqual(eventsOnDay(events, new Date(2026, 9, 18)), []);
  });
});

test('an all-day event covers each day up to but not including its end date', () => {
  const trip = { id: 't', title: 'Trip', start: '2026-10-20', end: '2026-10-23' };
  const single = { id: 's', title: 'Holiday', start: '2026-10-25', end: '2026-10-26' };
  const days = [19, 20, 21, 22, 23, 25, 26].map(n => eventsOnDay([trip, single], new Date(2026, 9, n)).map(e => e.title).join('+'));
  assert.deepEqual(days, ['', 'Trip', 'Trip', 'Trip', '', 'Holiday', '']);
});

test('eventsOnDay copes with no events or odd input', () => {
  assert.deepEqual(eventsOnDay(undefined, new Date()), []);
  assert.deepEqual(eventsOnDay(null, new Date()), []);
  assert.deepEqual(eventsOnDay('x', new Date()), []);
});

test('time labels: range, no end, all day, and across midnight', () => {
  inZone('Asia/Kolkata', () => {
    assert.equal(eventTimeLabel(timed('a', '2026-10-16T09:00:00+05:30', '2026-10-16T10:30:00+05:30')), '9:00 AM – 10:30 AM');
    assert.equal(eventTimeLabel(timed('a', '2026-10-16T09:00:00+05:30')), '9:00 AM');
    assert.equal(eventTimeLabel({ start: '2026-10-20', end: '2026-10-21' }), 'All day');
    assert.equal(eventTimeLabel(timed('a', '2026-10-16T22:00:00+05:30', '2026-10-17T01:00:00+05:30')), '10:00 PM – Oct 17, 1:00 AM');
    assert.equal(eventTimeLabel({}), '');
  });
});

test('duration labels', () => {
  inZone('Asia/Kolkata', () => {
    const at = (a, b) => eventDurationLabel(timed('x', a, b));
    assert.equal(at('2026-10-16T09:00:00+05:30', '2026-10-16T09:45:00+05:30'), '45 min');
    assert.equal(at('2026-10-16T09:00:00+05:30', '2026-10-16T10:00:00+05:30'), '1 h');
    assert.equal(at('2026-10-16T09:00:00+05:30', '2026-10-16T10:30:00+05:30'), '1 h 30 min');
    assert.equal(at('2026-10-16T09:00:00+05:30', '2026-10-16T09:00:00+05:30'), null);
    assert.equal(at('2026-10-16T09:00:00+05:30', undefined), null);
    assert.equal(eventDurationLabel({ start: '2026-10-20', end: '2026-10-21' }), '1 day');
    assert.equal(eventDurationLabel({ start: '2026-10-20', end: '2026-10-23' }), '3 days');
  });
});

test('day cell label counts events for screen readers', () => {
  const d = new Date(2026, 9, 16);
  assert.match(dayCellLabel(d, 0), /October 16, 2026, no events$/);
  assert.match(dayCellLabel(d, 1), /1 event$/);
  assert.match(dayCellLabel(d, 4), /4 events$/);
  assert.equal(sameDay(d, new Date(2026, 9, 16, 23, 59)), true);
});

// ── what the grid knows: the server sends only the next 10 upcoming events ──────
const NOW = new Date(2026, 9, 16, 12, 0);
const eventAt = (n, day) => ({ id: `e${n}`, title: `E${n}`, start: new Date(2026, 9, day, 10, n).toISOString(), end: new Date(2026, 9, day, 11, n).toISOString() });
const tenEvents = Array.from({ length: EVENT_LIMIT }, (_, i) => eventAt(i, 16 + Math.floor(i / 3)));  // 16th..19th

test('a day before now is past: its events are never loaded', () => {
  assert.equal(dayCoverage(new Date(2026, 9, 15), [], { now: NOW }), 'past');
  assert.equal(dayCoverage(new Date(2026, 9, 16), [], { now: NOW }), 'loaded', 'today is not past');
});

test('with fewer events than the limit, everything upcoming is known', () => {
  assert.equal(dayCoverage(new Date(2026, 9, 30), tenEvents.slice(0, 9), { now: NOW }), 'loaded');
  assert.equal(dayCoverage(new Date(2026, 9, 30), undefined, { now: NOW }), 'loaded');
});

test('once the limit is hit, days on or after the last loaded event may be incomplete', () => {
  assert.equal(dayCoverage(new Date(2026, 9, 17), tenEvents, { now: NOW }), 'loaded', 'before the last event day');
  assert.equal(dayCoverage(new Date(2026, 9, 19), tenEvents, { now: NOW }), 'partial', 'the last event day itself');
  assert.equal(dayCoverage(new Date(2026, 9, 28), tenEvents, { now: NOW }), 'partial', 'well after it');
});

test('the note under a day says why a list may look empty, and says nothing when it is complete', () => {
  assert.match(dayCoverageNote('past', 0), /Past events are not loaded/);
  assert.equal(dayCoverageNote('past', 2), null);
  assert.match(dayCoverageNote('partial', 0), /No events loaded.*next 10/);
  assert.match(dayCoverageNote('partial', 3), /More events.*may not be shown/);
  assert.equal(dayCoverageNote('loaded', 0), 'No events.');
  assert.equal(dayCoverageNote('loaded', 2), null);
});

// ── media query subscription, including the older addListener-only API ──────────
test('subscribeToMedia uses addEventListener when it exists, and addListener on older browsers', () => {
  const calls = [];
  const modern = { addEventListener: (t, h) => calls.push(['add', t, h]), removeEventListener: (t, h) => calls.push(['remove', t, h]) };
  const handler = () => {};
  subscribeToMedia(modern, handler)();
  assert.deepEqual(calls, [['add', 'change', handler], ['remove', 'change', handler]]);

  const old = [];
  const legacy = { addListener: h => old.push(['add', h]), removeListener: h => old.push(['remove', h]) };
  subscribeToMedia(legacy, handler)();
  assert.deepEqual(old, [['add', handler], ['remove', handler]], 'no throw on a list that only has addListener');

  assert.doesNotThrow(() => subscribeToMedia({}, handler)());
});
