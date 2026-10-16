import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllDay, parseEventDate, eventsOnDay, eventTimeLabel, eventDurationLabel, dayCellLabel, sameDay } from '../src/calendarEvents.js';

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
