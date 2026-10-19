import { useState, useEffect, useMemo, useRef } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import { toast } from '../toast.jsx';
import { nextHourLocal, localToInstantISO } from '../dateInput.js';
import NotConnected from './NotConnected.jsx';
import { Modal } from './settings/primitives.jsx';
import { useMediaQuery } from '../useMediaQuery.js';
import { sameDay, eventsOnDay, eventTimeLabel, eventDurationLabel, dayLabel, dayCellLabel, dayCoverage, dayCoverageNote } from '../calendarEvents.js';

const DAYS = [
  { label: 'Mon', num: 1 }, { label: 'Tue', num: 2 }, { label: 'Wed', num: 3 },
  { label: 'Thu', num: 4 }, { label: 'Fri', num: 5 }, { label: 'Sat', num: 6 }, { label: 'Sun', num: 7 },
];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// minmax(0, 1fr), not 1fr: a plain 1fr column grows to fit its widest unbreakable
// text, so one long event title made that day wide and the empty days narrow.
const GRID_COLUMNS = 'repeat(7, minmax(0, 1fr))';
// Below this width seven columns are too narrow for event titles.
const COMPACT_QUERY = '(max-width: 700px)';

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dayNumberColor(isToday, isCurrentMonth) {
  if (isToday) return 'var(--accent)';
  return isCurrentMonth ? 'var(--text)' : 'var(--hint)';
}

function eventColor(title = '') {
  const t = title.toLowerCase();
  if (t.includes('focus') || t.includes('deep work') || t.includes('frontend') || t.includes('dev'))
    return '#7591b0';
  if (t.includes('design') || t.includes('product') || t.includes('ui') || t.includes('brand'))
    return '#7ba88c';
  if (t.includes('research') || t.includes('interview') || t.includes('study') || t.includes('dsa') || t.includes('test'))
    return '#9488b6';
  if (t.includes('lunch') || t.includes('break') || t.includes('meet') || t.includes('andria'))
    return '#c08fa1';
  if (t.includes('standup') || t.includes('sync') || t.includes('catch') || t.includes('collab'))
    return '#c0a37c';
  return '#a3abb4';
}

