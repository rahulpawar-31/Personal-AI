import { useState } from 'react';
import { IntegrationRow, ToggleBtn, Modal, SetupPanel, FieldGroup, UNREADABLE_KEY_MESSAGE } from './primitives.jsx';

// Single-key integration row (Gemini, Groq, Todoist)
export default function SingleKeyRow({ service, label, description, linkHref, keyName, fieldLabel, fieldHint, saved, testing, onTest, onDisconnect, error, warning }) {
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const keyMeta = saved?.[service]?.[keyName];
  // A saved key the server can no longer decrypt is not a working connection.
  const unreadable = Boolean(keyMeta?.unreadable);
  const connected = Boolean(keyMeta) && !unreadable;

  async function handleTest() {
    const ok = await onTest(service, value);
    if (ok) { setExpanded(false); setValue(''); }
  }

  return (
    <>
      <IntegrationRow
        service={service} label={label} connected={connected}
        actionSlot={<ToggleBtn expanded={expanded} connected={connected} onClick={() => setExpanded(e => !e)} />}
      />
      <Modal open={expanded} onClose={() => setExpanded(false)} title={`${label} Configuration`}>
        <SetupPanel
          service={service} label={label}
          description={description}
          setupLinkLabel={`${label} ${fieldLabel} Setup`}
          setupLinkHref={linkHref}
          connected={connected}
          testing={testing === service}
          onSave={handleTest}
          onDisconnect={connected && onDisconnect ? () => { onDisconnect(service); setExpanded(false); } : null}
          error={error}
          warning={unreadable ? UNREADABLE_KEY_MESSAGE : warning}
        >
          <FieldGroup label={fieldLabel} hint={fieldHint} value={value} onChange={setValue} />
        </SetupPanel>
      </Modal>
    </>
  );
}
