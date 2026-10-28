import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dueBriefDate, localDateAndMinutes, parseTime, resolveTimezone, effectiveSettings,
  validateBriefSettings, DEFAULT_BRIEF,
} from '../lib/briefSchedule.js';

const at = iso => new Date(iso);

test('a brief is due once the user\'s local time has passed, and returns their local date', () => {
  // 13:05Z is 09:05 in New York (EDT, UTC-4).
  const date = dueBriefDate({ now: at('2026-10-28T13:05:00Z'), time: '09:00', timezone: 'America/New_York' });
  assert.equal(date, '2026-10-28');
});

test('it is not due before the chosen local time', () => {
  assert.equal(dueBriefDate({ now: at('2026-10-28T12:55:00Z'), time: '09:00', timezone: 'America/New_York' }), null);
});

test('two users in different timezones are due at different instants', () => {
  const now = at('2026-10-28T03:30:00Z'); // 09:00 in Kolkata (UTC+5:30), 23:30 the day before in New York
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'Asia/Kolkata' }), '2026-10-28');
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'America/New_York' }), null);
});

test('the local date can differ from the UTC date (day boundary)', () => {
  // 20:30Z on the 27th is already 09:30 on the 28th in Auckland (NZDT, UTC+13).
  const now = at('2026-10-27T20:30:00Z');
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'Pacific/Auckland', lastSentDate: '2026-10-27' }), '2026-10-28');
  // The same instant is 13:30 on the 27th in Los Angeles: past the window, so not due.
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'America/Los_Angeles' }), null);
});

test('a brief already sent for the local date is not due again', () => {
  const now = at('2026-10-28T13:05:00Z');
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'America/New_York', lastSentDate: '2026-10-28' }), null);
  assert.equal(dueBriefDate({ now, time: '09:00', timezone: 'America/New_York', lastSentDate: '2026-10-27' }), '2026-10-28');
});

test('too long after the chosen time, the morning brief is skipped for the day', () => {
  // 09:00 chosen, now 12:00 local: exactly the 3-hour window has passed.
  assert.equal(dueBriefDate({ now: at('2026-10-28T16:00:00Z'), time: '09:00', timezone: 'America/New_York' }), null);
  assert.equal(dueBriefDate({ now: at('2026-10-28T15:59:00Z'), time: '09:00', timezone: 'America/New_York' }), '2026-10-28');
});

test('a time that does not exist on a daylight-saving day still sends once, right after the clocks move', () => {
  // New York springs forward on 2026-03-08: 02:00 EST becomes 03:00 EDT, so 02:30 never happens.
  const before = at('2026-03-08T06:55:00Z'); // 01:55 EST
  const after  = at('2026-03-08T07:05:00Z'); // 03:05 EDT
  assert.equal(dueBriefDate({ now: before, time: '02:30', timezone: 'America/New_York' }), null);
  assert.equal(dueBriefDate({ now: after,  time: '02:30', timezone: 'America/New_York' }), '2026-03-08');
});

test('the local clock follows daylight saving: 09:00 is a different UTC time in winter and summer', () => {
  const ny = { time: '09:00', timezone: 'America/New_York' };
  // January (EST, UTC-5): 09:00 local is 14:00Z.
  assert.equal(dueBriefDate({ now: at('2026-01-15T13:30:00Z'), ...ny }), null);
  assert.equal(dueBriefDate({ now: at('2026-01-15T14:05:00Z'), ...ny }), '2026-01-15');
  // July (EDT, UTC-4): 09:00 local is 13:00Z.
  assert.equal(dueBriefDate({ now: at('2026-07-15T12:55:00Z'), ...ny }), null);
  assert.equal(dueBriefDate({ now: at('2026-07-15T13:05:00Z'), ...ny }), '2026-07-15');
});

test('midnight reads as 00:00, not 24:00', () => {
  const { date, minutes } = localDateAndMinutes(at('2026-10-28T04:00:00Z'), 'America/New_York'); // 00:00 EDT
  assert.equal(date, '2026-10-28');
  assert.equal(minutes, 0);
});

test('a bad time or unknown timezone never makes a brief due by accident', () => {
  assert.equal(dueBriefDate({ now: at('2026-10-28T13:05:00Z'), time: '25:00', timezone: 'America/New_York' }), null);
  assert.equal(parseTime('9:00'), null);
  assert.equal(parseTime('09:00'), 540);
  assert.equal(resolveTimezone('Not/AZone'), resolveTimezone(null), 'an unknown zone falls back to the server zone');
});

test('a user with nothing saved gets the defaults', () => {
  assert.deepEqual(effectiveSettings(undefined), DEFAULT_BRIEF);
  assert.deepEqual(effectiveSettings({ time: '07:30' }), { ...DEFAULT_BRIEF, time: '07:30' });
});

test('validateBriefSettings keeps only the fields sent and accepts good values', () => {
  assert.deepEqual(validateBriefSettings({ timezone: 'Asia/Kolkata' }), { timezone: 'Asia/Kolkata' });
  assert.deepEqual(
    validateBriefSettings({ enabled: false, time: '06:45', channel: 'app', extra: 'ignored' }),
    { enabled: false, time: '06:45', channel: 'app' }
  );
  assert.deepEqual(validateBriefSettings({}), {});
});

test('validateBriefSettings rejects bad values with a message', () => {
  assert.throws(() => validateBriefSettings({ enabled: 'yes' }), /true or false/);
  assert.throws(() => validateBriefSettings({ time: '9am' }), /09:00/);
  assert.throws(() => validateBriefSettings({ time: '24:00' }), /09:00/);
  assert.throws(() => validateBriefSettings({ timezone: 'Mars/Olympus' }), /timezone/i);
  assert.throws(() => validateBriefSettings({ channel: 'email' }), /slack or app/);
});
