import { useState } from 'react';
import { apiFetch, clearToken, clearCachedData } from '../../api.js';
import RolePicker from '../RolePicker.jsx';

export default function AccountSection({ user, onLogout, onUserChange }) {
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

  async function saveRole(role) {
    setSaving('role');
    setStatus(null);
    try {
      const r = await apiFetch('/api/users/me/role', { method: 'PUT', body: JSON.stringify({ role }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Could not save your role');
      onUserChange?.({ ...user, role });
      setStatus({ type: 'success', msg: 'Role updated.' });
    } catch (err) {
      setStatus({ type: 'error', msg: err.message || 'Could not save your role. Try again.' });
    }
    setSaving(false);
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
      clearToken();
      clearCachedData();
      window.location.href = '/';
    } else {
      setStatus({ type: 'error', msg: d.error });
    }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      {/* Email */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Email address</div>
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
            style={{ padding: '0 16px', fontSize: 14, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {saving === 'email' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Role */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Your role</div>
        <div style={{ maxWidth: 400 }}>
          <RolePicker name="settings-role" value={user.role ?? null} onChange={saveRole} disabled={saving === 'role'} />
        </div>
      </div>

      {/* Password */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>Change password</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 400 }}>
          <input aria-label="Current password" type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Current password" />
          <input aria-label="New password" type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="New password (min 8 chars)" />
          <input aria-label="Confirm new password" type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Confirm new password" />
          <div style={{ marginTop: 4 }}>
            <button
              className="primary"
              onClick={changePassword}
              disabled={!currentPass || !newPass || saving === 'password'}
              style={{ padding: '7px 16px', fontSize: 14 }}
            >
              {saving === 'password' ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </div>
      </div>

      {status && (
        <div style={{
          margin: '0 20px 0', padding: '10px 14px',
          fontSize: 13, lineHeight: 1.5,
          color: status.type === 'success' ? 'var(--tag-success-fg)' : 'var(--tag-danger-fg)',
          background: status.type === 'success' ? 'var(--tag-success-bg)' : 'var(--tag-danger-bg)',
          borderBottom: '1px solid var(--border)',
        }}>
          {status.msg}
        </div>
      )}

      {/* Danger zone */}
      <div style={{ padding: '16px 20px', background: 'var(--bg)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--danger)', marginBottom: 10 }}>
          Danger zone
        </div>
        {!showDelete ? (
          <button
            onClick={() => setShowDelete(true)}
            style={{ fontSize: 13, color: 'var(--danger)', padding: '5px 12px', border: '1px solid var(--danger)', borderRadius: 6, background: 'transparent' }}
          >
            Delete account
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
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
                style={{ fontSize: 13, padding: '6px 14px' }}
              >
                Delete my account
              </button>
              <button onClick={() => setShowDelete(false)} style={{ fontSize: 13, padding: '6px 14px' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
