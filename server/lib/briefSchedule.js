// server/lib/briefSchedule.js
// Pure helpers for the morning brief: what a user's settings mean, whether a
// brief is due right now, and whether a settings update is acceptable. No I/O,
// so the timezone and day-boundary cases can be tested with fixed instants.

export const CHANNELS = ['slack', 'app'];

// A user with no saved settings gets these. A null timezone means "the server's
// timezone" (USER_TIMEZONE, else the host's), which is how the 9 AM job behaved
// before settings existed.
export const DEFAULT_BRIEF = { enabled: true, time: '09:00', timezone: null, channel: 'slack' };

// How long after the chosen time a brief can still go out. If the server was
// down at 9:00 it sends at 9:20, but it does not send a "morning" brief at 8 PM.
export const DUE_WINDOW_MINUTES = 180;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimezone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

export function serverTimezone() {
  const fromEnv = process.env.USER_TIMEZONE;
  return isValidTimezone(fromEnv) ? fromEnv : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function resolveTimezone(tz) {
  return isValidTimezone(tz) ? tz : serverTimezone();
}

export function parseTime(time) {
  const m = typeof time === 'string' ? TIME_RE.exec(time) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The calendar date (YYYY-MM-DD) and minutes since midnight in `timezone` at `now`.
export function localDateAndMinutes(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

// Returns the user's local date when a brief is due right now, else null. The
// caller records that date as "sent", which is what stops a second brief the
// same local day.
export function dueBriefDate({ now, time, timezone, lastSentDate = null, windowMinutes = DUE_WINDOW_MINUTES }) {
  const target = parseTime(time);
  if (target === null) return null;
  const { date, minutes } = localDateAndMinutes(now, resolveTimezone(timezone));
  if (lastSentDate === date) return null;
  if (minutes < target || minutes - target >= windowMinutes) return null;
  return date;
}

// Saved row (or nothing) -> the settings that apply.
export function effectiveSettings(row) {
  return {
    enabled:  row?.enabled  ?? DEFAULT_BRIEF.enabled,
    time:     row?.time     ?? DEFAULT_BRIEF.time,
    timezone: row?.timezone ?? DEFAULT_BRIEF.timezone,
    channel:  row?.channel  ?? DEFAULT_BRIEF.channel,
  };
}

// Request body -> only the fields that were sent, each checked. Throws a message
// the user can act on.
export function validateBriefSettings(body) {
  const src = body && typeof body === 'object' ? body : {};
  const patch = {};
  if ('enabled' in src) {
    if (typeof src.enabled !== 'boolean') throw new Error('enabled must be true or false');
    patch.enabled = src.enabled;
  }
  if ('time' in src) {
    if (parseTime(src.time) === null) throw new Error('Time must look like 09:00');
    patch.time = src.time;
  }
  if ('timezone' in src) {
    if (!isValidTimezone(src.timezone)) throw new Error('Unknown timezone');
    patch.timezone = src.timezone;
  }
  if ('channel' in src) {
    if (!CHANNELS.includes(src.channel)) throw new Error('Channel must be slack or app');
    patch.channel = src.channel;
  }
  return patch;
}
