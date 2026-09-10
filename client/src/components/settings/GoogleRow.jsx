import { IntegrationRow, ToggleBtn, ErrorMsg } from './primitives.jsx';

export default function GoogleRow({ connected, email, onConnect, onDisconnect, error }) {
  return (
    <IntegrationRow
      service="google" label="Google"
      connected={connected}
      actionSlot={
        connected
          ? <button onClick={onDisconnect} style={{ fontSize: 12, color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>Disconnect</button>
          : <ToggleBtn expanded={false} connected={connected} onClick={onConnect} />
      }
    >
      {error && <ErrorMsg msg={error} />}
    </IntegrationRow>
  );
}
