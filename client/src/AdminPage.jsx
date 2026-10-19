import PageHeader from './components/PageHeader.jsx';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useMediaQuery } from './useMediaQuery.js';
import { apiFetch } from './api.js';
import { toast } from './toast.jsx';
import { serviceLabels } from './serviceLabels.js';
import { LoadingState, ErrorState } from './components/ui/States.jsx';
import UserKeysModal from './components/admin/UserKeysModal.jsx';
import EncryptionCard from './components/admin/EncryptionCard.jsx';
import NetworkCard from './components/admin/NetworkCard.jsx';

export default function AdminPage({ user }) {
  const [users,   setUsers]   = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [roleFilter, setRoleFilter] = useState('all');
  const phone = useMediaQuery('(max-width: 768px)');
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

  const shown = users.filter(u => roleFilter === 'all' || (roleFilter === 'admin' ? u.isAdmin : !u.isAdmin));
  const byService = (() => {
    const counts = {};
    users.forEach(u => (u.connectedServices ?? []).forEach(id => { counts[id] = (counts[id] ?? 0) + 1; }));
    const max = Math.max(1, ...Object.values(counts));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ name: serviceLabels([id])[0], n, pct: `${Math.round((n / max) * 100)}%` }));
  })();
  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
  const COLS = '52px minmax(120px, 1.2fr) minmax(120px, 1.6fr) 70px 120px 92px 200px';
  const roleButton = (u, you) => (
    <button
      onClick={() => !you && toggleAdmin(u)}
      disabled={you}
      title={you ? 'Cannot change your own role' : roleToggleTitle(u.isAdmin)}
      aria-label={you ? 'Cannot change your own role' : roleToggleTitle(u.isAdmin)}
      style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, cursor: you ? 'default' : 'pointer', background: u.isAdmin ? 'var(--accent-ring)' : 'var(--surface-sunken)', border: `1px solid ${u.isAdmin ? 'var(--accent)' : 'var(--border)'}`, color: u.isAdmin ? 'var(--accent)' : 'var(--text-2)', fontSize: 13, fontWeight: 600 }}
    >
      {u.isAdmin ? 'Admin' : 'User'}
    </button>
  );
  const deleteButtons = (u, you) => (
    <>
      {!you && confirmingId === u.id && (
        <button onClick={() => setConfirmingId(null)} style={{ minHeight: 40, padding: '0 12px', border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text-2)', fontSize: 13, fontWeight: 500 }}>Cancel</button>
      )}
      {!you && (
        <button
          onClick={() => onDeleteClick(u)}
          disabled={deleting === u.id}
          title={confirmingId === u.id ? `Permanently delete "${u.username}"` : undefined}
          style={{ minHeight: 40, padding: '0 14px', border: `1px solid ${confirmingId === u.id ? 'var(--danger)' : 'var(--border-strong)'}`, borderRadius: 8, background: confirmingId === u.id ? 'var(--danger)' : 'var(--surface)', color: confirmingId === u.id ? '#fff' : 'var(--danger)', fontSize: 13, fontWeight: 600 }}
        >
          {deleting === u.id ? '…' : confirmingId === u.id ? 'Confirm delete' : 'Delete'}
        </button>
      )}
    </>
  );
  const uptimeText = stats ? (stats.uptime >= 3600 ? `${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m` : `${Math.floor(stats.uptime / 60)}m`) : '—';

  return (
    <div style={{ maxWidth: 1280 }}>
      <PageHeader eyebrow="Admin only" title="Admin dashboard" subtitle="Manage users and view system health.">
        <button type="button" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 18px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', fontSize: 14.5, fontWeight: 600 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.5-5.8 M20 4v5h-5" /></svg>
          Refresh
        </button>
      </PageHeader>

      {stats && (
        <section aria-label="Totals" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Total users',      val: stats.userCount,      note: 'Accounts on this deployment' },
            { label: 'Admins',           val: stats.adminCount,     note: 'Can manage users' },
            { label: 'Saved keys (all)', val: stats.integrationRows, note: 'Across every user' },
            { label: 'Uptime',           val: uptimeText,           note: `Node ${stats.nodeVersion ?? ''}` },
          ].map(st => (
            <div key={st.label} style={{ ...card, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{st.label}</span>
              <span style={{ fontSize: 32, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>{st.val}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{st.note}</span>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

        <section aria-label="Users" style={{ ...card, flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 22px' }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em' }}>Users <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 15 }}>{shown.length}</span></h2>
            <div role="group" aria-label="Role filter" style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['admin', 'Admins'], ['user', 'Users']].map(([id, label]) => {
                const on = roleFilter === id;
                return <button key={id} type="button" aria-pressed={on} onClick={() => setRoleFilter(id)} style={{ minHeight: 40, padding: '0 16px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 999, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-2)', fontSize: 14, fontWeight: 500 }}>{label}</button>;
              })}
            </div>
          </div>
          {phone ? (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {shown.map(u => {
                const you = u.id === user.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => setViewing(u)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setViewing(u); } }}
                    tabIndex={0}
                    title="Show saved keys"
                    style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ width: 36, height: 36, flex: 'none', borderRadius: 999, background: u.isAdmin ? 'var(--sidebar-bg)' : 'var(--surface-sunken)', color: u.isAdmin ? 'var(--accent-soft)' : 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>{u.username?.charAt(0).toUpperCase()}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{u.username}</span>
                          {you && <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 600, color: 'var(--tag-success-fg)', background: 'var(--tag-success-bg)', padding: '2px 7px', borderRadius: 999 }}>you</span>}
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>{u.email ?? '—'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                      <span>ID {u.id}</span><span>{u.integrationCount} keys</span><span>Joined {fmt(u.createdAt)}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
                      {roleButton(u, you)}
                      <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>{deleteButtons(u, you)}</span>
                    </div>
                  </div>
                );
              })}
              {shown.length === 0 && <div style={{ padding: '36px 22px', textAlign: 'center', color: 'var(--muted)', fontSize: 15 }}>No users match this filter.</div>}
            </div>
          ) : (
          <div className="scroll-x">
            <div style={{ minWidth: 780 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, padding: '10px 22px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                <span>ID</span><span>Username</span><span>Email</span><span>Keys</span><span>Joined</span><span>Role</span><span style={{ textAlign: 'right' }}>Actions</span>
              </div>
              {shown.map(u => {
                const you = u.id === user.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => setViewing(u)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setViewing(u); } }}
                    tabIndex={0}
                    title="Show saved keys"
                    style={{ display: 'grid', gridTemplateColumns: COLS, gap: 12, alignItems: 'center', padding: '12px 22px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--muted)' }}>{u.id}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, minWidth: 0 }}>
                      <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 999, background: u.isAdmin ? 'var(--sidebar-bg)' : 'var(--surface-sunken)', color: u.isAdmin ? 'var(--accent-soft)' : 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>{u.username?.charAt(0).toUpperCase()}</span>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.username}</span>
                      {you && <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 600, color: 'var(--tag-success-fg)', background: 'var(--tag-success-bg)', padding: '2px 7px', borderRadius: 999 }}>you</span>}
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email ?? '—'}</span>
                    <span><span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 999, background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}>{u.integrationCount}</span></span>
                    <span style={{ fontSize: 13.5, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmt(u.createdAt)}</span>
                    <span onClick={e => e.stopPropagation()}>
                      {roleButton(u, you)}
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {deleteButtons(u, you)}
                    </span>
                  </div>
                );
              })}
              {shown.length === 0 && <div style={{ padding: '36px 22px', textAlign: 'center', color: 'var(--muted)', fontSize: 15, borderTop: '1px solid var(--border)' }}>No users match this filter.</div>}
            </div>
          </div>
          )}
          <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--muted)' }}>
            Deleting a user is permanent. You cannot change your own role or delete yourself.
          </div>
        </section>

        <aside aria-label="System" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section style={{ background: 'var(--sidebar-bg)', color: 'var(--bg)', borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-soft)' }}>System health</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--accent-soft)' }} />
              <span style={{ fontSize: 20, fontWeight: 600 }}>API running</span>
            </div>
            <div>
              {[['Node version', stats?.nodeVersion ?? '—'], ['Server uptime', uptimeText]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid #2A2D30', fontSize: 14 }}>
                  <span style={{ color: '#B9B8B1' }}>{k}</span><span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>
                </div>
              ))}
            </div>
          </section>

          <EncryptionCard />
          <NetworkCard />

          <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Connections by service</h2>
            {byService.length === 0 && <p style={{ fontSize: 14, color: 'var(--muted)' }}>No services connected yet.</p>}
            {byService.map(k => (
              <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32 }}>
                <span style={{ width: 90, flex: 'none', fontSize: 14 }}>{k.name}</span>
                <span style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: 8, width: k.pct, background: 'var(--accent)', borderRadius: 999 }} />
                </span>
                <span style={{ width: 20, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)' }}>{k.n}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>

      <UserKeysModal user={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
