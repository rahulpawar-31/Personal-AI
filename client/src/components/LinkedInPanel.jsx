import { useState, useEffect, useRef } from 'react';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';

const LINKEDIN_MAX = 3000;

const TEMPLATES = [
  { label: 'Achievement',       hint: 'Shipped X that does Y, proud of Z…' },
  { label: 'Lesson learned',    hint: 'Biggest mistake I made this year was…' },
  { label: 'Behind the scenes', hint: 'Here\'s how we actually built X…' },
  { label: 'Hot take',          hint: 'Unpopular opinion: most devs are wrong about…' },
];

function CharBar({ text }) {
  const len = text.length;
  const pct = Math.min(len / LINKEDIN_MAX, 1);
  const over = len > LINKEDIN_MAX;
  const warn = len > LINKEDIN_MAX * 0.9;
  let color = 'var(--accent)';
  if (over)      color = 'var(--danger)';
  else if (warn) color = 'var(--warning)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: color, borderRadius: 2, transition: 'width .15s, background .15s' }} />
      </div>
      <span style={{ fontSize: 12.5, color: over ? 'var(--danger)' : 'var(--muted)', minWidth: 60, textAlign: 'right' }}>
        {len} / {LINKEDIN_MAX}
      </span>
    </div>
  );
}

function PostCard({ post, onCopy }) {
  const date = new Date(post.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div style={{
      borderTop: '1px solid var(--border)', padding: '12px 0 4px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.55, flex: 1, margin: 0,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.edited}
        </p>
        <button
          onClick={() => onCopy(post.edited)}
          style={{ fontSize: 13, minHeight: 36, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Copy
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{date}</div>
    </div>
  );
}

export default function LinkedInPanel({ health = {} }) {
  const [source,    setSource]    = useState('');
  const [draft,     setDraft]     = useState(null);
  const [selected,  setSelected]  = useState(0);
  const [editedBody, setEditedBody] = useState('');
  const [hashtags,  setHashtags]  = useState([]);
  const [activeHashtags, setActiveHashtags] = useState(new Set());
  const [loading,   setLoading]   = useState('');
  const [status,    setStatus]    = useState('');
  const [history,   setHistory]   = useState([]);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const textareaRef = useRef(null);

  const connected = Boolean(health.linkedin);

  useEffect(() => {
    apiFetch('/api/content/linkedin/history')
      .then(r => r.json())
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [status]);

  function applyTemplate(t) {
    setSource(t.hint);
    textareaRef.current?.focus();
  }

  async function generate() {
    if (!source.trim()) return;
    setLoading('gen'); setStatus(''); setDraft(null);
    try {
      const r = await apiFetch('/api/content/linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setDraft(data);
      const idx = data.recommendedVariant ?? 0;
      setSelected(idx);
      setEditedBody(data.variants[idx].body);
      setHashtags(data.hashtags ?? []);
      setActiveHashtags(new Set(data.hashtags?.slice(0, 3) ?? []));
    } catch (e) {
      setStatus(e.message || 'Failed to generate — check AI keys in Settings.');
    } finally {
      setLoading('');
    }
  }

  function selectVariant(i) {
    setSelected(i);
    setEditedBody(draft.variants[i].body);
  }

  function toggleHashtag(tag) {
    setActiveHashtags(prev => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });
  }

  function finalPost() {
    const tags   = [...activeHashtags].join(' ');
    const suffix = tags ? `\n\n${tags}` : '';
    return `${editedBody}${suffix}`;
  }

  async function approve(postNow = false) {
    const body = finalPost();
    setLoading(postNow ? 'posting' : 'saving');
    try {
      const r = await apiFetch('/api/content/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ original: draft.variants[0].body, edited: body, type: 'linkedin', postNow }),
      });
      const data = await r.json();
      setStatus(postNow && data.posted ? '✓ Posted to LinkedIn' : '✓ Saved to voice profile');
      setDraft(null); setSource(''); setEditedBody(''); setHashtags([]); setActiveHashtags(new Set());
    } catch {
      setStatus('Action failed.');
    } finally {
      setLoading('');
    }
  }

  async function copyText(text, idx = null) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx ?? 'final');
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) —
      // safe to ignore, the "Copied" feedback just won't show.
    }
  }

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };
  const ghost = { minHeight: 44, padding: '0 18px', border: '1px solid var(--border-strong)', background: 'var(--surface)', fontSize: 14.5, fontWeight: 500 };

  return (
    <div>
      <PageHeader
        eyebrow="Social"
        title="LinkedIn"
        subtitle="Draft posts with Dayhand, pick a version, then publish. Nothing is posted without your approval."
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

        <section aria-label="Draft" style={{ ...card, flex: '999 1 460px', minWidth: 0, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="li-topic" style={{ fontSize: 14, fontWeight: 600 }}>What should the post be about?</label>
            <textarea
              id="li-topic"
              ref={textareaRef}
              rows={3}
              placeholder="e.g. We just shipped dark mode after 3 months. The hardest part wasn't the CSS…"
              value={source}
              onChange={e => setSource(e.target.value)}
              style={{ borderRadius: 12, fontSize: 15, lineHeight: 1.5, padding: '12px 14px' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button className="primary" onClick={generate} disabled={loading === 'gen' || !source.trim()} style={{ minHeight: 44, padding: '0 20px', fontSize: 14.5 }}>
                {loading === 'gen' ? 'Drafting…' : 'Draft 3 versions'}
              </button>
              {TEMPLATES.map(t => (
                <button key={t.label} onClick={() => applyTemplate(t)} style={{ minHeight: 40, padding: '0 14px', borderRadius: 999, border: '1px solid var(--border-strong)', background: 'var(--surface)', fontSize: 13.5, fontWeight: 500 }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {draft && (
            <>
              <div role="group" aria-label="Versions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {draft.variants?.map((v, i) => {
                  const on = i === selected;
                  return (
                    <button key={v.label ?? i} type="button" aria-pressed={on} onClick={() => selectVariant(i)} style={{ minHeight: 40, padding: '0 16px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 999, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-2)', fontSize: 14, fontWeight: 500 }}>
                      {v.label}{i === (draft.recommendedVariant ?? 0) ? ' ★' : ''} · ~{v.wordCount}w
                    </button>
                  );
                })}
              </div>

              <label htmlFor="li-body" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Post text</label>
              <textarea
                id="li-body"
                rows={9}
                value={editedBody}
                onChange={e => setEditedBody(e.target.value)}
                style={{ background: 'var(--bg)', border: 0, borderRadius: 14, padding: '20px 22px', fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.65 }}
              />
              <CharBar text={finalPost()} />

              {hashtags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {hashtags.map(tag => {
                    const on = activeHashtags.has(tag);
                    return (
                      <button key={tag} type="button" aria-pressed={on} onClick={() => toggleHashtag(tag)} style={{ fontSize: 13.5, minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`, background: on ? 'var(--accent-ring)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--muted)', fontWeight: 500 }}>
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <button onClick={() => { setDraft(null); setStatus(''); }} style={{ ...ghost, border: 0, color: 'var(--muted)' }}>Dismiss</button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button onClick={() => copyText(finalPost(), 'final')} style={ghost}>{copiedIdx === 'final' ? '✓ Copied' : 'Copy'}</button>
                  <button onClick={() => approve(false)} disabled={Boolean(loading)} style={ghost}>{loading === 'saving' ? 'Saving…' : 'Save to voice profile'}</button>
                  {connected && (
                    <button onClick={() => approve(true)} disabled={Boolean(loading) || finalPost().length > LINKEDIN_MAX} style={{ minHeight: 44, padding: '0 20px', background: 'var(--text)', color: '#fff', fontSize: 14.5, fontWeight: 600 }}>
                      {loading === 'posting' ? 'Posting…' : 'Post to LinkedIn'}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {status && (
            <p role="status" style={{ fontSize: 14.5, color: status.startsWith('✓') ? 'var(--accent)' : 'var(--danger)', fontWeight: 500 }}>
              {status}
            </p>
          )}
        </section>

        <aside aria-label="Queue" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section style={{ ...card, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Saved posts ({history.length})</h2>
            {history.length === 0 && (
              <div style={{ padding: '14px 0 2px', borderTop: '1px solid var(--border)', color: 'var(--muted)', fontSize: 14.5, lineHeight: 1.5 }}>
                Nothing saved yet. Pick a version and save it.
              </div>
            )}
            {history.map((p, i) => (
              <PostCard key={p.at ?? i} post={p} onCopy={text => copyText(text, i)} />
            ))}
            {copiedIdx !== null && copiedIdx !== 'final' && <p style={{ fontSize: 13, color: 'var(--accent)' }}>Copied</p>}
          </section>

          <section style={{ ...card, padding: '20px 22px' }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Your voice profile</h2>
            <VoiceProfile />
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
              Every post you save teaches Dayhand your writing style.
            </div>
          </section>

          {!connected && (
            <section style={{ background: 'var(--tag-warn-bg)', borderRadius: 16, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--tag-warn-fg)' }}>Needs a webhook to publish</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--tag-warn-fg)' }}>
                Add your <code>LINKEDIN_WEBHOOK_URL</code> (Make.com) in Settings to post from here. Drafting works without it.
              </span>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function VoiceProfile() {
  const [profile, setProfile] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch('/api/memory')
      .then(r => r.json())
      .then(d => setProfile(d.voiceProfile))
      .catch(() => setFailed(true));
  }, []);

  if (failed && !profile) return <div role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Couldn't load your voice profile.</div>;

  if (!profile) return <div role="status" aria-live="polite" style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</div>;

  const postCount = profile.approvedDrafts?.filter(d => d.type === 'linkedin').length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[
        { label: 'Tone',          val: profile.tone },
        { label: 'Sentences',     val: profile.sentenceLength },
        { label: 'Opening style', val: profile.openingStyle },
        { label: 'Posts saved',   val: String(postCount) },
      ].map(r => (
        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>{r.label}</span>
          <span style={{ color: 'var(--text)', fontWeight: 500, textAlign: 'right', maxWidth: 140, textTransform: 'capitalize' }}>{r.val}</span>
        </div>
      ))}
    </div>
  );
}
