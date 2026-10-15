// client/src/dateInput.js
// Values for <input type="datetime-local">, which wants "YYYY-MM-DDTHH:mm" in the
// user's LOCAL time. Date.toISOString() is always UTC, so slicing it gives a time
// several hours off for anyone not on UTC (7:30 AM at 1 PM in India).

const pad = n => String(n).padStart(2, '0');

export function toDateTimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The top of the next hour, in local time — a sensible default start for a new event.
export function nextHourLocal(now = new Date()) {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toDateTimeLocal(d);
}

// The absolute moment a datetime-local value means in the user's own timezone, as
// an ISO string with a Z. The server runs in UTC and would read a bare
// "2026-10-15T14:00" as 14:00 UTC, i.e. 19:30 in India, so the browser (which
// knows the user's zone) converts before sending.
export function localToInstantISO(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}
