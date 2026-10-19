import { useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import NotConnected from './NotConnected.jsx';

export default function SlackPanel({ health = {}, onGoToSettings }) {
  const [message,  setMessage]  = useState('');
  const [log,      setLog]      = useState([]);
  const [loading,  setLoading]  = useState('');
  const [digest,   setDigest]   = useState(null);
  const [view,     setView]     = useState('dm');

  const connected = Boolean(health.slack);

  async function sendDM() {
    if (!message.trim()) return;
    setLoading('dm');
    try {
      const r = await apiFetch('/api/slack/send', {
        method: 'POST',
        body: JSON.stringify({ text: message }),
      });
      const data = await r.json();
      if (data.ok) {
        setLog(l => [{ text: message, at: new Date().toLocaleTimeString(), ok: true }, ...l]);
        setMessage('');
      } else {
        setLog(l => [{ text: message, at: new Date().toLocaleTimeString(), ok: false, error: data.error }, ...l]);
      }
    } catch (err) {
      setLog(l => [{ text: message, at: new Date().toLocaleTimeString(), ok: false, error: err.message }, ...l]);
    } finally { setLoading(''); }
  }

  async function runDigest() {
    setLoading('digest');
    try {
      const r = await apiFetch('/api/digest/run', { method: 'POST' });
      const data = await r.json();
      if (r.ok) setDigest(data);
    } finally { setLoading(''); }
  }

  if (!connected) return (
    <div>
      <PageHeader eyebrow="Social" title="Slack" subtitle="Send messages and run team digests." />
      <NotConnected
        title="Slack not connected"
        description="Add your Slack bot token in Settings to send messages, run team digests, and get alerts."
        primaryLabel="Go to Settings"
        onPrimary={onGoToSettings}
      />
    </div>
  );

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
  const dest = [
    { id: 'dm',     name: 'Direct message', note: 'To yourself', count: log.filter(l => l.ok).length },
    { id: 'digest', name: 'Morning digest', note: '9 AM daily',  count: 0 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PageHeader eyebrow="Social" title="Slack" subtitle={`Connected. ${log.filter(l => l.ok).length} sent this session.`} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'stretch' }}>

        <section aria-label="Destinations" style={{ ...card, flex: '1 1 240px', maxWidth: 280, padding: 14, display: 'flex', flexDirection: 'column', gap: 4, alignSelf: 'flex-start' }}>
          <div style={{ padding: '4px 10px 8px', fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Send to</div>
          {dest.map(d => {
            const on = view === d.id;
            return (
              <button key={d.id} type="button" aria-pressed={on} onClick={() => setView(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', border: 0, borderRadius: 10, padding: '0 12px', minHeight: 52, background: on ? 'var(--surface-sunken)' : 'transparent', fontSize: 14.5, fontWeight: on ? 600 : 500 }}>
                <span style={{ color: 'var(--muted)' }}>#</span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span>{d.name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--muted)' }}>{d.note}</span>
                </span>
                {d.count > 0 && <span style={{ minWidth: 22, textAlign: 'center', padding: '2px 6px', borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 11.5, fontWeight: 600 }}>{d.count}</span>}
              </button>
            );
          })}
        </section>

        <section aria-label="Messages" style={{ ...card, flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 480 }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}># {view === 'dm' ? 'Direct message' : 'Morning digest'}</h2>
            <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{view === 'dm' ? 'Messages go to your own Slack DM.' : 'Runs automatically at 9 AM and posts to your Slack DM.'}</span>
          </div>

          {view === 'dm' && (
            <>
              <div role="status" aria-live="polite" style={{ flex: 1, padding: '8px 24px', display: 'flex', flexDirection: 'column' }}>
                {log.length === 0 && <p style={{ padding: '24px 0', color: 'var(--muted)', fontSize: 15 }}>Nothing sent yet. Type a message below.</p>}
                {log.map((l, i) => (
                  <div key={`${l.at}-${i}`} style={{ display: 'flex', gap: 14, padding: '16px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 10, background: l.ok ? 'var(--text)' : 'var(--tag-danger-bg)', color: l.ok ? 'var(--accent-soft)' : 'var(--tag-danger-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>{l.ok ? 'Y' : '!'}</span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{l.ok ? 'You' : 'Not sent'}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>{l.at}</span>
                      </span>
                      <span style={{ fontSize: 15, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{l.text}</span>
                      {l.error && <span style={{ fontSize: 13.5, color: 'var(--danger)' }}>{l.error}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={e => { e.preventDefault(); sendDM(); }} style={{ margin: '0 24px 24px', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 16px', border: '1px solid var(--border-strong)', borderRadius: 14 }}>
                <label htmlFor="slack-msg" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message yourself</label>
                <input id="slack-msg" type="text" placeholder="Message yourself" value={message} onChange={e => setMessage(e.target.value)} disabled={loading === 'dm'} style={{ flex: 1, minWidth: 0, minHeight: 44, border: 0, background: 'transparent', padding: 0, boxShadow: 'none', fontSize: 15 }} />
                <button type="submit" className="primary" disabled={loading === 'dm' || !message.trim()} style={{ minHeight: 44, padding: '0 18px', fontSize: 14.5 }}>
                  {loading === 'dm' ? 'Sending…' : 'Send'}
                </button>
              </form>
            </>
          )}

          {view === 'digest' && (
            <div style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--text-2)', maxWidth: 520 }}>
                The digest scans your mail, calendar and tasks and sends a short summary to your Slack DM. You can also run it now.
              </p>
              <div><button className="primary" onClick={runDigest} disabled={loading === 'digest'} style={{ minHeight: 44, padding: '0 20px', fontSize: 14.5 }}>
                {loading === 'digest' ? 'Running…' : 'Run now'}
              </button></div>
              {digest && (
                <div style={{ padding: '16px 18px', borderRadius: 12, background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14.5, color: 'var(--text-2)' }}>
                  <div>Emails pending: <strong style={{ color: 'var(--text)' }}>{digest.comms?.pending?.length ?? 0}</strong></div>
                  <div>Calendar conflicts: <strong style={{ color: 'var(--text)' }}>{digest.calendar?.conflicts?.length ?? 0}</strong></div>
                  <div>Blockers: <strong style={{ color: 'var(--text)' }}>{digest.tasks?.blockers?.length ?? 0}</strong></div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 4, color: 'var(--muted)' }}>Sent to Slack at {new Date(digest.generatedAt).toLocaleTimeString()}</div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
