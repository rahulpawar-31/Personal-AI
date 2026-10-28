// Snoozing "Needs you" items: the key that identifies an item, which items to
// show, and how to word a return time. Plain functions so they are tested
// without rendering. The server owns the return times (server/lib/snooze.js).

// A stable key for an item, or null when it has no id to key on (then it just
// cannot be snoozed). Must not change between loads for the same item.
export const itemKeys = {
  mail:     e => (e?.id ? `mail:gmail:${e.id}` : null),
  pr:       p => (p?.id ? `code:github:${p.repo ?? ''}#${p.id}` : null),
  blocker:  b => (b?.id ? `blocker:${b.source ?? 'tasks'}:${b.id}` : null),
  task:     t => (t?.id ? `task:${t.source ?? 'tasks'}:${t.id}` : null),
  conflict: c => (c?.eventA?.id && c?.eventB?.id ? `cal:${c.eventA.id}|${c.eventB.id}` : null),
};

const until = s => Date.parse(s.until);

// Splits the Needs-you queue by the user's snoozes at `nowMs`:
//   list    - what to show: items back from snooze first (marked), then the rest
//   waiting - snoozes that have not ended yet, for the "Snoozed" list; this
//             includes items that are not in the queue right now
export function applySnoozes(queue, snoozes, nowMs) {
  const byKey = new Map(snoozes.map(s => [s.key, s]));
  const back = [];
  const rest = [];
  for (const item of queue) {
    const s = item.key ? byKey.get(item.key) : null;
    if (!s) rest.push(item);
    else if (until(s) <= nowMs) back.push({ ...item, backFromSnooze: true });
    // else: snoozed until later, hidden
  }
  const waiting = snoozes.filter(s => until(s) > nowMs).sort((a, b) => until(a) - until(b));
  return { list: [...back, ...rest], waiting };
}

// "today 16:00", "tomorrow 09:00", or "Fri 30 Oct, 15:00", in the viewer's local time.
export function returnLabel(untilISO, nowMs) {
  const when = new Date(untilISO);
  const now  = new Date(nowMs);
  const clock = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(when) - dayStart(now)) / 86400000);
  if (days <= 0) return `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  const date = when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date}, ${clock}`;
}
