import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';

function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; }
  catch { return null; }
}

// Every zone the browser knows, with the ones we need guaranteed to be present.
function zoneOptions(...required) {
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* older browsers: just the required zones */ }
  return [...new Set([...zones, ...required.filter(Boolean)])].sort();
}

const CHANNELS = [
  { id: 'slack', label: 'Slack message', hint: 'Needs your Slack bot token above. Also shows on Today.' },
  { id: 'app',   label: 'In the app only', hint: 'Shows on Today, nothing is sent anywhere.' },
];

const rowStyle = { padding: '16px 20px', borderBottom: '1px solid var(--border)' };
const labelStyle = { fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8, display: 'block' };

export default function BriefSection() {
  const [form, setForm]     = useState(null);   // null until the saved settings load
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch('/api/digest/settings');
        let d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load your brief settings');
        // First visit: until a timezone is saved, briefs follow the server's. Save
        // the one this browser reports so the brief arrives at the user's own 9:00.
        const tz = browserTimezone();
        if (!d.timezoneSaved && tz) {
          const saved = await apiFetch('/api/digest/settings', { method: 'PUT', body: JSON.stringify({ timezone: tz }) });
          if (saved.ok) d = await saved.json();
        }
        if (alive) setForm({
          enabled: d.enabled, time: d.time, timezone: d.timezone ?? d.serverTimezone, channel: d.channel,
          wrapupEnabled: d.wrapupEnabled, wrapupTime: d.wrapupTime,
        });
      } catch (err) {
        if (alive) setStatus({ type: 'error', msg: err.message || 'Could not load your brief settings' });
      }
    })();
    return () => { alive = false; };
  }, []);

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setStatus(null);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const r = await apiFetch('/api/digest/settings', { method: 'PUT', body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save your brief settings');
      const parts = [
        form.enabled ? `morning brief at ${form.time}` : null,
        form.wrapupEnabled ? `end-of-day wrap-up at ${form.wrapupTime}` : null,
      ].filter(Boolean);
      setStatus({ type: 'success', msg: parts.length ? `Saved. Next up: ${parts.join(' and ')} (${form.timezone}).` : 'Saved. Both are off.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Could not save your brief settings. Try again.' });
    }
    setSaving(false);
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {!form ? (
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: status?.type === 'error' ? 'var(--tag-danger-fg)' : 'var(--muted)' }}>
          {status?.msg ?? 'Loading…'}
        </div>
      ) : (
        <>
          <div style={rowStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text)', cursor: 'pointer' }}>
              <input id="brief-enabled" type="checkbox" checked={form.enabled}
                onChange={e => set('enabled', e.target.checked)} style={{ margin: 0, accentColor: 'var(--accent)' }} />
              Send me a morning brief
            </label>
          </div>

          <div style={{ ...rowStyle, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ opacity: form.enabled ? 1 : 0.5 }}>
              <label htmlFor="brief-time" style={labelStyle}>Time</label>
              <input id="brief-time" type="time" value={form.time} disabled={!form.enabled}
                onChange={e => set('time', e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="brief-timezone" style={labelStyle}>Timezone</label>
              <select id="brief-timezone" value={form.timezone}
                onChange={e => set('timezone', e.target.value)} style={{ width: '100%' }}>
                {zoneOptions(form.timezone, browserTimezone()).map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>
                Also used for the times of calendar events Dayhand creates and for your 7 AM calendar check.
              </span>
            </div>
          </div>

          <div style={{ ...rowStyle, display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--text)', cursor: 'pointer', flex: '1 1 260px' }}>
              <input id="wrapup-enabled" type="checkbox" checked={form.wrapupEnabled}
                onChange={e => set('wrapupEnabled', e.target.checked)} style={{ margin: 0, accentColor: 'var(--accent)' }} />
              Send me an end-of-day wrap-up
            </label>
            <div style={{ opacity: form.wrapupEnabled ? 1 : 0.5 }}>
              <label htmlFor="wrapup-time" style={labelStyle}>Time</label>
              <input id="wrapup-time" type="time" value={form.wrapupTime} disabled={!form.wrapupEnabled}
                onChange={e => set('wrapupTime', e.target.value)} />
            </div>
            <span style={{ flexBasis: '100%', fontSize: 12.5, color: 'var(--muted)' }}>
              What you finished, what is still open, today's meetings, and a standup note to copy.
            </span>
          </div>

          <div style={{ ...rowStyle, opacity: form.enabled || form.wrapupEnabled ? 1 : 0.5 }}>
            <span style={labelStyle} id="brief-channel-label">Where they go</span>
            <div role="radiogroup" aria-labelledby="brief-channel-label" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CHANNELS.map(c => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: form.enabled || form.wrapupEnabled ? 'pointer' : 'default' }}>
                  <input type="radio" name="brief-channel" value={c.id} checked={form.channel === c.id} disabled={!form.enabled && !form.wrapupEnabled}
                    onChange={() => set('channel', c.id)} style={{ margin: '3px 0 0', accentColor: 'var(--accent)' }} />
                  <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 14, color: 'var(--text)' }}>{c.label}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {status && (
            <div role="status" style={{
              padding: '10px 20px', fontSize: 13, lineHeight: 1.5, borderBottom: '1px solid var(--border)',
              color: status.type === 'success' ? 'var(--tag-success-fg)' : 'var(--tag-danger-fg)',
              background: status.type === 'success' ? 'var(--tag-success-bg)' : 'var(--tag-danger-bg)',
            }}>
              {status.msg}
            </div>
          )}

          <div style={{ padding: '14px 20px' }}>
            <button className="primary" onClick={save} disabled={saving || !form.time || !form.wrapupTime}
              style={{ padding: '7px 16px', fontSize: 14 }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
