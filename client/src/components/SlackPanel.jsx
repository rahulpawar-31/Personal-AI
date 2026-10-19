import { useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import NotConnected from './NotConnected.jsx';

export default function SlackPanel({ health = {}, onGoToSettings }) {
  const [message,  setMessage]  = useState('');
  const [log,      setLog]      = useState([]);
  const [loading,  setLoading]  = useState('');
  const [digest,   setDigest]   = useState(null);

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

  return (
    <div>
      <PageHeader eyebrow="Social" title="Slack" subtitle="Send yourself a message or run the morning digest.">
        <span className="tag tag-success" style={{ fontSize: 12.5, padding: '5px 12px', borderRadius: 999 }}>● Connected</span>
      </PageHeader>

      {/* Send DM */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 20 }}>
        <h2 className="t-h2" style={{ marginBottom: 12 }}>Send yourself a message</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Type a message…"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendDM()}
            disabled={loading === 'dm'}
          />
          <button className="primary" onClick={sendDM} disabled={loading === 'dm' || !message.trim()}>
            {loading === 'dm' ? 'Sending…' : 'Send'}
          </button>
        </div>
        {log.length > 0 && (
          <div role="status" aria-live="polite" style={{ marginTop: 10 }}>
            {log.slice(0, 5).map((l, i) => (
              <div key={`${l.at}-${i}`} style={{ fontSize: 12.5, color: l.ok ? 'var(--success)' : 'var(--danger)', marginBottom: 3 }}>
                {l.ok ? '✓' : '✗'} {l.text} <span style={{ opacity: 0.5 }}>{l.at}</span>
                {l.error && <span> — {l.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Digest */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <h2 className="t-h2">Morning digest</h2>
            <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 2 }}>Runs automatically at 9 AM — sends to your Slack DM</div>
          </div>
          <button className="primary" onClick={runDigest} disabled={loading === 'digest'}>
            {loading === 'digest' ? 'Running…' : 'Run now'}
          </button>
        </div>
        {digest && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
            <div>Emails pending: <strong style={{ color: 'var(--text)' }}>{digest.comms?.pending?.length ?? 0}</strong></div>
            <div>Calendar conflicts: <strong style={{ color: 'var(--text)' }}>{digest.calendar?.conflicts?.length ?? 0}</strong></div>
            <div>Blockers: <strong style={{ color: 'var(--text)' }}>{digest.tasks?.blockers?.length ?? 0}</strong></div>
            <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--muted)' }}>Sent to Slack at {new Date(digest.generatedAt).toLocaleTimeString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
