import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import { LoadingState, EmptyState } from './ui/States.jsx';

function runButtonLabel(loading, digest) {
  if (loading) return 'Running…';
  if (digest)  return 'Refresh digest';
  return 'Run digest';
}

function greeting(date) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const KIND_STYLE = {
  mail: { bg: 'var(--tag-info-bg)',    fg: 'var(--tag-info-fg)' },
  cal:  { bg: 'var(--tag-danger-bg)',  fg: 'var(--tag-danger-fg)' },
  task: { bg: 'var(--tag-warn-bg)',    fg: 'var(--tag-warn-fg)' },
  code: { bg: 'var(--tag-code-bg)',    fg: 'var(--tag-code-fg)' },
};

function Pill({ kind, children }) {
  const k = KIND_STYLE[kind];
  return (
    <span style={{
      flex: 'none', width: 64, textAlign: 'center', padding: '4px 0', borderRadius: 6,
      background: k.bg, color: k.fg, fontFamily: 'var(--font-mono)', fontSize: 11,
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

function Row({ kind, label, title, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: '1px solid var(--border)' }}>
      <Pill kind={kind}>{label}</Pill>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.3 }}>{title}</span>
        {meta && <span style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.4 }}>{meta}</span>}
      </div>
    </div>
  );
}

const panelCard = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px' };

export default function DigestPanel({ refreshKey, onGoToSettings, onOpenPalette, userName = '', health = {}, connected = false }) {
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

  const now = new Date();
  const pendingMail = digest?.comms?.pending ?? [];
  const conflicts   = digest?.calendar?.conflicts ?? [];
  const blockers    = digest?.tasks?.blockers ?? [];
  const drafts      = digest?.content?.drafts ?? [];
  const needCount   = pendingMail.length + conflicts.length + blockers.length;
  const name        = userName ? userName.charAt(0).toUpperCase() + userName.slice(1) : '';

  let summary = 'Run your digest to see what needs you today.';
  if (digest) summary = needCount === 0 ? 'Nothing needs you right now.' : `${needCount} ${needCount === 1 ? 'thing needs' : 'things need'} you today.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1080 }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="t-eyebrow">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }).replace(',', ' ·')}</div>
          <h1 style={{ fontSize: 'clamp(26px, 4vw, 36px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>
            {greeting(now)}{name ? `, ${name}` : ''}.
          </h1>
          <p style={{ fontSize: 16, color: 'var(--text-2)' }}>{summary}</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {onOpenPalette && (
            <button
              type="button"
              onClick={onOpenPalette}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, minWidth: 260, padding: '0 14px',
                border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)',
                color: 'var(--muted)', fontSize: 14.5, textAlign: 'left',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
              <span style={{ flex: 1 }}>Search or run an action…</span>
              <span className="cmdk-kbd">⌘K</span>
            </button>
          )}
          <button className="primary" onClick={runDigest} disabled={loading} style={{ minHeight: 48, padding: '0 20px', borderRadius: 12, fontSize: 14.5 }}>
            {runButtonLabel(loading, digest)}
          </button>
        </div>
      </header>

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
                  padding: '8px 14px', borderRadius: 999,
                  background: t.done ? 'var(--accent-ring)' : 'var(--surface)',
                  border: `1px solid ${t.done ? 'var(--accent)' : 'var(--border-strong)'}`,
                  fontSize: 13.5, color: t.done ? 'var(--accent)' : 'var(--muted)',
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
        <>
          <section aria-label="Summary" className="grid-stat-4" style={{ gap: 16 }}>
            {[
              { label: 'Emails pending', val: pendingMail.length },
              { label: 'Conflicts',      val: conflicts.length },
              { label: 'Blockers',       val: blockers.length },
              { label: 'Content drafts', val: drafts.length },
            ].map(st => (
              <div key={st.label} style={{ ...panelCard, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span className="t-eyebrow">{st.label}</span>
                <span className="t-stat" style={{ color: st.val > 0 ? 'var(--text)' : 'var(--hint)' }}>{st.val}</span>
              </div>
            ))}
          </section>

          {needCount > 0 && (
            <section aria-label="Needs you" style={panelCard}>
              <h2 className="t-h2" style={{ marginBottom: 8 }}>Needs you</h2>
              {pendingMail.slice(0, 5).map((e, i) => (
                <Row key={`m${i}`} kind="mail" label="mail" title={e.subject} meta={[e.from, e.intent].filter(Boolean).join(' · ')} />
              ))}
              {conflicts.map((c, i) => (
                <Row
                  key={`c${i}`} kind="cal" label="clash"
                  title={`${c.eventA?.title} ↔ ${c.eventB?.title}`}
                  meta={c.type === 'overlap' ? `${Math.round(c.overlapMin)} min overlap` : `${Math.round(c.gapMin)} min gap`}
                />
              ))}
              {blockers.map((b, i) => (
                <Row key={`b${i}`} kind="task" label="blocked" title={b.title} meta={b.source} />
              ))}
            </section>
          )}

          <div style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'right' }}>
            Generated {new Date(digest.generatedAt).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}
