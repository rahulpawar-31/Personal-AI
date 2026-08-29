// Shared loading / empty / error treatments so panels stop hand-rolling
// their own blank-screen and "Loading…" text. Visual language matches
// NotConnected.jsx (same icon-circle + title + description shape).

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <span className="spinner" style={{ marginBottom: 14 }} />
      <div className="state-block__desc">{label}</div>
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry, retryLabel = 'Retry' }) {
  return (
    <div className="state-block" role="alert">
      <div className="state-block__icon" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>!</div>
      <div className="state-block__title">{title}</div>
      {description && <p className="state-block__desc" style={{ marginBottom: onRetry ? 20 : 0 }}>{description}</p>}
      {onRetry && (
        <button className="primary" onClick={onRetry} style={{ minWidth: 120, padding: '7px 18px' }}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon = '○', title, description, action, actionLabel, onAction }) {
  return (
    <div className="state-block">
      <div className="state-block__icon">{icon}</div>
      {title && <div className="state-block__title">{title}</div>}
      {description && <p className="state-block__desc" style={{ marginBottom: onAction ? 20 : 0 }}>{description}</p>}
      {action}
      {onAction && (
        <button className="primary" onClick={onAction} style={{ minWidth: 140, padding: '8px 18px' }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
