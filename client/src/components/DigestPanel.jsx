import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { LoadingState, EmptyState } from './ui/States.jsx';

function runButtonLabel(loading, digest) {
  if (loading) return 'Running...';
  if (digest)  return 'Refresh digest';
  return 'Run digest';
}

export default function DigestPanel({ refreshKey, onGoToSettings, health = {}, connected = false }) {
  const [digest,  setDigest]  = useState(null);
  const [loading, setLoading] = useState(false);

  // Count how many integrations this user has connected
  const connectedCount = [
    connected,                  // Google
    health.notion,
    health.todoist,
    health.github,
    health.slack,
    health.trello,
    health.gemini || health.groq,
  ].filter(Boolean).length;

  useEffect(() => {
    apiFetch('/api/digest/latest')
      .then(r => r.json())
      .then(d => { if (d) setDigest(d); return undefined; })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!refreshKey) return;
    apiFetch('/api/digest/latest')
      .then(r => r.json())
      .then(d => { if (d) setDigest(d); return undefined; })
      .catch(() => {});
  }, [refreshKey]);

  async function runDigest() {
    setLoading(true);
    try {
      const r = await apiFetch('/api/digest/run', { method: 'POST' });
      const d = await r.json();
      if (r.ok) setDigest(d);
      else console.error('[digest] run failed:', d.error);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const card = (children, accent) => (
    <div style={{
      background: 'var(--surface)', border: `0.5px solid var(--border)`,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      borderRadius: accent ? '0 var(--radius) var(--radius) 0' : 'var(--radius)',
      padding: '10px 14px', marginBottom: 8,
    }}>
      {children}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>Today's digest</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <button className="primary" onClick={runDigest} disabled={loading}>
          {runButtonLabel(loading, digest)}
        </button>
      </div>

      {!digest && !loading && connectedCount < 2 && (
        <EmptyState
          icon="+"
          title="Connect more tools to unlock the digest"
          description={<>The digest needs at least 2 integrations — like Google + Notion, or GitHub + Todoist — to give you a useful summary. You have <strong>{connectedCount}</strong> connected right now.</>}
          actionLabel="Add integrations in Settings →"
          onAction={onGoToSettings}
          action={
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
              {[
                { label: 'Google', done: connected },
                { label: 'Notion / Todoist', done: health.notion || health.todoist },
                { label: 'GitHub', done: health.github },
                { label: 'Slack', done: health.slack },
              ].map(t => (
                <div key={t.label} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 20,
                  background: t.done ? 'rgba(29,158,117,0.08)' : 'var(--surface)',
                  border: `1px solid ${t.done ? 'var(--accent)' : 'var(--border)'}`,
                  fontSize: 12, color: t.done ? 'var(--accent)' : 'var(--muted)',
                }}>
                  <span>{t.done ? '✓' : '○'}</span>
                  <span style={{ fontWeight: t.done ? 600 : 400 }}>{t.label}</span>
                </div>
              ))}
            </div>
          }
        />
      )}

      {!digest && !loading && connectedCount >= 2 && (
        <EmptyState
          title="No digest yet for today"
          description={'Click "Run digest" to get a summary of your emails, calendar, tasks, and code activity.'}
        />
      )}

      {loading && <LoadingState label="Running 4 sub-agents in parallel…" />}

      {digest && (
        <div>
          {/* Stats */}
          <div className="grid-stat-4" style={{ marginBottom: 16 }}>
            {[
              { label: 'Emails pending',  val: digest.comms?.pending?.length ?? 0,    color: 'var(--success)' },
              { label: 'Conflicts',       val: digest.calendar?.conflicts?.length ?? 0, color: 'var(--warning)' },
              { label: 'Blockers',        val: digest.tasks?.blockers?.length ?? 0,    color: 'var(--danger)' },
              { label: 'Content drafts',  val: digest.content?.drafts?.length ?? 0,   color: 'var(--info)' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 500, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Comms */}
          {digest.comms?.pending?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Comms</div>
              {digest.comms.pending.slice(0, 3).map((e, i) => card(
                <>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{e.from}</div>
                  <div style={{ fontWeight: 500 }}>{e.subject}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{e.intent}</div>
                </>,
                'var(--border)'
              ))}
            </div>
          )}

          {/* Calendar */}
          {digest.calendar?.conflicts?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Calendar conflicts</div>
              {digest.calendar.conflicts.map((c, i) => card(
                <>
                  <div style={{ fontWeight: 500 }}>{c.eventA?.title} ↔ {c.eventB?.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {c.type === 'overlap' ? `${Math.round(c.overlapMin)}min overlap` : `${Math.round(c.gapMin)}min gap`}
                  </div>
                </>,
                'var(--danger)'
              ))}
            </div>
          )}

          {/* Blockers */}
          {digest.tasks?.blockers?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Blockers</div>
              {digest.tasks.blockers.map((b, i) => card(
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <span className="tag tag-danger">Blocked</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{b.source}</span>
                  </div>
                  <div style={{ fontWeight: 500 }}>{b.title}</div>
                </>,
                'var(--danger)'
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--hint)', textAlign: 'right' }}>
            Generated {new Date(digest.generatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
