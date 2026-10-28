import { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { toast } from '../toast.jsx';

const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
const smallButton = { flex: 'none', minHeight: 36, padding: '0 14px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', fontSize: 13.5, fontWeight: 500 };
const label = { fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' };

// A wrap-up older than this is yesterday's, so the card hides itself.
const SHOW_FOR_MS = 16 * 60 * 60 * 1000;

function dateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// The latest end-of-day wrap-up, when there is a recent one. Users turn the
// wrap-up on in Settings; until the first one is built there is nothing to show.
export default function WrapupCard({ refreshKey }) {
  const [wrapup, setWrapup] = useState(null);
  const [moving, setMoving] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/wrapup/latest')
      .then(r => (r.ok ? r.json() : null))
      .then(w => { if (alive) setWrapup(w); return undefined; })
      .catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);

  if (!wrapup || Date.now() - Date.parse(wrapup.generatedAt) > SHOW_FOR_MS) return null;

  async function moveToTomorrow(task) {
    setMoving(task.id);
    try {
      const r = await apiFetch('/api/wrapup/move-to-tomorrow', { method: 'POST', body: JSON.stringify({ taskId: String(task.id) }) });
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Could not move that task', 'error'); return; }
      setWrapup(d);
      toast('Moved to tomorrow');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setMoving(null);
    }
  }

  async function copyStandup() {
    try {
      await navigator.clipboard.writeText(wrapup.standup);
      toast('Standup note copied');
    } catch {
      toast('Could not copy. Select the text and copy it.', 'error');
    }
  }

  return (
    <section aria-label="End-of-day wrap-up" style={{ ...card, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>End of day</h2>
        <span style={label}>{dateLabel(wrapup.date)}</span>
      </div>

      {wrapup.empty && (
        <p style={{ fontSize: 15, color: 'var(--muted)' }}>
          Nothing completed and nothing left open today.
          {wrapup.meetings.length > 0 && ` You had ${wrapup.meetings.length} ${wrapup.meetings.length === 1 ? 'meeting' : 'meetings'}.`}
        </p>
      )}

      {wrapup.done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Done today · {wrapup.done.length}</span>
          {wrapup.done.map(t => <span key={`${t.source}-${t.id}`} style={{ fontSize: 14.5 }}>{t.title}</span>)}
          {wrapup.done.some(t => t.source === 'notion') && (
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Notion does not record when a task was finished, so its tasks are counted when they were last edited today. They are left out of the standup draft.
            </span>
          )}
        </div>
      )}

      {wrapup.open.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Still open · {wrapup.open.length}</span>
          {wrapup.open.map(t => (
            <div key={`${t.source}-${t.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
              <span style={{ flex: '1 1 220px', minWidth: 0, fontSize: 14.5 }}>{t.title}</span>
              {t.canMove && (
                <button type="button" disabled={moving === t.id} onClick={() => moveToTomorrow(t)} style={smallButton}>
                  {moving === t.id ? 'Moving…' : 'Move to tomorrow'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {wrapup.meetings.length > 0 && !wrapup.empty && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Meetings · {wrapup.meetings.length}</span>
          {wrapup.meetings.map(m => <span key={m.id ?? `${m.start}-${m.title}`} style={{ fontSize: 14.5 }}>{m.title}</span>)}
        </div>
      )}

      {wrapup.standup && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={label}>Standup draft</span>
            <button type="button" onClick={copyStandup} style={smallButton}>Copy</button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>{wrapup.standup}</pre>
        </div>
      )}
    </section>
  );
}
