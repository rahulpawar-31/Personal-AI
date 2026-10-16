import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../api.js';
import { toast } from '../../toast.jsx';
import { encryptionSummary } from '../../encryptionStatus.js';

// Shown only while a secret rotation is under way or something needs attention.
// Counts only: the server never sends a stored value.
export default function EncryptionCard() {
  const [status, setStatus]   = useState(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/admin/encryption');
      if (r.ok) setStatus(await r.json());
    } catch { /* the card simply stays hidden */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function reencrypt() {
    setRunning(true);
    try {
      const r = await apiFetch('/api/admin/encryption/reencrypt', { method: 'POST' });
      const body = await r.json();
      if (!r.ok) { toast(body.error || 'Could not re-encrypt', 'error'); return; }
      setStatus(body.status);
      const skipped = body.skippedChanged ? `, ${body.skippedChanged} changed meanwhile (press again)` : '';
      toast(`Moved ${body.reencrypted} value${body.reencrypted === 1 ? '' : 's'}${skipped}`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  }

  const summary = encryptionSummary(status);
  if (!summary) return null;

  return (
    <section aria-label="Encryption" style={{
      background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '12px 14px', marginBottom: 20,
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Encryption</div>
      <div style={{ fontSize: 13 }}>{summary.headline}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{summary.hint}</div>
      {summary.canReencrypt && (
        <button className="primary" onClick={reencrypt} disabled={running} style={{ fontSize: 12, padding: '5px 14px', marginTop: 10 }}>
          {running ? 'Re-encrypting…' : 'Re-encrypt'}
        </button>
      )}
    </section>
  );
}
