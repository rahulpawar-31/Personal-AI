// server/lib/snooze.js
// Snoozing a "Needs you" item: when it comes back, and whether a request is
// acceptable. Pure, so the timezone cases are tested with fixed instants.
// The three choices are computed here, in the user's timezone, so "tomorrow
// morning" is 9 AM for them whatever zone the server or their browser is in.
import { resolveTimezone, localDateAndMinutes } from './briefSchedule.js';
import { zonedInstant, parseInZone, localDate, addDays } from './zonedTime.js';

export const PRESETS = ['later-today', 'tomorrow', 'custom'];
export const MAX_KEY_LENGTH = 200;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SNOOZE_DAYS = 365;

// A snooze that has already ended stays so the item can be marked "back from
// snooze" until the user acts on it. One that nobody acted on is dropped after
// this long, which also clears snoozes for items that no longer exist.
export const RETURNED_KEEP_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

// When the item should come back. `at` is only used by 'custom': a wall-clock
// time such as "2026-10-30T15:00", read in the user's timezone.
export function snoozeUntil({ preset, at, now = new Date(), timezone }) {
  const tz = resolveTimezone(timezone);

  if (preset === 'later-today') {
    // 4 PM today; if that has already passed, three hours from now.
    if (localDateAndMinutes(now, tz).minutes < 16 * 60) return zonedInstant(localDate(now, tz), '16:00', tz);
    return new Date(now.getTime() + 3 * 60 * 60 * 1000);
  }

  if (preset === 'tomorrow') {
    return zonedInstant(addDays(localDate(now, tz), 1), '09:00', tz);
  }

  if (preset === 'custom') {
    const when = parseInZone(at, tz);
    if (!when) throw new Error('Pick a date and time');
    if (when <= now) throw new Error('Pick a time in the future');
    if (when.getTime() > now.getTime() + MAX_SNOOZE_DAYS * DAY_MS) throw new Error('Pick a time within a year');
    return when;
  }

  throw new Error('Unknown snooze choice');
}

// Request body -> what to store. Throws a message the user can act on.
export function validateSnoozeRequest(body, { now = new Date(), timezone } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  const key = typeof src.key === 'string' ? src.key.trim() : '';
  if (!key || key.length > MAX_KEY_LENGTH) throw new Error('Missing or invalid item');
  const title = typeof src.title === 'string' ? src.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
  const until = snoozeUntil({ preset: src.preset, at: src.at, now, timezone });
  return { key, title, until: until.toISOString() };
}

// Snoozes that ended before this instant, and were never acted on, can go.
export function returnedCutoff(now = new Date()) {
  return new Date(now.getTime() - RETURNED_KEEP_DAYS * DAY_MS).toISOString();
}
