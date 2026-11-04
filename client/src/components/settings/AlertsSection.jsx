import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';

const rowStyle = { padding: '16px 20px', borderBottom: '1px solid var(--border)' };
const labelStyle = { fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8, display: 'block' };
const hintStyle = { fontSize: 12.5, color: 'var(--muted)' };

// How often the page checks whether the Telegram link was completed, and how
// long it keeps checking (the one-time code expires after 15 minutes).
const POLL_MS = 3000;
const POLL_FOR_MS = 15 * 60 * 1000;

export default function AlertsSection() {
  const [data, setData]       = useState(null);   // null until the saved settings load
  const [status, setStatus]   = useState(null);
  const [busy, setBusy]       = useState(false);
  const [linkUrl, setLinkUrl] = useState(null);   // set while waiting for the user to finish in Telegram
  const [email, setEmail]     = useState('');

  const call = useCallback(async (url, opts, failMsg) => {
    const r = await apiFetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || failMsg);
    return d;
  }, []);

  useEffect(() => {
    let alive = true;
    call('/api/alerts/settings', undefined, 'Could not load your alert settings')
      .then(d => { if (alive) setData(d); })
      .catch(err => { if (alive) setStatus({ type: 'error', msg: err.message }); });
    return () => { alive = false; };
  }, [call]);

  // While the link is open, watch for the webhook to record the chat.
  useEffect(() => {
    if (!linkUrl) return undefined;
    const stopAt = Date.now() + POLL_FOR_MS;
    const timer = setInterval(async () => {
      if (Date.now() > stopAt) { setLinkUrl(null); return; }
      try {
        const d = await call('/api/alerts/settings', undefined, '');
        if (d.telegram.connected) {
          setData(d); setLinkUrl(null);
          setStatus({ type: 'success', msg: 'Telegram is connected.' });
        }
      } catch { /* keep waiting; the next check tries again */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [linkUrl, call]);

  async function run(fn, failMsg) {
    setBusy(true); setStatus(null);
    try { await fn(); }
    catch (err) { setStatus({ type: 'error', msg: err.message || failMsg }); }
    setBusy(false);
  }

  const saveSwitch = (field, value) => run(async () => {
    setData(await call('/api/alerts/settings', { method: 'PUT', body: JSON.stringify({ [field]: value }) }, 'Could not save your alert settings'));
  }, 'Could not save your alert settings');

  const connectTelegram = () => run(async () => {
    const { url } = await call('/api/alerts/telegram/link', { method: 'POST' }, 'Could not start linking Telegram');
    setLinkUrl(url);
  }, 'Could not start linking Telegram');

  const disconnectTelegram = () => run(async () => {
    setData(await call('/api/alerts/telegram', { method: 'DELETE' }, 'Could not disconnect Telegram'));
    setLinkUrl(null);
  }, 'Could not disconnect Telegram');

  const addVip = e => {
    e.preventDefault();
    return run(async () => {
      setData(await call('/api/alerts/vips', { method: 'POST', body: JSON.stringify({ email }) }, 'Could not add that VIP'));
      setEmail('');
    }, 'Could not add that VIP');
  };

  const removeVip = address => run(async () => {
    setData(await call('/api/alerts/vips', { method: 'DELETE', body: JSON.stringify({ email: address }) }, 'Could not remove that VIP'));
  }, 'Could not remove that VIP');

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {!data ? (
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: status?.type === 'error' ? 'var(--tag-danger-fg)' : 'var(--muted)' }}>
          {status?.msg ?? 'Loading…'}
        </div>
      ) : (
        <>
          <div style={rowStyle}>
            <span style={labelStyle}>Where alerts go</span>
            {!data.telegram.available ? (
              <span style={hintStyle}>Telegram alerts are not set up on this server yet, so nothing can be sent.</span>
            ) : data.telegram.connected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, color: 'var(--text)' }}>Telegram is connected.</span>
                <button onClick={disconnectTelegram} disabled={busy} style={{ padding: '5px 12px', fontSize: 13 }}>Disconnect</button>
              </div>
            ) : linkUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14 }}>Open Telegram and press Start</a>
                <span style={hintStyle}>Waiting for you to finish in Telegram. The link works once and expires in 15 minutes.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button className="primary" onClick={connectTelegram} disabled={busy} style={{ padding: '7px 16px', fontSize: 14 }}>Connect Telegram</button>
                <span style={hintStyle}>Until you connect it, you get no alerts.</span>
              </div>
            )}
          </div>

          <div style={rowStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text)', cursor: 'pointer' }}>
              <input id="alerts-vip" type="checkbox" checked={data.vipEnabled} disabled={busy}
                onChange={e => saveSwitch('vipEnabled', e.target.checked)} style={{ margin: 0, accentColor: 'var(--accent)' }} />
              Alert me when a VIP emails me
            </label>
          </div>

          <div style={rowStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text)', cursor: 'pointer' }}>
              <input id="alerts-review" type="checkbox" checked={data.reviewEnabled} disabled={busy}
                onChange={e => saveSwitch('reviewEnabled', e.target.checked)} style={{ margin: 0, accentColor: 'var(--accent)' }} />
              Alert me when I am asked to review a pull request
            </label>
            {!data.githubConnected && (
              <span style={{ ...hintStyle, display: 'block', marginTop: 6 }}>Connect GitHub above to get these.</span>
            )}
          </div>

          <div style={rowStyle}>
            <label htmlFor="vip-email" style={labelStyle}>VIP senders</label>
            <form onSubmit={addVip} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input id="vip-email" type="email" value={email} placeholder="boss@company.com" required
                onChange={e => { setEmail(e.target.value); setStatus(null); }} style={{ flex: '1 1 240px' }} />
              <button className="primary" type="submit" disabled={busy || !email.trim()} style={{ padding: '7px 16px', fontSize: 14 }}>Add</button>
            </form>
            <span style={{ ...hintStyle, display: 'block', marginTop: 6 }}>
              An email counts only if it comes from exactly this address. New mail only: nothing already in your inbox is sent. An alert includes the sender and the subject line, and goes through Telegram.
            </span>
            {data.vips.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.vips.map(v => (
                  <li key={v.email} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text)' }}>
                    <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{v.name ? `${v.name} · ${v.email}` : v.email}</span>
                    <button onClick={() => removeVip(v.email)} disabled={busy} aria-label={`Remove ${v.email}`}
                      style={{ padding: '3px 10px', fontSize: 12.5 }}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {status && (
            <div role="status" style={{
              padding: '10px 20px', fontSize: 13, lineHeight: 1.5,
              color: status.type === 'success' ? 'var(--tag-success-fg)' : 'var(--tag-danger-fg)',
              background: status.type === 'success' ? 'var(--tag-success-bg)' : 'var(--tag-danger-bg)',
            }}>
              {status.msg}
            </div>
          )}
        </>
      )}
    </div>
  );
}
