import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snoozeUntil, validateSnoozeRequest, returnedCutoff, MAX_KEY_LENGTH, MAX_TITLE_LENGTH,
} from '../lib/snooze.js';

const at  = s => new Date(s);
const iso = d => d.toISOString();

test('"later today" is 4 PM in the user\'s zone', () => {
  // 05:00Z is 10:30 in Kolkata; 16:00 IST is 10:30Z.
  const until = snoozeUntil({ preset: 'later-today', now: at('2026-10-28T05:00:00Z'), timezone: 'Asia/Kolkata' });
  assert.equal(iso(until), '2026-10-28T10:30:00.000Z');
});

test('"later today" after 4 PM means three hours from now', () => {
  // 11:00Z is 16:30 in Kolkata, already past 4 PM.
  const until = snoozeUntil({ preset: 'later-today', now: at('2026-10-28T11:00:00Z'), timezone: 'Asia/Kolkata' });
  assert.equal(iso(until), '2026-10-28T14:00:00.000Z');
});

test('"tomorrow" is 9 AM tomorrow in the user\'s zone', () => {
  const until = snoozeUntil({ preset: 'tomorrow', now: at('2026-10-28T05:00:00Z'), timezone: 'Asia/Kolkata' });
  assert.equal(iso(until), '2026-10-29T03:30:00.000Z');
});

test('"tomorrow" uses the user\'s calendar day when it differs from UTC', () => {
  // 20:30Z on the 27th is already Wednesday the 28th in Auckland, so tomorrow is the 29th.
  const until = snoozeUntil({ preset: 'tomorrow', now: at('2026-10-27T20:30:00Z'), timezone: 'Pacific/Auckland' });
  assert.equal(iso(until), '2026-10-28T20:00:00.000Z'); // 09:00 NZDT on the 29th
});

test('"tomorrow" is 9 AM local across a daylight-saving change', () => {
  // New York falls back on 2026-11-01; Saturday night to Sunday morning.
  const until = snoozeUntil({ preset: 'tomorrow', now: at('2026-10-31T20:00:00Z'), timezone: 'America/New_York' });
  assert.equal(iso(until), '2026-11-01T14:00:00.000Z'); // 09:00 EST
});

test('a custom time with no offset is read in the user\'s zone', () => {
  const until = snoozeUntil({ preset: 'custom', at: '2026-10-30T15:00', now: at('2026-10-28T05:00:00Z'), timezone: 'Asia/Kolkata' });
  assert.equal(iso(until), '2026-10-30T09:30:00.000Z');
});

test('a custom time must be given, in the future, and within a year', () => {
  const base = { preset: 'custom', now: at('2026-10-28T05:00:00Z'), timezone: 'UTC' };
  assert.throws(() => snoozeUntil({ ...base }), /date and time/);
  assert.throws(() => snoozeUntil({ ...base, at: 'next week' }), /date and time/);
  assert.throws(() => snoozeUntil({ ...base, at: '2026-10-28T04:00' }), /future/);
  assert.throws(() => snoozeUntil({ ...base, at: '2026-10-28T05:00' }), /future/, 'right now is not the future');
  assert.throws(() => snoozeUntil({ ...base, at: '2028-01-01T09:00' }), /within a year/);
});

test('an unknown choice is rejected', () => {
  assert.throws(() => snoozeUntil({ preset: 'next-year', now: at('2026-10-28T05:00:00Z'), timezone: 'UTC' }), /Unknown snooze choice/);
  assert.throws(() => snoozeUntil({ now: at('2026-10-28T05:00:00Z'), timezone: 'UTC' }), /Unknown snooze choice/);
});

test('a valid request becomes a key, a trimmed title and an ISO return time', () => {
  const out = validateSnoozeRequest(
    { key: '  mail:gmail:abc  ', title: '  Invoice overdue  ', preset: 'tomorrow' },
    { now: at('2026-10-28T05:00:00Z'), timezone: 'Asia/Kolkata' }
  );
  assert.deepEqual(out, { key: 'mail:gmail:abc', title: 'Invoice overdue', until: '2026-10-29T03:30:00.000Z' });
});

test('a long title is cut and a missing title is empty', () => {
  const now = at('2026-10-28T05:00:00Z');
  const long = validateSnoozeRequest({ key: 'k', title: 'x'.repeat(500), preset: 'tomorrow' }, { now, timezone: 'UTC' });
  assert.equal(long.title.length, MAX_TITLE_LENGTH);
  assert.equal(validateSnoozeRequest({ key: 'k', preset: 'tomorrow' }, { now, timezone: 'UTC' }).title, '');
});

test('a missing, blank, non-string or oversized key is rejected', () => {
  const opts = { now: at('2026-10-28T05:00:00Z'), timezone: 'UTC' };
  for (const key of [undefined, '', '   ', 42, null, ['a'], 'k'.repeat(MAX_KEY_LENGTH + 1)]) {
    assert.throws(() => validateSnoozeRequest({ key, preset: 'tomorrow' }, opts), /Missing or invalid item/, `key ${JSON.stringify(key)}`);
  }
  assert.throws(() => validateSnoozeRequest(null, opts), /Missing or invalid item/);
});

test('an unacted snooze is dropped a week after it ended', () => {
  assert.equal(returnedCutoff(at('2026-10-28T12:00:00Z')), '2026-10-21T12:00:00.000Z');
});
