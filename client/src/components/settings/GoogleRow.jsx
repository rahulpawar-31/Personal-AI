import { IntegrationRow, ToggleBtn, ErrorMsg } from './primitives.jsx';

export default function GoogleRow({ connected, email, onConnect, error }) {
  return (
    <IntegrationRow
      service="google" label="Google"
      connected={connected}
      actionSlot={
        <ToggleBtn expanded={false} connected={connected} onClick={onConnect} />
      }
    >
      {error && <ErrorMsg msg={error} />}
    </IntegrationRow>
  );
}
