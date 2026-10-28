import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { toast } from '../toast.jsx';
import { LoadingState } from './ui/States.jsx';
import SnoozeMenu from './SnoozeMenu.jsx';
import { itemKeys, applySnoozes, returnLabel } from '../snooze.js';

const KIND = {
  mail: { bg: 'var(--tag-info-bg)',   fg: 'var(--tag-info-fg)',   label: 'mail' },
  cal:  { bg: 'var(--tag-danger-bg)', fg: 'var(--tag-danger-fg)', label: 'clash' },
  task: { bg: 'var(--tag-warn-bg)',   fg: 'var(--tag-warn-fg)',   label: 'task' },
  code: { bg: 'var(--tag-code-bg)',   fg: 'var(--tag-code-fg)',   label: 'code' },
};

const FILTERS = [['all', 'All'], ['mail', 'Mail'], ['code', 'Code'], ['task', 'Tasks']];

const SUGGESTIONS = ['What do I have today?', 'Any urgent emails needing a reply?', 'Show my open PRs'];

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase' };

function greeting(date) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function untilLabel(ms) {
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function lengthLabel(ev) {
  const mins = Math.round((new Date(ev.end) - new Date(ev.start)) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  const h = mins / 60;
  return Number.isInteger(h) ? `${h} h` : `${mins} min`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const isDone = t => t.status === 'Done';

export default function DigestPanel({ refreshKey, onGoToSettings, onNavigate, onOpenPalette, onAsk, userName = '', health = {}, connected = false }) {
  const [digest,  setDigest]  = useState(null);
  const [running, setRunning] = useState(false);
  const [events,  setEvents]  = useState([]);
  const [tasks,   setTasks]   = useState([]);
  const [prs,     setPrs]     = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [ask,     setAsk]     = useState('');

  const [snoozes, setSnoozes] = useState([]);
  // Re-render each minute so a snoozed item comes back on time without a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();

  const connectedCount = [connected, health.notion, health.todoist, health.github, health.slack, health.trello, health.gemini || health.groq].filter(Boolean).length;

  useEffect(() => {
    apiFetch('/api/digest/latest').then(r => r.json()).then(d => { if (d) setDigest(d); return undefined; }).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!connected) { setEvents([]); return; }
    apiFetch('/api/calendar')
      .then(r => (r.ok ? r.json() : []))
      .then(list => { setEvents(Array.isArray(list) ? list : []); return undefined; })
      .catch(() => {});
  }, [connected, refreshKey]);

  useEffect(() => {
    apiFetch('/api/tasks')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return undefined;
        setTasks([
          ...(d.todoist ?? []).map(t => ({ ...t, source: 'todoist' })),
          ...(d.notion ?? []).map(t => ({ ...t, source: 'notion' })),
        ]);
        return undefined;
      })
      .catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    if (!health.github) { setPrs([]); return; }
    apiFetch('/api/prs')
      .then(r => (r.ok ? r.json() : []))
      .then(list => { setPrs(Array.isArray(list) ? list : []); return undefined; })
      .catch(() => {});
  }, [health.github, refreshKey]);

  useEffect(() => {
    apiFetch('/api/snoozes')
      .then(r => (r.ok ? r.json() : []))
      .then(list => { setSnoozes(Array.isArray(list) ? list : []); return undefined; })
      .catch(() => {});
  }, [refreshKey]);

  async function snoozeItem(item, choice) {
    try {
      const r = await apiFetch('/api/snoozes', { method: 'PUT', body: JSON.stringify({ key: item.key, title: item.title, ...choice }) });
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Could not snooze that item', 'error'); return; }
      setSnoozes(list => [...list.filter(s => s.key !== d.key), d]);
      toast(`Snoozed until ${returnLabel(d.until, Date.now())}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function unsnooze(key) {
    setSnoozes(list => list.filter(s => s.key !== key));
    try {
      const r = await apiFetch('/api/snoozes', { method: 'DELETE', body: JSON.stringify({ key }) });
      if (!r.ok) toast('Could not bring that item back', 'error');
    } catch {
      toast('Could not bring that item back', 'error');
    }
  }

  // Acting on an item that came back from a snooze ends that snooze.
  function act(item) {
    if (item.backFromSnooze && item.key) unsnooze(item.key);
    onNavigate?.(item.to);
  }

  async function runDigest() {
    setRunning(true);
    try {
      const r = await apiFetch('/api/digest/run', { method: 'POST' });
      const d = await r.json();
      if (r.ok) setDigest(d);
      else toast(d.error || 'Could not run the digest', 'error');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  }

  async function toggleTask(t) {
    const next = isDone(t) ? 'Not started' : 'Done';
    const r = await apiFetch('/api/task/update', { method: 'POST', body: JSON.stringify({ id: t.id, status: next, source: t.source }) });
    if (!r.ok) { toast('Could not update task', 'error'); return; }
    setTasks(ts => ts.map(x => (x.id === t.id ? { ...x, status: next } : x)));
  }

  function submitAsk(text) {
    const q = (text ?? ask).trim();
    if (!q) return;
    onAsk?.(q);
    setAsk('');
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const todays = events.filter(e => e.start && String(e.start).includes('T') && sameDay(new Date(e.start), now));
  const upcoming = events.find(e => e.start && String(e.start).includes('T') && new Date(e.end ?? e.start) > now);
  const nextEvent = upcoming && sameDay(new Date(upcoming.start), now) ? upcoming : null;

  const mailPending = digest?.comms?.pending ?? [];
  const conflicts   = digest?.calendar?.conflicts ?? [];
  const blockers    = digest?.tasks?.blockers ?? [];
  const openTasks   = tasks.filter(t => !isDone(t));

  const queue = [
    ...mailPending.slice(0, 5).map(e => ({ key: itemKeys.mail(e), kind: 'mail', title: e.subject, meta: [e.from, e.intent].filter(Boolean).join(' · '), action: 'Open', to: 'comms' })),
    ...prs.slice(0, 4).map(p => ({ key: itemKeys.pr(p), kind: 'code', title: p.title, meta: `GitHub · #${p.id}${p.daysStale >= 3 ? ` · ${p.daysStale}d stale` : ''}`, action: 'Review', to: 'github' })),
    ...blockers.map(b => ({ key: itemKeys.blocker(b), kind: 'task', title: b.title, meta: `${b.source ?? 'Tasks'} · blocked`, action: 'Open', to: 'tasks' })),
    ...openTasks.filter(t => t.priority >= 3).slice(0, 3).map(t => ({ key: itemKeys.task(t), kind: 'task', title: t.title, meta: `Tasks${t.due ? ' · due ' + t.due : ''}`, action: 'Start', to: 'tasks' })),
    ...conflicts.map(c => ({ key: itemKeys.conflict(c), kind: 'cal', title: `${c.eventA?.title} ↔ ${c.eventB?.title}`, meta: c.type === 'overlap' ? `Calendar · ${Math.round(c.overlapMin)} min overlap` : `Calendar · ${Math.round(c.gapMin)} min gap`, action: 'View', to: 'calendar' })),
  ];
  const { list: visibleQueue, waiting } = applySnoozes(queue, snoozes, now.getTime());
  const shown = visibleQueue.filter(q => filter === 'all' || q.kind === filter);

  const name = userName ? userName.charAt(0).toUpperCase() + userName.slice(1) : '';
  const nextMeeting = nextEvent ? ` Your next meeting is at ${clock(nextEvent.start)}.` : '';
  const summary = visibleQueue.length === 0
    ? `Nothing needs you right now.${nextMeeting}`
    : `${visibleQueue.length} ${visibleQueue.length === 1 ? 'thing needs' : 'things need'} you today.${nextMeeting}`;

  const services = [
    { name: 'Gmail',    ok: connected },
    { name: 'Calendar', ok: connected },
    { name: 'GitHub',   ok: health.github },
    { name: 'Slack',    ok: health.slack },
    { name: 'Notion',   ok: health.notion },
    { name: 'Todoist',  ok: health.todoist },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1280 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div className="t-eyebrow">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', ' ·')}</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {greeting(now)}{name ? `, ${name}` : ''}.
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-2)' }}>{summary}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            onClick={onOpenPalette}
            style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, minWidth: 'min(340px, 100%)', padding: '0 14px', border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)', color: 'var(--muted)', fontSize: 14.5, textAlign: 'left' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
            <span style={{ flex: 1 }}>Ask, search or run an action…</span>
            <span className="cmdk-kbd">⌘K</span>
          </button>
          <button className="primary" onClick={runDigest} disabled={running} style={{ minHeight: 48, padding: '0 20px', borderRadius: 12, fontSize: 14.5 }}>
            {running ? 'Running…' : digest ? 'Refresh digest' : 'Run digest'}
          </button>
        </div>
      </header>

      {connectedCount < 2 && !digest && (
        <section style={{ ...card, padding: '22px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 560 }}>
            <h2 className="t-h2">Connect more tools to fill your day</h2>
            <p style={{ fontSize: 14.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              Today needs at least two connections, like Google and GitHub, to build a useful summary. You have {connectedCount} connected.
            </p>
          </div>
          <button className="primary" onClick={onGoToSettings} style={{ minHeight: 44, padding: '0 20px', fontSize: 14.5 }}>Open Settings</button>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>

        {/* ── Left column ─────────────────────────────────────────────── */}
        <div style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Up next */}
          {nextEvent && (
            <section aria-label="Up next" style={{ display: 'flex', flexWrap: 'wrap', background: 'var(--sidebar-bg)', color: 'var(--bg)', borderRadius: 18, overflow: 'hidden' }}>
              <div style={{ flex: '1 1 280px', padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ ...mono, color: 'var(--accent-soft)' }}>Up next · {untilLabel(new Date(nextEvent.start) - now)}</div>
                <div style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.015em' }}>{nextEvent.title}</div>
                <div style={{ fontSize: 14.5, color: '#B9B8B1', lineHeight: 1.5 }}>
                  {[lengthLabel(nextEvent), nextEvent.location].filter(Boolean).join(' · ') || clock(nextEvent.start)}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                  <button type="button" onClick={() => onAsk?.(`Help me prepare for "${nextEvent.title}" at ${clock(nextEvent.start)}.`)} style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, background: 'var(--accent-soft)', color: '#0E1A15', fontSize: 14.5, fontWeight: 600 }}>
                    Prep with Dayhand
                  </button>
                  <button type="button" onClick={() => onNavigate?.('calendar')} style={{ minHeight: 44, padding: '0 18px', borderRadius: 10, border: '1px solid #3A3D40', color: 'var(--bg)', fontSize: 14.5, fontWeight: 500 }}>
                    Open calendar
                  </button>
                </div>
              </div>
              <div style={{ flex: '1 1 240px', padding: '26px 28px', background: '#1F2224', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ ...mono, color: '#9A9A94', paddingBottom: 8 }}>Today</div>
                {todays.slice(0, 5).map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: 14, alignItems: 'baseline', padding: '9px 0', borderTop: '1px solid #2A2D30', opacity: new Date(e.end ?? e.start) < now ? 0.5 : 1 }}>
                    <span style={{ width: 46, flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: e.id === nextEvent.id ? '#6FD3AE' : '#9A9A94' }}>{clock(e.start)}</span>
                    <span style={{ fontSize: 14.5, lineHeight: 1.35 }}>{e.title}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!nextEvent && connected && (
            <section aria-label="Up next" style={{ ...card, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="t-eyebrow">Up next</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>Nothing else on your calendar today.</div>
            </section>
          )}

          {/* Needs you */}
          <section aria-label="Needs you" style={{ ...card, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Needs you</h2>
              <div role="group" aria-label="Filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {FILTERS.map(([id, label]) => {
                  const on = filter === id;
                  return (
                    <button key={id} type="button" aria-pressed={on} onClick={() => setFilter(id)} style={{ minHeight: 36, padding: '0 14px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 999, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-2)', fontSize: 13.5, fontWeight: 500 }}>{label}</button>
                  );
                })}
              </div>
            </div>
            {running && <LoadingState label="Running 4 sub-agents in parallel…" />}
            {!running && shown.length === 0 && (
              <p style={{ padding: '18px 0 6px', borderTop: '1px solid var(--border)', color: 'var(--muted)', fontSize: 15 }}>
                {digest || visibleQueue.length === 0 ? 'Nothing here. A clear day.' : 'Nothing matches this filter.'}
                {!digest && ' Run your digest to scan mail and tasks.'}
              </p>
            )}
            {!running && shown.map((q, i) => (
              <div key={q.key ?? `${q.kind}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '14px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ flex: 'none', width: 64, textAlign: 'center', padding: '4px 0', borderRadius: 6, background: KIND[q.kind].bg, color: KIND[q.kind].fg, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{KIND[q.kind].label}</span>
                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>
                    {q.title}
                    {q.backFromSnooze && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, background: 'var(--tag-info-bg)', color: 'var(--tag-info-fg)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Back from snooze</span>}
                  </span>
                  <span style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.4 }}>{q.meta}</span>
                </div>
                <button type="button" onClick={() => act(q)} style={{ flex: 'none', minHeight: 40, padding: '0 16px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', fontSize: 13.5, fontWeight: 600 }}>{q.action}</button>
                {q.key && <SnoozeMenu title={q.title} onChoose={choice => snoozeItem(q, choice)} />}
              </div>
            ))}
            {!running && waiting.length > 0 && (
              <details style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <summary style={{ cursor: 'pointer', fontSize: 13.5, color: 'var(--muted)' }}>
                  {waiting.length} snoozed
                </summary>
                {waiting.map(s => (
                  <div key={s.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px', padding: '10px 0' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 14.5, lineHeight: 1.3 }}>{s.title || 'Snoozed item'}</span>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Comes back {returnLabel(s.until, now.getTime())}</span>
                    </div>
                    <button type="button" onClick={() => unsnooze(s.key)} style={{ flex: 'none', minHeight: 36, padding: '0 14px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', fontSize: 13.5, fontWeight: 500 }}>Bring back</button>
                  </div>
                ))}
              </details>
            )}
          </section>

          {/* Three small cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
            <section aria-label="Tasks" style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Tasks</h2>
              {openTasks.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No open tasks.</p>}
              {tasks.slice(0, 4).map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
                  <button
                    type="button" role="checkbox" aria-checked={isDone(t)} aria-label={t.title} onClick={() => toggleTask(t)}
                    style={{ flex: 'none', width: 24, height: 24, padding: 0, minHeight: 0, borderRadius: 7, border: `1.5px solid ${isDone(t) ? 'var(--accent)' : '#A9A69B'}`, background: isDone(t) ? 'var(--accent)' : 'var(--surface)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: isDone(t) ? 1 : 0 }}><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                  </button>
                  <span style={{ flex: 1, fontSize: 14.5, lineHeight: 1.35, color: isDone(t) ? 'var(--muted)' : 'var(--text)', textDecoration: isDone(t) ? 'line-through' : 'none' }}>{t.title}</span>
                </div>
              ))}
            </section>

            <section aria-label="Code" style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600 }}>Code</h2>
              {!health.github && <p style={{ fontSize: 14, color: 'var(--muted)' }}>GitHub is not connected.</p>}
              {health.github && prs.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No open pull requests.</p>}
              {prs.slice(0, 3).map(p => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)' }}>{p.branch ?? `#${p.id}`}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>{p.title}</span>
                </div>
              ))}
            </section>

            <section aria-label="Services" style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Connected</h2>
              {services.map(s => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 999, background: s.ok ? 'var(--success)' : '#D08A1E', flex: 'none' }} />
                  <span style={{ flex: 1, fontSize: 14.5 }}>{s.name}</span>
                  <span style={{ fontSize: 12.5, color: s.ok ? 'var(--muted)' : 'var(--warning)' }}>{s.ok ? 'Connected' : 'Needs key'}</span>
                </div>
              ))}
            </section>
          </div>
        </div>

        {/* ── Right column: ask ───────────────────────────────────────── */}
        <aside aria-label="Ask Dayhand" style={{ ...card, flex: '1 1 300px', maxWidth: 380, boxSizing: 'border-box', borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, minHeight: 420 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Ask Dayhand</h2>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', padding: '3px 8px', borderRadius: 999, background: 'var(--surface-sunken)' }}>agent</span>
          </div>
          <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-2)' }}>
            Ask across mail, calendar, tasks and code. Answers open in Chat.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, alignContent: 'flex-start' }}>
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" onClick={() => submitAsk(s)} style={{ minHeight: 36, padding: '0 12px', border: '1px solid var(--border-strong)', borderRadius: 999, background: 'var(--surface)', fontSize: 13, fontWeight: 500, textAlign: 'left' }}>{s}</button>
            ))}
          </div>
          <form onSubmit={e => { e.preventDefault(); submitAsk(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', border: '1px solid var(--border-strong)', borderRadius: 12 }}>
            <label htmlFor="today-ask" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message Dayhand</label>
            <input id="today-ask" type="text" placeholder="Message Dayhand" value={ask} onChange={e => setAsk(e.target.value)} style={{ flex: 1, minWidth: 0, minHeight: 40, border: 0, background: 'transparent', padding: 0, boxShadow: 'none' }} />
            <button type="submit" aria-label="Send" style={{ flex: 'none', width: 44, height: 44, padding: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
