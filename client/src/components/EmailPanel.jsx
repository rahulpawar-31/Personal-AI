import { useState, useEffect, useRef } from 'react';
import { useMediaQuery } from '../useMediaQuery.js';
import { useCache } from '../hooks/useCache.js';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import NotConnected from './NotConnected.jsx';
import { LoadingState } from './ui/States.jsx';
import { toast } from '../toast.jsx';
import { parseFrom } from '../lib/parseFrom.js';

const TTL_30MIN = 30 * 60 * 1000;

// Wrap raw HTML in a clean document so fonts/margins look right inside iframe
function wrapHtml(html) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px; line-height: 1.6; color: #1a1a1a;
    background: #fff; word-break: break-word;
  }
  img { max-width: 100%; height: auto; }
  a { color: #1a73e8; }
  pre, code { font-size: 12px; }
</style>
</head>
<body>${html}</body>
</html>`;
}

function EmailIframe({ html }) {
  const ref = useRef(null);

  function onLoad() {
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.body) {
        ref.current.style.height = `${doc.body.scrollHeight + 32}px`;
      }
    } catch (_) {
      // Cross-origin iframe content throws on access — safe to ignore, the
      // frame just won't auto-size to its content in that case.
    }
  }

  return (
    <iframe
      ref={ref}
      srcDoc={wrapHtml(html)}
      sandbox="allow-same-origin allow-popups"
      onLoad={onLoad}
      title="email"
      style={{ width: '100%', border: 'none', minHeight: 200, display: 'block' }}
    />
  );
}

// ─── Inline reply draft ───────────────────────────────────────────────────────

function ReplyDraft({ email, toAddr, onSent, startOpen = false }) {
  const [text,    setText]    = useState(email.draftReply || '');
  const [open,    setOpen]    = useState(startOpen);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    try {
      const r = await apiFetch('/api/email/approve-draft', {
        method: 'POST',
        body: JSON.stringify({
          to:       toAddr,
          subject:  `Re: ${email.subject}`,
          original: email.draftReply,
          edited:   text,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Send failed');
      }
      toast(`Reply sent to ${toAddr}`, 'success');
      onSent(email.id);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  }

  if (!email.draftReply) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--tag-success-bg)', padding: '14px 24px 16px' }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            fontSize: 14, color: 'var(--accent)', fontWeight: 600,
            background: 'var(--surface)', border: '1px solid var(--accent)',
            borderRadius: 10, padding: '0 16px', minHeight: 44, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          AI draft ready — click to review &amp; send
        </button>
      ) : (
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            Reply to <strong>{toAddr}</strong> · Re: {email.subject}
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            style={{
              width: '100%', fontSize: 15, lineHeight: 1.6,
              border: '1px solid var(--border-strong)', borderRadius: 10,
              padding: '10px 14px', fontFamily: 'inherit', resize: 'vertical',
              background: 'var(--surface)', color: 'var(--text)',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="primary"
              style={{ fontSize: 14, padding: '0 18px', minHeight: 44 }}
            >
              {sending ? 'Sending…' : 'Send reply'}
            </button>
            <button
              onClick={() => setOpen(false)}
              style={{ fontSize: 14, padding: '0 14px', minHeight: 44 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function EmailPanel({ connected, refreshKey, onConnectGoogle, onGoToSettings, userId }) {
  const [emails,     setEmails]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [openId,     setOpenId]     = useState(null);
  const [fullEmails, setFullEmails] = useState({});
  const [fetching,   setFetching]   = useState({});
  const [cacheAge,   setCacheAge]   = useState(null);
  const [authError,  setAuthError]  = useState(false);
  const [filter,     setFilter]     = useState('all');
  const [replying,   setReplying]   = useState(false);
  const stacked = useMediaQuery('(max-width: 900px)');
  // Scoped per user so one account never reads another's cached emails.
  const cache = useCache(`devos_emails_${userId ?? 'anon'}`, TTL_30MIN);

  useEffect(() => {
    if (!connected) return;
    const cached = cache.getWithAge();
    if (cached) {
      setEmails(Array.isArray(cached.value.data) ? cached.value.data : []);
      setCacheAge(cached.at);
      return;
    }
    load();
  }, [connected]);

  useEffect(() => {
    if (!connected || !refreshKey) return;
    cache.clear();
    setFullEmails({});
    load();
  }, [refreshKey]);

  async function load() {
    setLoading(true);
    setCacheAge(null);
    setAuthError(false);
    try {
      const r    = await apiFetch('/api/emails');
      if (r.status === 401) {
        const body = await r.json().catch(() => ({}));
        if (body.error === 'google_auth_required') setAuthError(true);
        return;
      }
      const data = await r.json();
      const list = Array.isArray(data) ? data : [];
      cache.set({ data: list });
      setCacheAge(Date.now());
      setEmails(list);
    } finally { setLoading(false); }
  }

  // Wide screens open the first message so the reading pane is never empty.
  useEffect(() => {
    if (!stacked && !openId && emails.length) openEmail(emails[0].id);
  }, [emails, stacked]);

  async function openEmail(id) {
    setReplying(false);
    setOpenId(id);
    if (fullEmails[id]) return;

    // Triage already fetched format:full — reuse it if htmlBody is present
    const triaged = emails.find(e => e.id === id);
    if (triaged && triaged.htmlBody !== undefined) {
      setFullEmails(f => ({ ...f, [id]: triaged }));
      return;
    }

    // Fallback for stale cache entries that predate htmlBody support
    setFetching(f => ({ ...f, [id]: true }));
    try {
      const r    = await apiFetch(`/api/email/${id}`);
      if (r.ok) {
        const data = await r.json();
        setFullEmails(f => ({ ...f, [id]: data }));
      } else {
        toast('Could not load email body', 'error');
      }
    } finally {
      setFetching(f => ({ ...f, [id]: false }));
    }
  }

  async function archive(id, e) {
    e?.stopPropagation();
    try {
      const r = await apiFetch('/api/email/archive', { method: 'POST', body: JSON.stringify({ id }) });
      if (!r.ok) { toast('Could not archive email', 'error'); return; }
      setEmails(prev => prev.filter(x => x.id !== id));
      if (openId === id) setOpenId(null);
    } catch {
      toast('Could not archive email', 'error');
    }
  }

  function onReplySent(id) {
    // archive after sending so it leaves the triage view
    archive(id);
  }

    const PRIORITY_TAG = { P1: 'tag-danger', P2: 'tag-warn', P3: 'tag-gray' };

  async function addToTasks(email) {
    const r = await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: `Reply: ${email.subject}` }) });
    toast(r.ok ? 'Added to Tasks' : 'Could not add task', r.ok ? 'success' : 'error');
  }

  if (!connected) return (
    <div>
      <PageHeader eyebrow="Inbox & calendar" title="Mail" subtitle="Triaged by priority, with reply drafts." />
      <NotConnected
        title="Gmail not connected"
        description="Connect your Google account to triage emails by priority, draft replies, and stay on top of your inbox."
        primaryLabel="Connect Google"
        onPrimary={onConnectGoogle}
        secondaryLabel="Go to Settings"
        onSecondary={onGoToSettings}
      />
    </div>
  );

  const needReply = emails.filter(e => e.draftReply).length;
  const urgent    = emails.filter(e => e.priority === 'P1').length;
  const FILTERS   = [['all', 'All'], ['urgent', 'Urgent'], ['reply', 'Needs reply']];
  const shown     = emails.filter(e => filter === 'all' || (filter === 'urgent' && e.priority === 'P1') || (filter === 'reply' && e.draftReply));
  const cur       = emails.find(e => e.id === openId);
  const full      = cur ? fullEmails[cur.id] : null;
  const curParsed = cur ? parseFrom(cur.from) : null;
  const showList  = !stacked || !cur;
  const showPane  = !stacked || Boolean(cur);

  const sectionStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 };

  return (
    <div>
      <PageHeader
        eyebrow="Inbox & calendar"
        title="Mail"
        subtitle={loading ? 'Triaging your inbox…' : `${emails.length} ${emails.length === 1 ? 'message' : 'messages'}, ${urgent} urgent, ${needReply} with a reply drafted.`}
      >
        <div role="group" aria-label="Filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FILTERS.map(([id, label]) => {
            const on = filter === id;
            return (
              <button key={id} type="button" aria-pressed={on} onClick={() => setFilter(id)} style={{ minHeight: 40, padding: '0 16px', border: `1px solid ${on ? 'var(--text)' : 'var(--border-strong)'}`, borderRadius: 999, background: on ? 'var(--text)' : 'var(--surface)', color: on ? '#fff' : 'var(--text-2)', fontSize: 14, fontWeight: 500 }}>{label}</button>
            );
          })}
        </div>
        {cacheAge && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>cached {formatAge(cacheAge)}</span>}
      </PageHeader>

      {loading    && <LoadingState label="Triaging inbox…" />}
      {authError  && (
        <div style={{ padding: '16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--danger)', fontSize: 14 }}>Google disconnected</span>
          <button className="primary" style={{ fontSize: 13.5, padding: '0 16px', minHeight: 40 }} onClick={onConnectGoogle}>
            Reconnect
          </button>
        </div>
      )}

      {!loading && emails.length === 0 && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>Inbox clear ✓</p>
      )}

      {emails.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>

          {showList && (
            <section aria-label="Messages" style={{ ...sectionStyle, flex: '1 1 340px', maxWidth: stacked ? 'none' : 440, padding: 8, display: 'flex', flexDirection: 'column', maxHeight: stacked ? 'none' : 'calc(100vh - 230px)', overflowY: 'auto' }}>
              {shown.length === 0 && <p style={{ padding: 20, color: 'var(--muted)', fontSize: 14.5 }}>Nothing matches this filter.</p>}
              {shown.map(email => {
                const { name } = parseFrom(email.from);
                const on = cur?.id === email.id;
                return (
                  <button
                    key={email.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => openEmail(email.id)}
                    style={{ textAlign: 'left', border: 0, borderRadius: 10, padding: 14, minHeight: 44, flexShrink: 0, width: '100%', background: on ? 'var(--surface-sunken)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                      {email.priority && <span className={`tag ${PRIORITY_TAG[email.priority] ?? 'tag-gray'}`} style={{ fontFamily: 'var(--font-mono)' }}>{email.priority}</span>}
                      <span style={{ flex: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)' }}>
                        {new Date(email.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{email.subject}</span>
                    {email.snippet && (
                      <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{email.snippet}</span>
                    )}
                  </button>
                );
              })}
            </section>
          )}

          {showPane && cur && (
            <section aria-label="Message" style={{ ...sectionStyle, flex: '999 1 420px', minWidth: 0, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {stacked && (
                <button type="button" onClick={() => setOpenId(null)} style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 14px', border: '1px solid var(--border-strong)', fontSize: 14, fontWeight: 500 }}>
                  ‹ Back to inbox
                </button>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <h2 style={{ fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{cur.subject}</h2>
                  <span style={{ fontSize: 14, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                    {curParsed.name}{curParsed.email ? ` <${curParsed.email}>` : ''} · {new Date(cur.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {cur.priority && <span className={`tag ${PRIORITY_TAG[cur.priority] ?? 'tag-gray'}`} style={{ fontFamily: 'var(--font-mono)', textTransform: 'uppercase', padding: '4px 10px' }}>{cur.priority}</span>}
              </div>

              {cur.intent && (
                <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>Dayhand summary</span>
                  <span style={{ fontSize: 14.5, lineHeight: 1.5 }}>{cur.intent}</span>
                </div>
              )}

              <div>
                {fetching[cur.id] && <LoadingState label="Loading…" />}
                {!fetching[cur.id] && full?.htmlBody && <EmailIframe html={full.htmlBody} />}
                {!fetching[cur.id] && !full?.htmlBody && (
                  <pre style={{ margin: 0, fontSize: 15.5, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', maxWidth: 680 }}>
                    {full?.body || cur.snippet}
                  </pre>
                )}
              </div>

              {replying && cur.draftReply && (
                <ReplyDraft email={cur} toAddr={curParsed.email || cur.from} onSent={onReplySent} startOpen />
              )}

              <div style={{ marginTop: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {cur.draftReply && !replying && (
                  <button type="button" onClick={() => setReplying(true)} className="primary" style={{ minHeight: 44, padding: '0 20px', fontSize: 14.5 }}>Draft a reply</button>
                )}
                <button type="button" onClick={() => addToTasks(cur)} style={{ minHeight: 44, padding: '0 18px', border: '1px solid var(--border-strong)', background: 'var(--surface)', fontSize: 14.5, fontWeight: 500 }}>Add to Tasks</button>
                <button type="button" onClick={e => archive(cur.id, e)} style={{ minHeight: 44, padding: '0 18px', border: '1px solid var(--border-strong)', background: 'var(--surface)', fontSize: 14.5, fontWeight: 500 }}>Archive</button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function formatAge(at) {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

