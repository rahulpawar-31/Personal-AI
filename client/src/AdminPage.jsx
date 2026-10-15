import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './api.js';
import { toast } from './toast.jsx';
import { serviceLabels } from './serviceLabels.js';
import { LoadingState, ErrorState } from './components/ui/States.jsx';
import UserKeysModal from './components/admin/UserKeysModal.jsx';

export default function AdminPage({ user }) {
  const [users,   setUsers]   = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const armedAt = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ur, sr] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/stats'),
      ]);
      if (!ur.ok) { setError('Not authorized'); setLoading(false); return; }
      setUsers(await ur.json());
      setStats(await sr.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Two-step delete: the confirm state resets itself after a few seconds.
  useEffect(() => {
    if (confirmingId === null) return undefined;
    const t = setTimeout(() => setConfirmingId(null), 4000);
    return () => clearTimeout(t);
  }, [confirmingId]);

  // A fast double-click on Delete would otherwise hit "Confirm delete" before
  // anyone can read it, so a confirm click right after arming is ignored.
  function onDeleteClick(u) {
    if (confirmingId !== u.id) {
      armedAt.current = Date.now();
      setConfirmingId(u.id);
    } else if (Date.now() - armedAt.current > 500) {
      deleteUser(u);
    }
  }

  async function deleteUser(u) {
    setConfirmingId(null);
    setDeleting(u.id);
    try {
      const r = await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      if (!r.ok) { toast((await r.json()).error, 'error'); }
      else await load();
    } finally {
      setDeleting(null);
    }
  }

  async function toggleAdmin(u) {
    try {
      await apiFetch(`/api/admin/users/${u.id}/admin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: !u.isAdmin }),
      });
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  const fmt = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const roleToggleTitle = isAdmin => (isAdmin ? 'Remove admin' : 'Make admin');

  if (loading) return <LoadingState label="Loading admin dashboard…" />;
  if (error)   return <ErrorState title="Couldn't load the admin dashboard" description={error} onRetry={load} />;

  return (
    <div style={{ maxWidth: 900 }}>
      <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Admin dashboard</h2>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 24 }}>Manage users and view system health.</p>

      {/* Stats row */}
      {stats && (
        <div className="grid-stat-4" style={{ marginBottom: 28 }}>
          {[
            { label: 'Total users',     val: stats.userCount },
            { label: 'Admins',          val: stats.adminCount },
            { label: 'Saved keys (all)', val: stats.integrationRows },
            { label: 'Uptime (s)',       val: stats.uptime },
          ].map(s => (
            <div key={s.label} style={{
              background: 'var(--surface)', border: '0.5px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 500 }}>{s.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Users table */}
      <div className="scroll-x" style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid var(--border)', background: 'var(--bg)' }}>
              {['ID', 'Username', 'Email', 'Keys', 'Connected', 'Joined', 'Role', ''].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 500, color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr
                key={u.id}
                onClick={() => setViewing(u)}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setViewing(u); } }}
                tabIndex={0}
                title="Show saved keys"
                style={{ cursor: 'pointer', borderBottom: i < users.length - 1 ? '0.5px solid var(--border)' : 'none' }}
              >
                <td style={{ padding: '9px 12px', color: 'var(--muted)' }}>{u.id}</td>
                <td style={{ padding: '9px 12px', fontWeight: 500 }}>
                  {u.username}
                  {u.id === user.id && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', background: 'rgba(29,158,117,.1)', padding: '1px 5px', borderRadius: 8 }}>you</span>}
                </td>
                <td style={{ padding: '9px 12px', color: 'var(--muted)' }}>{u.email ?? '—'}</td>
                <td style={{ padding: '9px 12px' }}>
                  <span style={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '2px 8px', fontSize: 12 }}>
                    {u.integrationCount}
                  </span>
                </td>
                <td style={{ padding: '9px 12px', color: 'var(--muted)', maxWidth: 240 }}>
                  {serviceLabels(u.connectedServices).join(', ') || 'None'}
                </td>
                <td style={{ padding: '9px 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(u.createdAt)}</td>
                <td style={{ padding: '9px 12px' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => u.id !== user.id && toggleAdmin(u)}
                    disabled={u.id === user.id}
                    title={u.id === user.id ? 'Cannot change your own role' : roleToggleTitle(u.isAdmin)}
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: u.id === user.id ? 'default' : 'pointer',
                      background: u.isAdmin ? 'rgba(29,158,117,.1)' : 'var(--bg)',
                      border: `0.5px solid ${u.isAdmin ? 'var(--accent)' : 'var(--border)'}`,
                      color: u.isAdmin ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {u.isAdmin ? 'Admin' : 'User'}
                  </button>
                </td>
                <td style={{ padding: '9px 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                  {u.id !== user.id && (
                    <>
                      {confirmingId === u.id && (
                        <button
                          onClick={() => setConfirmingId(null)}
                          style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', marginRight: 6 }}
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteClick(u)}
                        disabled={deleting === u.id}
                        title={confirmingId === u.id ? `Permanently delete "${u.username}"` : undefined}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer' }}
                      >
                        {deleting === u.id ? '…' : confirmingId === u.id ? 'Confirm delete' : 'Delete'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)' }}>
        Node {stats?.nodeVersion} · server uptime {Math.floor((stats?.uptime ?? 0) / 60)}m
      </p>

      <UserKeysModal user={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
