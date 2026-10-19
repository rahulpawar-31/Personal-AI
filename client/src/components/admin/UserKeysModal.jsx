import { useEffect, useState } from 'react';
import { apiFetch } from '../../api.js';
import { Modal } from '../settings/primitives.jsx';
import { groupKeysByService } from '../../serviceLabels.js';

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// Admin view of what one account has saved. Shows service, key name, date and
// whether the key still decrypts. Values are never sent by the server.
export default function UserKeysModal({ user, onClose }) {
  const [rows,  setRows]  = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setRows(null); setError(null);
    (async () => {
      try {
        const r = await apiFetch(`/api/admin/users/${user.id}/keys`);
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(body.error || 'Could not load keys');
        else setRows(body);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const groups = groupKeysByService(rows);

  return (
    <Modal open={Boolean(user)} onClose={onClose} title={user ? `Saved keys · ${user.username}` : ''}>
      {error && <p style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</p>}
      {!error && rows === null && <p style={{ fontSize: 14, color: 'var(--muted)' }}>Loading…</p>}
      {rows && rows.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>This account has no saved keys.</p>}
      {groups.map(g => (
        <div key={g.service} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
            {g.label}{' '}
            {g.keys.some(k => k.serviceConnected)
              ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>connected</span>
              : <span style={{ color: 'var(--danger)', fontWeight: 400 }}>not connected</span>}
          </div>
          {g.keys.map(k => (
            <div key={k.keyName} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <code style={{ wordBreak: 'break-all' }}>{k.keyName}</code>
              <span style={{ color: k.unreadable ? 'var(--danger)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                {k.unreadable ? 'unreadable · ' : ''}{fmtDate(k.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      ))}
      {rows && rows.length > 0 && <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Only names and dates are shown, never the keys themselves.</p>}
    </Modal>
  );
}
