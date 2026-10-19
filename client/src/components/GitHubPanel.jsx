import { useState, useEffect } from 'react';
import { useCache } from '../hooks/useCache.js';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import NotConnected from './NotConnected.jsx';
import { LoadingState } from './ui/States.jsx';

export default function GitHubPanel({ health = {}, refreshKey, onGoToSettings, userId }) {
  const [repos,         setRepos]         = useState([]);
  const [activeRepo,    setActiveRepo]    = useState('');
  const [prs,           setPrs]            = useState([]);
  const [merged,        setMerged]        = useState([]);
  const [issues,        setIssues]        = useState([]);
  const [contributions, setContributions] = useState(null);
  const [branches,      setBranches]      = useState([]);
  const [changelog,     setChangelog]     = useState('');
  const [loading,       setLoading]       = useState(false);
  const [contribLoad,   setContribLoad]   = useState(false);
  const [branchLoad,    setBranchLoad]    = useState(false);
  const [clLoading,     setClLoading]     = useState(false);
  const [newTitle,      setNewTitle]      = useState('');
  const [newBody,       setNewBody]       = useState('');
  const [creating,      setCreating]      = useState(false);
  const [showForm,      setShowForm]      = useState(false);
  const [issueError,    setIssueError]    = useState('');
  const [drafting,      setDrafting]      = useState(false);
  const [tab,           setTab]           = useState('overview'); // overview | contributions | branches

  const connected = Boolean(health.github);
  const cache     = useCache('devos_github', 10 * 60 * 1000);
  // Scoped per user so one account never reads another's cached repo data.
  const repoKey   = repo => `devos_github_${userId ?? 'anon'}_${(repo ?? '').replace('/', '_')}`;

  useEffect(() => {
    if (!connected) return;
    apiFetch('/api/github/repos')
      .then(r => r.json())
      .then(list => {
        if (Array.isArray(list) && list.length) {
          setRepos(list);
          setActiveRepo(list[0]);
        }
        return undefined;
      })
      .catch(() => {});
  }, [connected]);

  useEffect(() => {
    if (!activeRepo) return;
    const cacheKey = repoKey(activeRepo);
    const cached = cache.get(cacheKey);
    if (cached) { setPrs(cached.prs); setMerged(cached.merged); setIssues(cached.issues ?? []); return; }
    load(activeRepo);
  }, [activeRepo]);

  useEffect(() => {
    if (!refreshKey || !activeRepo) return;
    const cacheKey = repoKey(activeRepo);
    cache.clear(cacheKey);
    load(activeRepo);
  }, [refreshKey]);

  // Load contributions when tab switches to it
  useEffect(() => {
    if (tab === 'contributions' && !contributions && activeRepo) loadContributions();
  }, [tab, activeRepo]);

  // Load branches when tab switches to it
  useEffect(() => {
    if (tab === 'branches' && !branches.length && activeRepo) loadBranches();
  }, [tab, activeRepo]);

  async function load(repo) {
    setLoading(true);
    const q = repo ? `?repo=${encodeURIComponent(repo)}` : '';
    try {
      const [pData, mData, iData] = await Promise.all([
        apiFetch(`/api/prs${q}`).then(r => r.json()).catch(() => []),
        apiFetch(`/api/github/merged${q}`).then(r => r.json()).catch(() => []),
        apiFetch(`/api/github/issues${q}`).then(r => r.json()).catch(() => []),
      ]);
      const prs    = Array.isArray(pData) ? pData : [];
      const merged = Array.isArray(mData) ? mData : [];
      const issues = Array.isArray(iData) ? iData : [];
      const cacheKey = repoKey(repo);
      cache.set({ prs, merged, issues }, cacheKey);
      setPrs(prs); setMerged(merged); setIssues(issues);
      setChangelog('');
    } finally { setLoading(false); }
  }

  async function loadContributions() {
    setContribLoad(true);
    try {
      const q = activeRepo ? `?repo=${encodeURIComponent(activeRepo)}` : '';
      const data = await apiFetch(`/api/github/contributions${q}`).then(r => r.json());
      setContributions(data && !data.error ? data : null);
    } catch { setContributions(null); }
    finally { setContribLoad(false); }
  }

  async function loadBranches() {
    setBranchLoad(true);
    try {
      const q = activeRepo ? `?repo=${encodeURIComponent(activeRepo)}` : '';
      const data = await apiFetch(`/api/github/branches${q}`).then(r => r.json());
      setBranches(Array.isArray(data) ? data : []);
    } catch { setBranches([]); }
    finally { setBranchLoad(false); }
  }

  async function submitIssue() {
    if (!newTitle.trim()) return;
    setCreating(true); setIssueError('');
    try {
      const r = await apiFetch('/api/github/issues', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), body: newBody.trim(), repo: activeRepo }),
      });
      const data = await r.json();
      if (data.id) {
        setIssues(prev => [data, ...prev]);
        setNewTitle(''); setNewBody(''); setShowForm(false); setIssueError('');
        cache.clear(repoKey(activeRepo));
      } else {
        setIssueError(data.error ?? 'Failed to create issue.');
      }
    } catch { setIssueError('Network error — could not create issue.'); }
    finally { setCreating(false); }
  }

  async function draftBody() {
    if (!newTitle.trim()) return;
    setDrafting(true); setIssueError('');
    try {
      const r = await apiFetch('/api/github/draft-body', {
        method: 'POST',
        body: JSON.stringify({ title: newTitle.trim(), context: newBody.trim() }),
      });
      const data = await r.json();
      if (data.body) setNewBody(data.body);
    } catch { setIssueError('Failed to generate body.'); }
    finally { setDrafting(false); }
  }

  async function generateChangelog() {
    setClLoading(true);
    try {
      const q = activeRepo ? `?repo=${encodeURIComponent(activeRepo)}` : '';
      const data = await apiFetch(`/api/github/changelog${q}`).then(r => r.json());
      setChangelog(data.changelog ?? data.error ?? '');
    } finally { setClLoading(false); }
  }

  const stalePRs = prs.filter(p => p.daysStale >= 3);
  const freshPRs = prs.filter(p => p.daysStale < 3);

  function activityColor(count, pct) {
    if (count === 0)  return 'var(--border)';
    if (pct < 0.33)   return 'color-mix(in srgb, var(--accent) 35%, var(--bg))';
    if (pct < 0.66)   return 'color-mix(in srgb, var(--accent) 65%, var(--bg))';
    return 'var(--accent)';
  }

  function branchAccentColor(b) {
    if (b.isDefault) return 'var(--accent)';
    if (b.stale)      return 'var(--warning)';
    return 'var(--border)';
  }

  if (!connected) return (
    <div>
      <PageHeader eyebrow="Work" title="GitHub" subtitle="Pull requests, issues and branches." />
      <NotConnected
        title="GitHub not connected"
        description="Add your GitHub token in Settings to view open PRs, track stale issues, and generate changelogs."
        primaryLabel="Go to Settings"
        onPrimary={onGoToSettings}
      />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <PageHeader
        eyebrow="Work"
        title="GitHub"
        subtitle={
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            {repos.length > 1 ? (
              <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
                {repos.map(r => {
                  const active = activeRepo === r;
                  return (
                    <button key={r} type="button" aria-pressed={active} title={r} onClick={() => { setActiveRepo(r); setContributions(null); setBranches([]); }} style={{
                      fontFamily: 'var(--font-mono)', fontSize: 13, padding: '3px 9px', minHeight: 30, borderRadius: 6,
                      background: active ? 'var(--text)' : 'var(--surface)', color: active ? '#fff' : 'var(--text)',
                      border: `1px solid ${active ? 'var(--text)' : 'var(--border)'}`, maxWidth: 200,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{r.split('/')[1]}</button>
                  );
                })}
              </span>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, padding: '3px 9px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)' }}>{activeRepo || 'no repository'}</span>
            )}
            <span>pull requests, issues and branches</span>
          </span>
        }
      >
        <div role="group" aria-label="View" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[['overview', 'Overview'], ['contributions', 'Contributions'], ['branches', 'Branches']].map(([id, label]) => {
            const on = tab === id;
            return (
              <button key={id} type="button" aria-pressed={on} onClick={() => setTab(id)} style={{ minHeight: 40, padding: '0 16px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 999, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-2)', fontSize: 14, fontWeight: 500 }}>{label}</button>
            );
          })}
          <button onClick={() => { load(activeRepo); setContributions(null); setBranches([]); }} disabled={loading} style={{ minHeight: 40, padding: '0 16px', fontSize: 14, fontWeight: 500, border: '1px solid var(--border-strong)', borderRadius: 999, background: 'var(--surface)' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </PageHeader>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (() => {
        const rows = [
          ...stalePRs.map(pr => ({ key: `s${pr.id}`, pill: 'stale', tone: 'danger', title: pr.title, meta: `#${pr.id} · by ${pr.author} · ${pr.daysStale}d without activity`, url: pr.url, action: 'Review' })),
          ...freshPRs.map(pr => ({ key: `p${pr.id}`, pill: 'PR', tone: 'code', title: pr.title, meta: `#${pr.id} · by ${pr.author}${pr.branch ? ` · ${pr.branch}` : ''}`, url: pr.url, action: 'Review' })),
          ...issues.map(i => ({ key: `i${i.repo ?? ''}${i.id}`, pill: 'issue', tone: 'info', title: i.title, meta: [`#${i.id}`, ...(i.labels ?? [])].join(' · '), url: i.url, action: 'Open' })),
          ...merged.map(pr => ({ key: `m${pr.id}`, pill: 'merged', tone: 'success', title: pr.title, meta: `#${pr.id}`, url: pr.url, action: 'Open' })),
        ];
        const toneStyle = { danger: ['var(--tag-danger-bg)', 'var(--tag-danger-fg)'], code: ['var(--tag-code-bg)', 'var(--tag-code-fg)'], info: ['var(--tag-info-bg)', 'var(--tag-info-fg)'], success: ['var(--tag-success-bg)', 'var(--tag-success-fg)'] };
        const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

            <section aria-label="Activity" style={{ ...card, flex: '999 1 460px', minWidth: 0, padding: '10px 24px', display: 'flex', flexDirection: 'column' }}>
              {rows.length === 0 && !loading && (
                <p style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 15 }}>No open pull requests, issues or merges this week.</p>
              )}
              {rows.map((r, i) => (
                <div key={r.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 16px', padding: '16px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                  <span style={{ flex: 'none', minWidth: 64, textAlign: 'center', padding: '4px 8px', borderRadius: 6, background: toneStyle[r.tone][0], color: toneStyle[r.tone][1], fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{r.pill}</span>
                  <div style={{ flex: '1 1 280px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{r.title}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{r.meta}</span>
                  </div>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" aria-label={`${r.action}: ${r.title}`} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 16px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>{r.action} ↗</a>
                  )}
                </div>
              ))}
            </section>

            <aside aria-label="Repository" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <section style={{ background: 'var(--sidebar-bg)', color: 'var(--bg)', borderRadius: 16, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-soft)' }}>
                  {stalePRs.length > 0 ? 'Needs attention' : 'This week'}
                </span>
                <span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.25 }}>
                  {prs.length} open {prs.length === 1 ? 'PR' : 'PRs'}, {stalePRs.length} stale
                </span>
                <span style={{ fontSize: 14, color: '#B9B8B1', lineHeight: 1.5 }}>
                  {merged.length} merged in the last 7 days and {issues.length} open {issues.length === 1 ? 'issue' : 'issues'}.
                </span>
                <button type="button" onClick={generateChangelog} disabled={clLoading} style={{ marginTop: 6, minHeight: 44, borderRadius: 10, background: 'var(--accent-soft)', color: '#0E1A15', fontSize: 14.5, fontWeight: 600 }}>
                  {clLoading ? 'Generating…' : 'Generate changelog'}
                </button>
              </section>

              {changelog && (
                <section style={{ ...card, padding: '20px 22px' }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Changelog</h2>
                  <pre style={{ fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{changelog}</pre>
                </section>
              )}

              <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>New issue</h2>
                  <button onClick={() => { setShowForm(f => !f); setIssueError(''); }} style={{ minHeight: 40, padding: '0 14px', fontSize: 13.5, fontWeight: 600, border: '1px solid var(--border-strong)' }}>
                    {showForm ? 'Cancel' : '+ New issue'}
                  </button>
                </div>
                {!showForm && <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>Describe the problem and Dayhand can draft the body for you.</p>}
                {showForm && (
                  <>
                    <input placeholder="Issue title" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, color: 'var(--muted)' }}>Description</span>
                      <button onClick={draftBody} disabled={drafting || !newTitle.trim()} style={{ fontSize: 13, minHeight: 36, padding: '0 12px', color: 'var(--accent)', border: '1px solid var(--accent)', background: 'transparent' }}>
                        {drafting ? 'Drafting…' : '✦ AI Draft'}
                      </button>
                    </div>
                    <textarea placeholder="Description (optional)" value={newBody} onChange={e => setNewBody(e.target.value)} rows={newBody ? 8 : 3} style={{ width: '100%', resize: 'vertical' }} />
                    {issueError && <p style={{ fontSize: 13.5, color: 'var(--danger)' }}>{issueError}</p>}
                    <button className="primary" onClick={submitIssue} disabled={creating || !newTitle.trim()} style={{ minHeight: 44 }}>
                      {creating ? 'Creating…' : 'Create issue'}
                    </button>
                  </>
                )}
              </section>
            </aside>
          </div>
        );
      })()}

      {/* ── Contributions tab ── */}
      {tab === 'contributions' && (
        <div>
          {contribLoad && <LoadingState label="Loading contributions…" />}

          {!contribLoad && contributions && (
            <>
              {/* Stats row */}
              <div className="grid-stat-3" style={{ marginBottom: 20 }}>
                {[
                  { label: 'Commits (30d)',    value: contributions.totalCommits,  color: 'var(--accent)' },
                  { label: 'PRs opened',        value: contributions.prsOpened,     color: 'var(--success)' },
                  { label: 'Reviews done',      value: contributions.reviewsDone,   color: 'var(--info)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '14px 16px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 500, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Streak */}
              {contributions.streak > 0 && (
                <div style={{ background: 'var(--tag-success-bg)', border: 'var(--border-hairline)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 20 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--tag-success-fg)' }}>{contributions.streak}-day streak</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Keep it up — you've committed every day for {contributions.streak} days</div>
                </div>
              )}

              {/* 30-day activity heatmap */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                  Activity — last 30 days
                </div>
                <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                  {contributions.dailyActivity.map((d, i) => {
                    const max   = Math.max(...contributions.dailyActivity.map(x => x.count), 1);
                    const pct   = d.count / max;
                    const h     = Math.max(4, Math.round(pct * 40));
                    const bg    = activityColor(d.count, pct);
                    const label = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return (
                      <div key={d.date} title={`${label}: ${d.count} commit${d.count !== 1 ? 's' : ''}`}
                        style={{ flex: 1, height: h, background: bg, borderRadius: 3, minWidth: 4, cursor: 'default', transition: 'height 0.2s' }} />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--hint)' }}>30 days ago</span>
                  <span style={{ fontSize: 11.5, color: 'var(--hint)' }}>Today</span>
                </div>
              </div>

              {contributions.totalCommits === 0 && (
                <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
                  No commits in the last 30 days for {contributions.author}
                </p>
              )}
            </>
          )}

          {!contribLoad && !contributions && (
            <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
              Could not load contributions. Make sure your GitHub token has the right permissions.
            </p>
          )}
        </div>
      )}

      {/* ── Branches tab ── */}
      {tab === 'branches' && (
        <div>
          {branchLoad && <LoadingState label="Loading branches… (fetching commit dates)" />}

          {!branchLoad && branches.length > 0 && (
            <>
              {/* Summary */}
              <div className="grid-stat-3" style={{ marginBottom: 18 }}>
                {[
                  { label: 'Total',    value: branches.length,                            color: 'var(--text)' },
                  { label: 'Active',   value: branches.filter(b => !b.stale).length,      color: 'var(--success)' },
                  { label: 'Stale',    value: branches.filter(b => b.stale).length,       color: branches.some(b => b.stale) ? 'var(--warning)' : 'var(--muted)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 500, color: s.color, lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Stale warning */}
              {branches.filter(b => b.stale).length > 0 && (
                <div style={{ background: 'var(--tag-warn-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--tag-warn-fg)' }}>
                  <strong>{branches.filter(b => b.stale).length} stale branch{branches.filter(b => b.stale).length > 1 ? 'es' : ''}</strong> — no commits in 14+ days. Consider merging or deleting them.
                </div>
              )}

              {/* Branch list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {branches.map(b => (
                  <div key={b.name} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--surface)',
                    border: `1px solid ${b.stale ? 'var(--warning)' : 'var(--border)'}`,
                    borderLeft: `3px solid ${branchAccentColor(b)}`,
                    borderRadius: '0 var(--radius) var(--radius) 0',
                    padding: '9px 12px',
                  }}>
                    <code style={{ flex: 1, fontSize: 13, color: 'var(--text)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.name}
                    </code>

                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                      {b.isDefault && (
                        <span style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 4, background: 'var(--tag-info-bg)', color: 'var(--tag-info-fg)', fontWeight: 500 }}>default</span>
                      )}
                      {b.protected && (
                        <span style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 4, background: 'var(--tag-gray-bg)', color: 'var(--tag-gray-fg)', fontWeight: 500 }}>protected</span>
                      )}
                      {b.stale && (
                        <span style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 4, background: 'var(--tag-warn-bg)', color: 'var(--tag-warn-fg)', fontWeight: 500 }}>
                          {b.daysOld}d stale
                        </span>
                      )}
                      {!b.stale && !b.isDefault && b.daysOld !== null && (
                        <span style={{ fontSize: 11.5, color: 'var(--hint)' }}>
                          {b.daysOld === 0 ? 'today' : `${b.daysOld}d ago`}
                        </span>
                      )}
                      <code style={{ fontSize: 11.5, color: 'var(--hint)', fontFamily: 'monospace' }}>{b.sha}</code>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {!branchLoad && branches.length === 0 && (
            <p style={{ fontSize: 14, color: 'var(--muted)', textAlign: 'center', padding: '40px 0' }}>
              No branches found.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
