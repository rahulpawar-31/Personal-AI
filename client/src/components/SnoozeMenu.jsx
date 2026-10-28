import { useState } from 'react';

const choiceStyle = {
  minHeight: 36, padding: '0 14px', border: '1px solid var(--border-strong)', borderRadius: 999,
  background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13.5, fontWeight: 500,
};

// A "Snooze" button that opens a row of choices under the item. `onChoose` gets
// { preset: 'later-today' | 'tomorrow' } or { preset: 'custom', at: '2026-10-30T15:00' };
// the server turns these into a return time in the user's timezone.
export default function SnoozeMenu({ title, onChoose, busy = false }) {
  const [open, setOpen] = useState(false);
  const [at, setAt]     = useState('');

  function choose(choice) {
    setOpen(false);
    setAt('');
    onChoose(choice);
  }

  return (
    <>
      <button
        type="button" aria-expanded={open} aria-label={`Snooze ${title}`} disabled={busy}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        style={{ flex: 'none', minHeight: 40, padding: '0 14px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13.5, fontWeight: 500 }}
      >
        Snooze
      </button>
      {open && (
        <div
          role="group" aria-label={`Snooze ${title} until`}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: 80 }}
        >
          <button type="button" style={choiceStyle} onClick={() => choose({ preset: 'later-today' })}>Later today</button>
          <button type="button" style={choiceStyle} onClick={() => choose({ preset: 'tomorrow' })}>Tomorrow morning</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text-2)' }}>
            Pick a time
            <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} aria-label="Snooze until date and time" />
          </label>
          <button type="button" disabled={!at} style={choiceStyle} onClick={() => choose({ preset: 'custom', at })}>Snooze</button>
        </div>
      )}
    </>
  );
}
