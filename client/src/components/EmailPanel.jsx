import { useState, useEffect, useRef } from 'react';
import { useCache } from '../hooks/useCache.js';
import PageHeader from './PageHeader.jsx';
import { apiFetch } from '../api.js';
import NotConnected from './NotConnected.jsx';
import { LoadingState } from './ui/States.jsx';
import { toast } from '../toast.jsx';

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

function ReplyDraft({ email, toAddr, onSent }) {
  const [text,    setText]    = useState(email.draftReply || '');
  const [open,    setOpen]    = useState(false);
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

  async function openEmail(id) {
    if (openId === id) { setOpenId(null); return; }
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

  return (
    <div>
      {/* Header */}
      <PageHeader
        eyebrow="Inbox & calendar"
        title="Mail"
        subtitle={loading ? 'Triaging your inbox…' : `${emails.length} ${emails.length === 1 ? 'message' : 'messages'} triaged by priority.`}
      >
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

      <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface)' }}>
      {emails.map(email => {
        const isOpen = openId === email.id;
        const full   = fullEmails[email.id];
        const isLoading = fetching[email.id];

        const { name, email: addr } = parseFrom(email.from);

        return (
          <div
            key={email.id}
            style={{
              borderBottom: '1px solid var(--border)',
              background:   'var(--surface)',
              overflow:     'hidden',
            }}
          >
            {/* Collapsed row */}
            <button
              type="button"
              onClick={() => openEmail(email.id)}
              style={{
                all: 'unset', boxSizing: 'border-box', width: '100%',
                display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 20px', cursor: 'pointer', minHeight: 44,
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'var(--surface-sunken)', color: 'var(--text)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 600,
              }}>
                {(name || addr).charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Sender name + email */}
                <div style={{ fontSize: 14.5, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{name}</span>
                  {addr && <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 13 }}>&lt;{addr}&gt;</span>}
                </div>
                {/* Preview: subject, then snippet */}
                <div style={{
                  fontSize: 14, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.45,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {email.subject}
                  {email.snippet && <span style={{ color: 'var(--muted)' }}> — {email.snippet}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 2 }}>
                {email.priority && <span className={`tag ${PRIORITY_TAG[email.priority] ?? 'tag-gray'}`} style={{ fontFamily: 'var(--font-mono)' }}>{email.priority}</span>}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                  {new Date(email.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
              </div>
            </button>

            {/* Expanded — Gmail-style */}
            {isOpen && (
              <div style={{ borderTop: '1px solid var(--border)' }}>

                {/* Subject bar */}
                <div style={{ padding: '20px 24px 0', background: 'var(--surface)' }}>
                  <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: 'var(--text)', marginBottom: 14 }}>
                    {email.subject}
                  </div>

                  {/* Sender row */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      {/* Avatar */}
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: 'var(--surface-sunken)', color: 'var(--text)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 500,
                      }}>
                        {(name || addr).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)' }}>
                          {(full?.from || email.from).replace(/<.*>/, '').trim()}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                          {full?.from || email.from}
                        </div>
                        {full?.to && (
                          <div style={{ fontSize: 13, color: 'var(--muted)' }}>to {full.to}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', marginTop: 4 }}>
                      {new Date(email.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                {/* Email body */}
                <div style={{ background: 'var(--surface)', padding: '0 4px' }}>
                  {isLoading && <LoadingState label="Loading…" />}
                  {!isLoading && full?.htmlBody && (
                    <EmailIframe html={full.htmlBody} />
                  )}
                  {!isLoading && !full?.htmlBody && (
                    <pre style={{
                      margin: 0, padding: '0 24px 24px',
                      fontSize: 15.5, lineHeight: 1.65, color: 'var(--text)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit',
                      maxHeight: 500, overflowY: 'auto',
                    }}>
                      {full?.body || email.snippet}
                    </pre>
                  )}
                </div>

                {/* AI reply draft */}
                <ReplyDraft email={email} toAddr={addr || email.from} onSent={onReplySent} />

                {/* Action bar */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 24px 16px', background: 'var(--surface)',
                  borderTop: '1px solid var(--border)',
                }}>
                  {email.intent && (
                    <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1 }}>{email.intent}</span>
                  )}
                  <button
                    onClick={e => archive(email.id, e)}
                    style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginLeft: 'auto', border: '1px solid var(--border-strong)', minHeight: 40, padding: '0 18px' }}
                  >
                    Archive
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      </div>

      {!loading && emails.length === 0 && connected && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', paddingTop: 40, fontSize: 15 }}>Inbox clear ✓</p>
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

// Split a "Name <email>" header into its two parts.
function parseFrom(from = '') {
  const m = /^\s*"?(.*?)"?\s*<(.+?)>\s*$/.exec(from);
  if (m) return { name: (m[1].trim() || m[2].trim()), email: m[2].trim() };
  return { name: from.trim(), email: '' };
}
