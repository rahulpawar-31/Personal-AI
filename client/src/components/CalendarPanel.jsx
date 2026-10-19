import { useState, useEffect, useRef } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import { toast } from '../toast.jsx';
import { nextHourLocal, localToInstantISO } from '../dateInput.js';
import NotConnected from './NotConnected.jsx';
import { Modal } from './settings/primitives.jsx';
import { sameDay, eventsOnDay, eventTimeLabel, eventDurationLabel, dayLabel, dayCellLabel, dayCoverage, dayCoverageNote, isAllDay, parseEventDate } from '../calendarEvents.js';

const DAYS = [
  { label: 'Mon', num: 1 }, { label: 'Tue', num: 2 }, { label: 'Wed', num: 3 },
  { label: 'Thu', num: 4 }, { label: 'Fri', num: 5 }, { label: 'Sat', num: 6 }, { label: 'Sun', num: 7 },
];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

// Block colours for a day's schedule: meetings blue, focus time green, the rest grey.
function blockTone(title = '') {
  const t = title.toLowerCase();
  if (t.includes('focus') || t.includes('deep work')) return { bg: 'var(--tag-success-bg)', fg: 'var(--tag-success-fg)' };
  if (t.includes('standup') || t.includes('meet') || t.includes('sync') || t.includes('review') || t.includes('call') || t.includes('catch'))
    return { bg: 'var(--tag-info-bg)', fg: 'var(--tag-info-fg)' };
  return { bg: 'var(--surface-sunken)', fg: 'var(--text)' };
}

const DAY_START = 8;
const DAY_END = 18;

// Longest gap between 08:00 and 18:00 not covered by a timed event.
function longestFreeBlock(day, evs) {
  const open  = new Date(day.getFullYear(), day.getMonth(), day.getDate(), DAY_START);
  const close = new Date(day.getFullYear(), day.getMonth(), day.getDate(), DAY_END);
  const busy = evs
    .filter(ev => !isAllDay(ev))
    .map(ev => [parseEventDate(ev.start), parseEventDate(ev.end ?? ev.start)])
    .filter(([a, z]) => a && z)
    .sort((x, y) => x[0] - y[0]);
  let cursor = open;
  let best = null;
  for (const [a, z] of busy) {
    if (a > cursor && (!best || a - cursor > best.end - best.start)) best = { start: cursor, end: new Date(Math.min(a, close)) };
    if (z > cursor) cursor = z;
  }
  if (close > cursor && (!best || close - cursor > best.end - best.start)) best = { start: cursor, end: close };
  return best && best.end - best.start >= 30 * 60000 ? best : null;
}

const hhmm = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const sectionCard = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };

