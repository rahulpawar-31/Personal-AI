import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedInstant, addDays, weekdayOf, localDate, localHour, nextOccurrence, parseInZone,
} from '../lib/zonedTime.js';

const iso = d => d.toISOString();
const at  = s => new Date(s);

test('zonedInstant: 09:00 on a date, in the user\'s zone, whatever the server zone', () => {
  assert.equal(iso(zonedInstant('2026-10-28', '09:00', 'Asia/Kolkata')), '2026-10-28T03:30:00.000Z');
  assert.equal(iso(zonedInstant('2026-10-28', '09:00', 'UTC')), '2026-10-28T09:00:00.000Z');
});

test('zonedInstant follows daylight saving: the same wall time is a different UTC time in winter and summer', () => {
  assert.equal(iso(zonedInstant('2026-01-15', '09:00', 'America/New_York')), '2026-01-15T14:00:00.000Z'); // EST
  assert.equal(iso(zonedInstant('2026-07-15', '09:00', 'America/New_York')), '2026-07-15T13:00:00.000Z'); // EDT
});

test('zonedInstant: a time skipped by a clock change lands just after the gap', () => {
  // New York springs forward on 2026-03-08: 02:00 EST becomes 03:00 EDT, so 02:30 never happens.
  assert.equal(iso(zonedInstant('2026-03-08', '02:30', 'America/New_York')), '2026-03-08T07:30:00.000Z'); // 03:30 EDT
});

test('zonedInstant: a time that happens twice takes the first one', () => {
  // New York falls back on 2026-11-01: 01:30 occurs as EDT and again as EST.
  assert.equal(iso(zonedInstant('2026-11-01', '01:30', 'America/New_York')), '2026-11-01T05:30:00.000Z'); // 01:30 EDT
});

test('addDays and weekdayOf are plain calendar arithmetic', () => {
  assert.equal(addDays('2026-10-28', 1), '2026-10-29');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekdayOf('2026-10-28'), 3); // Wednesday
  assert.equal(weekdayOf('2026-11-01'), 0); // Sunday
});

test('localDate and localHour read the wall clock in the given zone', () => {
  const now = at('2026-10-27T20:30:00Z');
  assert.equal(localDate(now, 'Pacific/Auckland'), '2026-10-28'); // already tomorrow there
  assert.equal(localDate(now, 'America/Los_Angeles'), '2026-10-27');
  assert.equal(localHour(at('2026-10-28T03:30:00Z'), 'Asia/Kolkata'), 9);
  assert.equal(localHour(at('2026-10-28T03:30:00Z'), 'UTC'), 3);
  assert.equal(localHour(at('2026-10-28T04:00:00Z'), 'America/New_York'), 0, 'midnight is hour 0, not 24');
});

test('nextOccurrence: today counts if the time has not passed in the user\'s zone', () => {
  const now = at('2026-10-28T10:00:00Z'); // Wednesday 15:30 in Kolkata
  assert.equal(iso(nextOccurrence({ now, jsDays: [3], time: '17:00', timezone: 'Asia/Kolkata' })), '2026-10-28T11:30:00.000Z');
});

test('nextOccurrence: a time already passed today moves to the next matching weekday', () => {
  const now = at('2026-10-28T10:00:00Z'); // Wednesday 15:30 in Kolkata
  // Mon + Wed at 09:00: Wednesday 09:00 IST has passed, so Monday 2 Nov.
  assert.equal(iso(nextOccurrence({ now, jsDays: [1, 3], time: '09:00', timezone: 'Asia/Kolkata' })), '2026-11-02T03:30:00.000Z');
});

test('nextOccurrence uses the user\'s calendar day, not the server\'s, across the date line', () => {
  // 20:30Z on Tuesday the 27th is Wednesday 09:30 in Auckland (NZDT, UTC+13).
  const now = at('2026-10-27T20:30:00Z');
  assert.equal(iso(nextOccurrence({ now, jsDays: [3], time: '15:00', timezone: 'Pacific/Auckland' })), '2026-10-28T02:00:00.000Z');
});

test('nextOccurrence returns null when no weekday is given', () => {
  assert.equal(nextOccurrence({ now: at('2026-10-28T10:00:00Z'), jsDays: [], time: '09:00', timezone: 'UTC' }), null);
});

test('parseInZone reads a time with no offset in the user\'s zone', () => {
  assert.equal(iso(parseInZone('2026-10-30T15:00', 'Asia/Kolkata')), '2026-10-30T09:30:00.000Z');
  assert.equal(iso(parseInZone('2026-10-30T15:00:00', 'Asia/Kolkata')), '2026-10-30T09:30:00.000Z');
  assert.equal(iso(parseInZone('2026-10-30 15:00', 'UTC')), '2026-10-30T15:00:00.000Z');
});

test('parseInZone: a date with no time means 09:00 there', () => {
  assert.equal(iso(parseInZone('2026-10-30', 'Asia/Kolkata')), '2026-10-30T03:30:00.000Z');
});

test('parseInZone leaves a time with an explicit offset alone', () => {
  assert.equal(iso(parseInZone('2026-10-30T15:00:00Z', 'Asia/Kolkata')), '2026-10-30T15:00:00.000Z');
  assert.equal(iso(parseInZone('2026-10-30T15:00:00+05:30', 'America/New_York')), '2026-10-30T09:30:00.000Z');
});

test('parseInZone returns null for things it cannot read', () => {
  assert.equal(parseInZone('tomorrow at 3pm', 'UTC'), null);
  assert.equal(parseInZone('', 'UTC'), null);
  assert.equal(parseInZone(undefined, 'UTC'), null);
  assert.equal(parseInZone('2026-10-30T99:99:00Z', 'UTC'), null);
});
