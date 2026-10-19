import { useEffect, useState } from 'react';
import ServiceIcon from './ServiceIcon.jsx';

const TAG_STYLES = {
  required:    { background: 'var(--tag-danger-bg)',  color: 'var(--tag-danger-fg)' },
  recommended: { background: 'var(--tag-success-bg)', color: 'var(--tag-success-fg)' },
  optional:    { background: 'var(--tag-info-bg)',    color: 'var(--tag-info-fg)' },
};

export function SectionLabel({ label, tag }) {
  const tc = TAG_STYLES[tag] ?? TAG_STYLES.optional;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '32px 0 10px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 500, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', padding: '3px 8px', borderRadius: 6, ...tc }}>
        {tag}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

export function IntegrationGroup({ children }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: 'var(--border-hairline)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

// Text button for an integration row: "Connect", "Manage" or "Close".
export function ToggleBtn({ expanded, onClick, connected }) {
  const label = expanded ? 'Close' : connected ? 'Manage' : 'Connect';
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      style={{
        minHeight: 44, padding: '0 18px', flexShrink: 0,
        border: '1px solid var(--border-strong)', borderRadius: 10,
        background: 'var(--surface)', color: 'var(--text)',
        fontSize: 14, fontWeight: 600, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function IntegrationRow({ service, label, description, connected, children, actionSlot }) {
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '16px 22px' }}>
        {/* Brand icon with a status dot */}
        <span style={{ position: 'relative', flex: 'none', width: 44, height: 44 }}>
          <span style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <ServiceIcon service={service} />
          </span>
          <span style={{
            position: 'absolute', right: -3, bottom: -3, width: 13, height: 13, borderRadius: 999,
            background: connected ? 'var(--success)' : '#D08A1E', border: '2.5px solid var(--surface)', boxSizing: 'border-box',
          }} />
        </span>

        {/* Name + description */}
        <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 16, color: 'var(--text)' }}>{label}</span>
          {description && <span style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.4 }}>{description}</span>}
        </div>

        <span style={{ fontSize: 13, fontWeight: 500, color: connected ? 'var(--tag-success-fg)' : 'var(--warning)' }}>
          {connected ? 'Connected' : 'Not connected'}
        </span>

        {actionSlot}
      </div>

      {children && (
        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '16px 22px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function RowDivider() {
  return <div style={{ height: 1, background: 'var(--border)' }} />;
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
          background: 'rgba(23,25,27,0.4)',
        }}
      />
      {/* Dialog */}
      <div role="dialog" aria-modal="true" aria-label={title} style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 520, maxWidth: '94vw', maxHeight: '90vh',
        background: 'var(--surface)',
        borderRadius: 16,
        border: '1px solid var(--border)',
        zIndex: 201,
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-2)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 22px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 18, color: 'var(--text)' }}>{title}</span>
          <button onClick={onClose} aria-label="Close" style={{
            width: 44, height: 44, borderRadius: 10, padding: 0,
            border: '1px solid var(--border-strong)', background: 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-2)', fontSize: 20, fontWeight: 500,
          }}>
            ×
          </button>
        </div>
        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', padding: '22px 22px 28px', flex: 1 }}>
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
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>
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
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--hint)', display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 500 }}
            aria-label={show ? 'Hide' : 'Show'}>
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {/* Hint BELOW the input */}
      {hint && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5, lineHeight: 1.5 }}>
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

// Shown when the server holds a saved key it can no longer decrypt (usually
// because its encryption secret changed). Saving a fresh key replaces it.
export const UNREADABLE_KEY_MESSAGE =
  "This saved key can't be read any more. The server's encryption secret has probably changed. Enter the key again and save it to reconnect.";

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
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
              {setupLinkLabel ?? `${label} Setup`}
            </span>
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>↗</span>
          </div>
        </a>
      )}

      {/* ── Credentials section ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>
          {credentialsTitle ?? CREDENTIALS_TITLES[service] ?? `${label} Credentials`}
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {credentialsSubtitle ?? `Enter your ${label} authentication details`}
        </p>
        {children}
      </div>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="primary" onClick={onSave} disabled={testing}
          style={{ padding: '0 20px', minHeight: 44, fontSize: 14.5 }}>
          {testing ? 'Testing…' : 'Save & test'}
        </button>
        {extraActions}
        {connected && onDisconnect && (
          <button onClick={onDisconnect}
            style={{ fontSize: 13, color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
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
    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--tag-warn-fg)', background: 'var(--tag-warn-bg)', padding: '7px 10px', borderRadius: 6, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}

export function ErrorMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--tag-danger-fg)', background: 'var(--tag-danger-bg)', padding: '7px 10px', borderRadius: 6, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}
