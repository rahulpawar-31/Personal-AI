// Pure helpers for the calendar panel: which events fall on a day, and how an
// event's time and length read. Google sends timed events as full timestamps
// and all-day events as a bare date ("2026-10-20", with an exclusive end date).
// A bare date must be read as a local date: new Date("2026-10-20") is midnight
// UTC, which is the evening before in any zone west of Greenwich.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isAllDay(ev) {
  return DATE_ONLY.test(String(ev?.start ?? ''));
}

export function parseEventDate(value) {
  const text = String(value ?? '');
  if (DATE_ONLY.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Events that touch `day`, earliest first. A timed event belongs to the day it
// starts on; an all-day event to every day from its start up to (not
// including) its end date.
export function eventsOnDay(events, day) {
  const dayStart = startOfDay(day);
  return (Array.isArray(events) ? events : [])
    .filter(ev => {
      const start = parseEventDate(ev?.start);
      if (!start) return false;
      if (!isAllDay(ev)) return sameDay(start, day);
      const end = parseEventDate(ev.end);
      const last = end && end > start ? new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1) : start;
      return dayStart >= start && dayStart <= last;
    })
    .sort((a, b) => parseEventDate(a.start) - parseEventDate(b.start));
}

const clock = date => date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function dayLabel(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// "All day", "9:00 AM – 10:00 AM", or "9:00 AM" when there is no end.
export function eventTimeLabel(ev) {
  if (isAllDay(ev)) return 'All day';
  const start = parseEventDate(ev?.start);
  if (!start) return '';
  const end = parseEventDate(ev?.end);
  if (!end || end <= start) return clock(start);
  const endText = sameDay(start, end)
    ? clock(end)
    : `${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock(end)}`;
  return `${clock(start)} – ${endText}`;
}

// "45 min", "1 h", "1 h 30 min", "2 days"; null when the length is unknown.
export function eventDurationLabel(ev) {
  const start = parseEventDate(ev?.start);
  const end = parseEventDate(ev?.end);
  if (!start || !end || end <= start) return null;
  if (isAllDay(ev)) {
    const days = Math.round((end - start) / 86_400_000);
    return days === 1 ? '1 day' : `${days} days`;
  }
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Screen-reader text for a day cell: "Friday, October 16, 2026, 3 events".
export function dayCellLabel(date, count) {
  const events = count === 0 ? 'no events' : `${count} event${count === 1 ? '' : 's'}`;
  return `${dayLabel(date)}, ${events}`;
}

// The server sends only the next EVENT_LIMIT upcoming events (GET /api/calendar),
// so "no events listed" does not always mean "nothing on that day".
//   'past'    the whole day is before now: past events are never loaded.
//   'partial' the list hit the limit and this day is on or after the last loaded
//             event, so later events may be missing.
//   'loaded'  everything for this day is known.
export const EVENT_LIMIT = 10;

export function dayCoverage(day, events, { now = new Date(), limit = EVENT_LIMIT } = {}) {
  const dayStart = startOfDay(day);
  const nextDay = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  if (nextDay <= now) return 'past';
  const list = Array.isArray(events) ? events : [];
  if (list.length < limit) return 'loaded';
  const starts = list.map(ev => parseEventDate(ev?.start)).filter(Boolean);
  if (starts.length === 0) return 'loaded';
  const lastStart = startOfDay(new Date(Math.max(...starts.map(d => d.getTime()))));
  return dayStart >= lastStart ? 'partial' : 'loaded';
}

// What to say under a day's list. `count` is how many events are shown for it.
export function dayCoverageNote(coverage, count) {
  if (coverage === 'past') return count === 0 ? 'Past events are not loaded here, only upcoming ones.' : null;
  if (coverage === 'partial') {
    return count === 0
      ? `No events loaded for this day. Only your next ${EVENT_LIMIT} upcoming events are shown.`
      : `More events on or after this day may not be shown. Only your next ${EVENT_LIMIT} upcoming events are loaded.`;
  }
  return count === 0 ? 'No events.' : null;
}
