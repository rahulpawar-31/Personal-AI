// Shown instead of the sign-in form when the server could not confirm a stored
// session (it is down or restarting, or there is no network). The sign-in is
// probably still good, so the first choice is to try again, not to ask for a password.
export default function SessionRetry({ onRetry, onSignOut }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 16 }}>
      <div role="alert" style={{ maxWidth: 380, textAlign: 'center' }}>
        <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Can't reach the server</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' }}>
          Your sign-in is still saved. The server did not answer, so we could not open your workspace.
          Check your connection and try again.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="primary" onClick={onRetry} autoFocus>Try again</button>
          <button onClick={onSignOut}>Sign in again</button>
        </div>
      </div>
    </div>
  );
}
