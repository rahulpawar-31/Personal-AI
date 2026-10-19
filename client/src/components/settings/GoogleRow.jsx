import { IntegrationRow, ToggleBtn, ErrorMsg } from './primitives.jsx';

export default function GoogleRow({ connected, email, onConnect, onDisconnect, error }) {
  return (
    <IntegrationRow
      service="google" label="Google" description={email ? `Gmail and Calendar · ${email}` : 'Gmail and Calendar'}
      connected={connected}
      actionSlot={
        connected
          ? <button onClick={onDisconnect} style={{ minHeight: 44, padding: '0 18px', border: '1px solid var(--border-strong)', borderRadius: 10, background: 'var(--surface)', color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>Disconnect</button>
          : <ToggleBtn expanded={false} connected={connected} onClick={onConnect} />
      }
    >
      {error && <ErrorMsg msg={error} />}
    </IntegrationRow>
  );
}
