import { useState } from 'react';
import { apiFetch } from '../../api.js';

export default function AccountSection({ user, onLogout }) {
  const [email, setEmail]           = useState(user.email || '');
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass]         = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [deletePass, setDeletePass]   = useState('');
  const [showDelete, setShowDelete]   = useState(false);
  const [status, setStatus]           = useState(null);
  const [saving, setSaving]           = useState(false);

  async function saveEmail() {
    setSaving('email');
    setStatus(null);
    const r = await apiFetch('/api/users/me/email', { method: 'PUT', body: JSON.stringify({ email }) });
    const d = await r.json();
    setSaving(false);
    setStatus(d.ok ? { type: 'success', msg: 'Email updated.' } : { type: 'error', msg: d.error });
  }

  async function changePassword() {
    if (newPass !== confirmPass) return setStatus({ type: 'error', msg: 'Passwords do not match' });
    setSaving('password');
    setStatus(null);
    const r = await apiFetch('/api/users/me/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
    });
    const d = await r.json();
    setSaving(false);
    if (d.ok) {
      setCurrentPass(''); setNewPass(''); setConfirmPass('');
      setStatus({ type: 'success', msg: 'Password changed.' });
    } else {
      setStatus({ type: 'error', msg: d.error });
    }
  }

  async function deleteAccount() {
    const r = await apiFetch('/api/users/me', { method: 'DELETE', body: JSON.stringify({ password: deletePass }) });
    const d = await r.json();
    if (d.ok) {
      localStorage.removeItem('devos_token');
      window.location.href = '/';
    } else {
      setStatus({ type: 'error', msg: d.error });
    }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      {/* Profile row */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 16,
        }}>
          {user.username?.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>@{user.username}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Personal account</div>
        </div>
      </div>

      {/* Email */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Email address</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            aria-label="Email address"
            style={{ flex: 1, minWidth: 180 }}
          />
          <button
            className="primary"
            onClick={saveEmail}
            disabled={saving === 'email'}
            style={{ padding: '0 16px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {saving === 'email' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Password */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Change password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 400 }}>
          <input aria-label="Current password" type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Current password" />
          <input aria-label="New password" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="New password (min 8 chars)" />
          <input aria-label="Confirm new password" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirm new password" />
          <div style={{ marginTop: 4 }}>
            <button
              className="primary"
              onClick={changePassword}
              disabled={!currentPass || !newPass || saving === 'password'}
              style={{ padding: '7px 16px', fontSize: 13 }}
            >
              {saving === 'password' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </div>
      </div>

      {status && (
        <div style={{
          margin: '0 20px 0', padding: '10px 14px',
          fontSize: 12, lineHeight: 1.5,
          color: status.type === 'success' ? '#1B5E20' : '#B71C1C',
          background: status.type === 'success' ? '#E8F5E9' : '#FDECEA',
          borderBottom: '1px solid var(--border)',
        }}>
          {status.msg}
        </div>
      )}

      {/* Danger zone */}
      <div style={{ padding: '16px 20px', background: 'var(--bg)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--danger)', marginBottom: 10 }}>
          Danger zone
        </div>
        {!showDelete ? (
          <button
            onClick={() => setShowDelete(true)}
            style={{ fontSize: 12, color: 'var(--danger)', padding: '5px 12px', border: '1px solid var(--danger)', borderRadius: 6, background: 'transparent' }}
          >
            Delete account
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              This will permanently delete your account and all stored keys. Enter your password to confirm.
            </p>
            <input
              type="password"
              value={deletePass}
              onChange={e => setDeletePass(e.target.value)}
              placeholder="Your password"
              aria-label="Confirm your password to delete account"
              style={{ borderColor: 'var(--danger)' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={deleteAccount}
                disabled={!deletePass}
                className="danger"
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                Delete my account
              </button>
              <button onClick={() => setShowDelete(false)} style={{ fontSize: 12, padding: '6px 14px' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