export default function CalendarPanel({ connected, refreshKey, onConnectGoogle, onGoToSettings }) {
  const [events,    setEvents]   = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [authError, setAuthError] = useState(false);
  const [showForm,  setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [openEvent, setOpenEvent] = useState(null);
  const openerRef = useRef(null);
  const [creating,  setCreating] = useState(false);
  const [form, setForm] = useState(() => (
    { title: '', date: nextHourLocal(), duration: 60, recurring: false, days: [], time: '14:00' }
  ));

  useEffect(() => { if (connected) load(); }, [connected]);
  useEffect(() => { if (connected && refreshKey) load(); }, [refreshKey]);

  async function load() {
    setLoading(true);
    setAuthError(false);
    try {
      const r = await apiFetch('/api/calendar');
      if (r.status === 401) {
        const body = await r.json().catch(() => ({}));
        if (body.error === 'google_auth_required') setAuthError(true);
        return;
      }
      const ev = await r.json();
      setEvents(Array.isArray(ev) ? ev : []);
    } finally { setLoading(false); }
  }

  async function createEvent() {
    if (!form.title.trim()) return;
    if (form.recurring && !form.days.length) { toast('Select at least one day', 'error'); return; }
    if (!form.recurring && !form.date) return;
    setCreating(true);
    try {
      const body = form.recurring
        ? { title: form.title, recurring: true, days: form.days, time: form.time, duration: Number(form.duration) }
        : { title: form.title, date: localToInstantISO(form.date), duration: Number(form.duration) };
      const r = await apiFetch('/api/calendar', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); toast(e.error, 'error'); return; }
      setForm({ title: '', date: nextHourLocal(), duration: 60, recurring: false, days: [], time: '14:00' });
      setShowForm(false);
      await load();
    } finally { setCreating(false); }
  }

  function toggleDay(num) {
    setForm(f => ({ ...f, days: f.days.includes(num) ? f.days.filter(d => d !== num) : [...f.days, num] }));
  }

  function showDetails(ev, opener) {
    openerRef.current = opener ?? document.activeElement;
    setOpenEvent(ev);
  }

  function closeDetails() {
    setOpenEvent(null);
    const opener = openerRef.current;
    if (opener?.isConnected) setTimeout(() => opener.focus(), 0);
  }

  // Opens the create dialog for a focus block in the longest free gap of the selected day.
  function protectBlock(block) {
    const pad = n => String(n).padStart(2, '0');
    const d = block.start;
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const mins = Math.min(120, Math.round((block.end - block.start) / 60000));
    setForm({ title: 'Focus time', date: local, duration: mins, recurring: false, days: [], time: '14:00' });
    setShowForm(true);
  }

  const today = new Date();
  const weekStart = startOfWeek(selectedDay);
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const dayEvents = eventsOnDay(events, selectedDay);
  const meetings = dayEvents.filter(ev => !blockTone(ev.title).fg.includes('success')).length;
  const coverageNote = dayCoverageNote(dayCoverage(selectedDay, events), dayEvents.length);
  const free = longestFreeBlock(selectedDay, dayEvents);
  const comingUp = events.filter(ev => { const s = parseEventDate(ev.start); return s && s > today && !sameDay(s, selectedDay); }).slice(0, 4);
  const weekLabel = `${week[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${week[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  if (!connected) return (
    <div>
      <PageHeader eyebrow="Inbox & calendar" title="Calendar" subtitle="Events, meetings and scheduling conflicts." />
      <NotConnected
        title="Calendar not connected"
        description="Connect your Google account to see upcoming events, create meetings, and detect scheduling conflicts."
        primaryLabel="Connect Google"
        onPrimary={onConnectGoogle}
        secondaryLabel="Go to Settings"
        onSecondary={onGoToSettings}
      />
    </div>
  );

  return (
    <div>
      {authError && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--danger)', fontSize: 14 }}>Google disconnected</span>
          <button className="primary" style={{ fontSize: 13.5, padding: '0 16px', minHeight: 40 }} onClick={onConnectGoogle}>
            Reconnect
          </button>
        </div>
      )}

      <PageHeader
        eyebrow="Inbox & calendar"
        title="Calendar"
        subtitle={loading ? 'Loading your events…' : dayEvents.length === 0 ? 'Nothing scheduled.' : `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}, ${meetings} of them meetings.`}
      >
        <div role="group" aria-label="Day" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {week.map(d => {
            const on = sameDay(d, selectedDay);
            return (
              <button
                key={d.getTime()} type="button" aria-pressed={on}
                aria-label={dayCellLabel(d, eventsOnDay(events, d).length)}
                onClick={() => setSelectedDay(d)}
                style={{ minWidth: 60, minHeight: 56, padding: '6px 8px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 12, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{DOW[(d.getDay() + 6) % 7]}</span>
                <span style={{ fontSize: 18, fontWeight: 600 }}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>
      </PageHeader>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
        <button onClick={() => setSelectedDay(addDays(selectedDay, -7))} aria-label="Previous week" style={navBtn}>‹</button>
        <button onClick={() => setSelectedDay(addDays(selectedDay, 7))} aria-label="Next week" style={navBtn}>›</button>
        <button onClick={() => setSelectedDay(new Date())} style={{ fontSize: 14, fontWeight: 500, minHeight: 44, padding: '0 16px', border: '1px solid var(--border-strong)', background: 'var(--surface)' }}>Today</button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)' }}>{weekLabel}</span>
        <button className="primary" onClick={() => setShowForm(true)} style={{ marginLeft: 'auto', fontSize: 14.5, padding: '0 20px', minHeight: 44 }}>
          + Create
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

        <section aria-label={`Schedule for ${dayLabel(selectedDay)}`} style={{ ...sectionCard, flex: '999 1 460px', minWidth: 0, padding: '14px 26px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, padding: '8px 0 6px' }}>{dayLabel(selectedDay)}</h2>
          {dayEvents.map(ev => {
            const tone = blockTone(ev.title);
            const start = parseEventDate(ev.start);
            return (
              <div key={ev.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 22px', padding: '18px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ flex: 'none', width: 76, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500 }}>{isAllDay(ev) ? 'All day' : hhmm(start)}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{eventDurationLabel(ev) ?? ''}</span>
                </div>
                <button
                  type="button" onClick={e => showDetails(ev, e.currentTarget)}
                  aria-label={`${ev.title}, ${eventTimeLabel(ev)}. Show details`}
                  style={{ flex: '1 1 260px', minWidth: 0, padding: '12px 16px', borderRadius: 12, background: tone.bg, color: tone.fg, display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left', border: 0 }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{ev.title}</span>
                  {ev.location && <span style={{ fontSize: 13.5, opacity: 0.85, overflowWrap: 'anywhere' }}>{ev.location}</span>}
                </button>
              </div>
            );
          })}
          {dayEvents.length === 0 && (
            <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 15, borderTop: '1px solid var(--border)' }}>
              {coverageNote ?? 'Nothing scheduled. A clear day.'}
            </div>
          )}
          {dayEvents.length > 0 && coverageNote && <p style={{ fontSize: 13, color: 'var(--muted)', paddingTop: 10 }}>{coverageNote}</p>}
        </section>

        <aside aria-label="Free time" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section style={{ background: 'var(--sidebar-bg)', color: 'var(--bg)', borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-soft)' }}>Longest free block</span>
            <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.01em' }}>{free ? `${hhmm(free.start)} – ${hhmm(free.end)}` : 'No free block'}</span>
            <span style={{ fontSize: 14, color: '#B9B8B1', lineHeight: 1.5 }}>
              {free ? 'The longest stretch with nothing booked between 08:00 and 18:00.' : 'Nothing free of 30 minutes or more between 08:00 and 18:00.'}
            </span>
            {free && (
              <button type="button" onClick={() => protectBlock(free)} style={{ marginTop: 6, minHeight: 44, borderRadius: 10, background: 'var(--accent-soft)', color: '#0E1A15', fontSize: 14.5, fontWeight: 600 }}>
                Protect it as focus time
              </button>
            )}
          </section>

          <section style={{ ...sectionCard, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Coming up</h2>
            {comingUp.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>Nothing else loaded.</p>}
            {comingUp.map(ev => (
              <button key={ev.id} type="button" onClick={e => { setSelectedDay(parseEventDate(ev.start)); showDetails(ev, e.currentTarget); }} style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', padding: '8px 0', minHeight: 44, border: 0, borderTop: '1px solid var(--border)', borderRadius: 0 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{ev.title}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)' }}>
                  {parseEventDate(ev.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {eventTimeLabel(ev)}
                </span>
              </button>
            ))}
          </section>
        </aside>
      </div>

      {openEvent && <EventDetailModal event={openEvent} onClose={closeDetails} />}

      {/* Create event modal */}
      {showForm && (
        <CreateEventModal
          form={form} setForm={setForm}
          creating={creating} onCreate={createEvent}
          onClose={() => setShowForm(false)}
          toggleDay={toggleDay}
        />
      )}
    </div>
  );
}

const navBtn = {
  width: 44, height: 44, padding: 0, borderRadius: 10,
  border: '1px solid var(--border-strong)', background: 'var(--surface)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text)', fontSize: 20, lineHeight: 1,
};

function createButtonLabel(creating, recurring) {
  if (creating) return 'Creating…';
  return recurring ? 'Create recurring event' : 'Create event';
}

const miniNav = {
  width: 44, height: 44, padding: 0, borderRadius: 10, border: 'none',
  background: 'transparent', cursor: 'pointer', color: 'var(--muted)', fontSize: 20, lineHeight: 1,
};

// Read-only details of one event. Focus moves into the dialog when it opens and
// Tab stays inside it; the caller returns focus to the event that opened it.
function EventDetailModal({ event: ev, onClose }) {
  useEffect(() => {
    const dialog = () => document.querySelector('[role="dialog"]');
    dialog()?.querySelector('button[aria-label="Close"]')?.focus();
    function onKey(e) {
      if (e.key !== 'Tab') return;
      const items = [...(dialog()?.querySelectorAll('a[href], button:not([disabled])') ?? [])];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const duration  = eventDurationLabel(ev);
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  const label     = { fontSize: 11, color: 'var(--muted)', marginBottom: 2 };
  const link      = typeof ev.htmlLink === 'string' && ev.htmlLink.startsWith('https://') ? ev.htmlLink : null;

  return (
    <Modal open onClose={onClose} title={ev.title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
        <div>
          <div style={label}>When</div>
          <div>{eventTimeLabel(ev)}{duration ? ` (${duration})` : ''}</div>
        </div>
        {ev.location && (
          <div>
            <div style={label}>Where</div>
            <div style={{ overflowWrap: 'anywhere' }}>{ev.location}</div>
          </div>
        )}
        {attendees.length > 0 && (
          <div>
            <div style={label}>Attendees ({attendees.length})</div>
            <div style={{ overflowWrap: 'anywhere' }}>{attendees.join(', ')}</div>
          </div>
        )}
        {ev.description && (
          <div>
            <div style={label}>Description</div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ev.description}</div>
          </div>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>Open in Google Calendar</a>
        )}
      </div>
    </Modal>
  );
}

function CreateEventModal({ form, setForm, creating, onCreate, onClose, toggleDay }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(23,25,27,0.4)' }}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 440, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--border)',
        zIndex: 201, padding: '24px 26px 28px', boxShadow: 'var(--shadow-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 19, fontWeight: 600 }}>New event</span>
          <button onClick={onClose} aria-label="Close" style={{ ...miniNav, border: '1px solid var(--border-strong)' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {['Single', 'Recurring'].map(mode => {
            const active = (mode === 'Recurring') === form.recurring;
            return (
              <button key={mode} onClick={() => setForm(f => ({ ...f, recurring: mode === 'Recurring' }))} style={{
                fontSize: 14, padding: '0 16px', minHeight: 40, borderRadius: 10,
                background: active ? 'var(--text)' : 'var(--surface)',
                color: active ? 'var(--bg)' : 'var(--muted)',
                border: `1px solid ${active ? 'var(--text)' : 'var(--border)'}`,
              }}>{mode}</button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Event title" value={form.title} autoFocus
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && onCreate()} />

          {form.recurring ? (
            <>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>Days of week</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {DAYS.map(({ label, num }) => {
                    const on = form.days.includes(num);
                    return (
                      <button key={num} onClick={() => toggleDay(num)} style={{
                        fontSize: 13, padding: '0 12px', minHeight: 40, borderRadius: 10,
                        background: on ? 'var(--accent)' : 'var(--surface)',
                        color: on ? '#fff' : 'var(--muted)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      }}>{label}</button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Start time</div>
                  <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
                </div>
                <div style={{ position: 'relative', flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Duration</div>
                  <input type="number" value={form.duration} min={5} step={5}
                    onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} style={{ paddingRight: 36 }} />
                  <span style={{ position: 'absolute', right: 10, bottom: 9, fontSize: 11, color: 'var(--muted)', pointerEvents: 'none' }}>min</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="datetime-local" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={{ flex: 2 }} />
              <div style={{ position: 'relative', flex: 1 }}>
                <input type="number" value={form.duration} min={5} step={5}
                  onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} style={{ paddingRight: 36 }} />
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--muted)', pointerEvents: 'none' }}>min</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6 }}>
            {[15, 30, 60, 90].map(m => (
              <button key={m} onClick={() => setForm(f => ({ ...f, duration: m }))} style={{
                fontSize: 13, padding: '0 12px', minHeight: 36, borderRadius: 10,
                background: Number(form.duration) === m ? 'var(--text)' : 'var(--surface)',
                color: Number(form.duration) === m ? 'var(--bg)' : 'var(--muted)',
                border: `1px solid ${Number(form.duration) === m ? 'var(--text)' : 'var(--border)'}`,
              }}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>
            ))}
          </div>

          <button className="primary" onClick={onCreate}
            disabled={creating || !form.title.trim() || (form.recurring ? !form.days.length : !form.date)}
            style={{ alignSelf: 'flex-end', marginTop: 4, padding: '0 22px', minHeight: 44 }}>
            {createButtonLabel(creating, form.recurring)}
          </button>
        </div>
      </div>
    </>
  );
}