export default function CalendarPanel({ connected, refreshKey, onConnectGoogle, onGoToSettings }) {
  const [events,    setEvents]   = useState([]);
  const [loading,   setLoading]  = useState(false);
  const [authError, setAuthError] = useState(false);
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [showForm,  setShowForm] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [openEvent, setOpenEvent] = useState(null);
  const openerRef = useRef(null);
  const compact = useMediaQuery(COMPACT_QUERY);
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

  const today = new Date();

  // 6-week grid starting on the Monday on or before the 1st of the displayed month
  const gridDays = useMemo(() => {
    const dow    = monthStart.getDay();            // 0=Sun
    const offset = dow === 0 ? -6 : 1 - dow;      // shift back to Monday
    const start  = addDays(monthStart, offset);
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [monthStart]);

  // Selecting a month keeps today selected only when today is in it, so the
  // list under the grid never shows a day that is not on screen.
  function goToMonth(date) {
    setMonthStart(date);
    const now = new Date();
    setSelectedDay(date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() ? now : null);
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

  const selectedEvents = selectedDay ? eventsOnDay(events, selectedDay) : [];
  const coverageNote = selectedDay ? dayCoverageNote(dayCoverage(selectedDay, events), selectedEvents.length) : null;

  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
      <PageHeader eyebrow="Inbox & calendar" title="Calendar" subtitle={monthLabel}>
        <button
          onClick={() => goToMonth(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}
          aria-label="Previous month"
          style={navBtn}
        >‹</button>
        <button
          onClick={() => goToMonth(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}
          aria-label="Next month"
          style={navBtn}
        >›</button>
        <button onClick={() => goToMonth(startOfMonth(new Date()))} style={{ fontSize: 14, fontWeight: 500, minHeight: 44, padding: '0 16px', border: '1px solid var(--border-strong)', background: 'var(--surface)' }}>Today</button>
        <button
          className="primary"
          onClick={() => setShowForm(true)}
          style={{ fontSize: 14.5, padding: '0 20px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> Create
        </button>
      </PageHeader>

      {/* Month grid. On a phone each day shows coloured dots instead of titles
          and the selected day's events are listed underneath; on wider screens
          each day lists its events and a chip opens the details. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)' }}>

        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {DOW.map((d, i) => (
            <div key={d} style={{
              padding: '10px 0', textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--muted)',
              borderRight: i < 6 ? '1px solid var(--border)' : 'none',
            }}>{d}</div>
          ))}
        </div>

        {/* 6 week rows */}
        {Array.from({ length: 6 }, (_, week) => (
          <div
            key={week}
            style={{
              display: 'grid', gridTemplateColumns: GRID_COLUMNS,
              borderBottom: week < 5 ? '1px solid var(--border)' : 'none',
            }}
          >
            {gridDays.slice(week * 7, week * 7 + 7).map((day, di) => {
              const isToday        = sameDay(day, today);
              const isCurrentMonth = day.getMonth() === monthStart.getMonth();
              const isSelected     = Boolean(selectedDay) && sameDay(day, selectedDay);
              const dayEvs         = eventsOnDay(events, day);
              const overflow       = dayEvs.length - 3;
              const cellBackground = isSelected
                ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))'
                : isToday ? 'color-mix(in srgb, var(--accent) 5%, var(--surface))' : 'var(--surface)';
              const cell = {
                minWidth: 0,
                height: compact ? 58 : 128,
                boxSizing: 'border-box',
                borderRight: di < 6 ? '1px solid var(--border)' : 'none',
                background: cellBackground,
                outline: isSelected || isToday ? '2px solid var(--accent)' : 'none',
                outlineOffset: '-2px',
              };
              const numberStyle = {
                fontSize: 14, fontWeight: isToday ? 600 : 500, color: dayNumberColor(isToday, isCurrentMonth),
              };

              if (compact) {
                return (
                  <button
                    key={day.getTime()} type="button"
                    onClick={() => setSelectedDay(day)}
                    aria-label={dayCellLabel(day, dayEvs.length)}
                    aria-pressed={isSelected}
                    style={{
                      ...cell, border: 'none', borderRight: cell.borderRight, borderRadius: 0, boxShadow: 'none',
                      padding: '6px 2px', cursor: 'pointer', font: 'inherit',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span style={numberStyle}>{day.getDate()}</span>
                    <span aria-hidden="true" style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {dayEvs.slice(0, 3).map(ev => (
                        <span key={ev.id} style={{ width: 6, height: 6, borderRadius: '50%', background: eventColor(ev.title) }} />
                      ))}
                    </span>
                    {overflow > 0 && <span aria-hidden="true" style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1 }}>+{overflow}</span>}
                  </button>
                );
              }

              return (
                <div key={day.getTime()} style={{ ...cell, padding: '8px 8px 6px' }}>
                  {/* Date number: selects the day */}
                  <button
                    type="button" onClick={() => setSelectedDay(day)}
                    aria-label={dayCellLabel(day, dayEvs.length)} aria-pressed={isSelected}
                    style={{ ...numberStyle, display: 'block', marginBottom: 5, padding: 0, border: 'none', background: 'transparent', boxShadow: 'none', cursor: 'pointer', font: 'inherit', fontSize: 14 }}
                  >
                    {day.getDate()}
                  </button>

                  {/* Event chips */}
                  {dayEvs.slice(0, 3).map(ev => (
                    <button
                      key={ev.id} type="button" title={ev.title}
                      onClick={e => showDetails(ev, e.currentTarget)}
                      aria-label={`${ev.title}, ${eventTimeLabel(ev)}. Show details`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                        marginBottom: 3, padding: 0, border: 'none', background: 'transparent', boxShadow: 'none',
                        cursor: 'pointer', textAlign: 'left', font: 'inherit',
                      }}
                    >
                      <span style={{ width: 3, height: 14, borderRadius: 2, background: eventColor(ev.title), flexShrink: 0 }} />
                      <span style={{
                        fontSize: 12.5, color: 'var(--text)',
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ev.title}
                      </span>
                      <span aria-hidden="true" style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>›</span>
                    </button>
                  ))}

                  {overflow > 0 && (
                    <button
                      type="button" onClick={() => setSelectedDay(day)}
                      style={{ marginTop: 2, padding: 0, border: 'none', background: 'transparent', boxShadow: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}
                    >
                      +{overflow} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* The selected day's events, listed in full */}
      {selectedDay && (
        <section aria-label={`Events on ${dayLabel(selectedDay)}`} style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>{dayLabel(selectedDay)}</h3>
          {selectedEvents.length === 0 ? (
            <p style={{ fontSize: 14.5, color: 'var(--muted)', margin: 0 }}>{coverageNote}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {selectedEvents.map(ev => (
                <li key={ev.id}>
                  <button
                    type="button" onClick={e => showDetails(ev, e.currentTarget)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                      padding: '12px 14px', minHeight: 44, borderRadius: 12, border: 'none',
                      background: 'var(--bg)', boxShadow: 'none', cursor: 'pointer', font: 'inherit',
                    }}
                  >
                    <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: eventColor(ev.title), flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere' }}>{ev.title}</span>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{eventTimeLabel(ev)}</span>
                    </span>
                    <span aria-hidden="true" style={{ fontSize: 14, color: 'var(--muted)' }}>›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedEvents.length > 0 && coverageNote && (
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>{coverageNote}</p>
          )}
        </section>
      )}

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
            style={{ alignSelf: 'flex-end', marginTop: 4, padding: '0 22px', minHeight: 44, opacity: (creating || !form.title.trim()) ? 0.4 : 1 }}>
            {createButtonLabel(creating, form.recurring)}
          </button>
        </div>
      </div>
    </>
  );
}
