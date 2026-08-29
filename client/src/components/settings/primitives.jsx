import { useEffect, useState } from 'react';
import ServiceIcon from './ServiceIcon.jsx';

const TAG_STYLES = {
  required:    { background: '#FDECEA', color: '#B71C1C' },
  recommended: { background: '#E8F5E9', color: '#1B5E20' },
  optional:    { background: '#EDE7F6', color: '#311B92' },
};

export function SectionLabel({ label, tag }) {
  const tc = TAG_STYLES[tag] ?? TAG_STYLES.optional;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 10px' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', padding: '2px 7px', borderRadius: 99, ...tc }}>
        {tag}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export function IntegrationGroup({ children }) {
  return (
    <div style={{
      background: '#fff',
      border: '1.5px solid rgba(0,0,0,0.1)',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      {children}
    </div>
  );
}

// Colors + copy for ToggleBtn's 3 states — was a chain of nested ternaries.
function toggleBtnState(expanded, connected) {
  if (expanded)  return { bg: 'var(--text)', border: 'transparent',       color: '#fff',   title: 'Close' };
  if (connected) return { bg: '#E8F5E9',     border: '#86c997',           color: '#1B7A33', title: 'Manage connection' };
  return             { bg: '#fff',        border: 'rgba(0,0,0,0.18)', color: '#555',   title: 'Connect' };
}

function ToggleBtnIcon({ expanded, connected }) {
  if (expanded) {
    // × close
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    );
  }
  if (connected) {
    // ✓ connected
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20,6 9,17 4,12"/>
      </svg>
    );
  }
  // + add
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

// Action button — green ✓ when connected, + when not, × when the panel is open
export function ToggleBtn({ expanded, onClick, connected }) {
  const { bg, border, color, title } = toggleBtnState(expanded, connected);

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 28, height: 28, padding: 0, flexShrink: 0,
        border: `1.5px solid ${border}`,
        borderRadius: 7,
        background: bg,
        color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: expanded ? 'none' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <ToggleBtnIcon expanded={expanded} connected={connected} />
    </button>
  );
}

export function IntegrationRow({ service, label, connected, children, actionSlot }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px' }}>
        {/* Brand icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: '#fff', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, overflow: 'hidden',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}>
          <ServiceIcon service={service} />
        </div>

        {/* Name + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500, fontSize: 13.5, color: 'var(--text)' }}>{label}</span>
            {connected && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#1B7A33', background: '#E8F5E9', padding: '1px 8px', borderRadius: 99, flexShrink: 0 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1B7A33' }} />
                {' '}Connected
              </span>
            )}
          </div>
        </div>

        {actionSlot}
      </div>

      {children && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '16px 18px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function RowDivider() {
  return <div style={{ height: 1, background: 'rgba(0,0,0,0.07)' }} />;
}

// Floating modal dialog
export function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.28)',
        }}
      />
      {/* Dialog */}
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 480, maxWidth: '94vw', maxHeight: '90vh',
        background: 'var(--bg)',
        borderRadius: 12,
        border: '1px solid var(--border)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{
            width: 26, height: 26, borderRadius: 6, padding: 0,
            border: '1px solid var(--border)', background: 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', padding: '20px 20px 28px', flex: 1 }}>
          {children}
        </div>
      </div>
    </>
  );
}

export function FieldGroup({ label, hint, linkText, linkHref, value, onChange, placeholder = '••••••••••••••••', type = 'password', required = true }) {
  const [show, setShow] = useState(false);
  const isSecret = type === 'password';

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Label with required marker */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}
      </div>
      {/* Input */}
      <div style={{ position: 'relative' }}>
        <input
          type={isSecret && !show ? 'password' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          style={{ fontFamily: isSecret ? 'monospace' : 'inherit', paddingRight: isSecret ? 36 : undefined, width: '100%', boxSizing: 'border-box' }}
          autoComplete={isSecret ? 'one-time-code' : 'off'}
        />
        {isSecret && (
          <button type="button" onClick={() => setShow(v => !v)} tabIndex={-1}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--hint)', display: 'flex', alignItems: 'center' }}
            aria-label={show ? 'Hide' : 'Show'}>
            {show ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        )}
      </div>
      {/* Hint BELOW the input */}
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
          {hint}
          {linkText && linkHref && (
            <> — <a href={linkHref} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{linkText}</a></>
          )}
        </div>
      )}
    </div>
  );
}

const CREDENTIALS_TITLES = {
  slack:    'OAuth2 Credentials',
  notion:   'Integration Credentials',
  github:   'Access Token',
  linkedin: 'Webhook Configuration',
  trello:   'API Credentials',
  todoist:  'API Credentials',
  gemini:   'API Credentials',
  groq:     'API Credentials',
  google:   'Google Credentials',
};

// Expanded panel layout inside the connection modal
export function SetupPanel({ service, label, setupLinkLabel, setupLinkHref, credentialsTitle, credentialsSubtitle, children, onDisconnect, connected, testing, onSave, error, warning, extraActions }) {
  return (
    <div>
      {/* ── Section 1: Setup Documentation ── */}
      {setupLinkHref && (
        <a href={setupLinkHref} target="_blank" rel="noopener noreferrer"
          style={{ textDecoration: 'none', display: 'block', marginBottom: 24 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '11px 14px',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          }}>
            <ServiceIcon service={service} />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
              {setupLinkLabel ?? `${label} Setup`}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </div>
        </a>
      )}

      {/* ── Credentials section ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
          {credentialsTitle ?? CREDENTIALS_TITLES[service] ?? `${label} Credentials`}
        </div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {credentialsSubtitle ?? `Enter your ${label} authentication details`}
        </p>
        {children}
      </div>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="primary" onClick={onSave} disabled={testing}
          style={{ padding: '7px 16px', fontSize: 13 }}>
          {testing ? 'Testing…' : 'Save & test'}
        </button>
        {extraActions}
        {connected && onDisconnect && (
          <button onClick={onDisconnect}
            style={{ fontSize: 12, color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            Disconnect
          </button>
        )}
      </div>
      <ErrorMsg msg={error} />
      <WarnMsg msg={warning} />
    </div>
  );
}

export function WarnMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: '#7c4a00', background: '#fff8e1', padding: '7px 10px', borderRadius: 6, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}

export function ErrorMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: '#B71C1C', background: '#FDECEA', padding: '7px 10px', borderRadius: 6, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}
