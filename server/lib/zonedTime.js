// server/lib/zonedTime.js
// Turning "09:00 on this date, in that timezone" into a real instant, and back.
// The server's own clock zone never enters into it, so a server in UTC and a
// user in Kolkata agree on what "9 AM" means. Pure, so it is tested with fixed
// instants; built on Intl only, no dependency.
import { localDateAndMinutes, resolveTimezone } from './briefSchedule.js';

// How far `timezone` is ahead of UTC at `instant`, in milliseconds.
function offsetMs(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = type => Number(parts.find(p => p.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

// The instant at which a wall clock in `timezone` reads `date` (YYYY-MM-DD) and
// `time` (HH:MM). A time skipped by a clock change (02:30 on a spring-forward
// day) lands just after the gap rather than failing.
export function zonedInstant(date, time, timezone) {
  const tz = resolveTimezone(timezone);
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm]   = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, hh, mm);
  // Two passes: the offset at the guess can differ from the offset at the answer
  // when a clock change falls between them.
  const first  = wall - offsetMs(new Date(wall), tz);
  const second = wall - offsetMs(new Date(first), tz);
  // If the second answer does not read `time` on the wall, that time was skipped
  // by a clock change; the first pass is the moment just after the gap.
  return new Date(second + offsetMs(new Date(second), tz) === wall ? second : first);
}

// Calendar arithmetic on a plain date string; no timezone involved.
export function addDays(date, n) {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0 = Sunday
}

export function localDate(now, timezone) {
  return localDateAndMinutes(now, resolveTimezone(timezone)).date;
}

// The local hour (0-23) at `instant` in `timezone`.
export function localHour(instant, timezone) {
  return Math.floor(localDateAndMinutes(instant, resolveTimezone(timezone)).minutes / 60);
}

// The first moment after `now` that is `time` local on one of `jsDays`
// (0 = Sunday). Today counts if that time has not passed yet in `timezone`.
export function nextOccurrence({ now, jsDays, time, timezone }) {
  const today = localDate(now, timezone);
  for (let i = 0; i <= 7; i += 1) {
    const date = addDays(today, i);
    if (!jsDays.includes(weekdayOf(date))) continue;
    const instant = zonedInstant(date, time, timezone);
    if (instant > now) return instant;
  }
  return null;
}

const HAS_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
const NAIVE_ISO  = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

// A date string from the chat agent or the API. One with an explicit offset
// ("...Z", "...+05:30") is exact and used as is. One without ("2026-10-30T15:00",
// or just "2026-10-30") is a wall-clock time and is read in the user's timezone,
// not the server's. Anything else returns null for the caller to handle.
export function parseInZone(raw, timezone) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (HAS_OFFSET.test(s)) {
    const exact = new Date(s);
    return isNaN(exact) ? null : exact;
  }
  const m = NAIVE_ISO.exec(s);
  if (!m) return null;
  return zonedInstant(m[1], m[2] ?? '09:00', timezone);
}
