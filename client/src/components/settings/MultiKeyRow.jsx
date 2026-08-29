import { useState } from 'react';
import { IntegrationRow, ToggleBtn, Modal, SetupPanel, FieldGroup } from './primitives.jsx';

// Multi-key integration row (Notion, GitHub, Trello, Slack, LinkedIn)
export default function MultiKeyRow({ service, label, description, fields: fieldDefs, saved, testing, onTest, onForceSave, onDisconnect, error, primaryKey }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState({});
  const keyMeta = saved?.[service]?.[primaryKey];
  const connected = !!keyMeta;

  function setField(key, val) { setValues(v => ({ ...v, [key]: val })); }

  async function handleTest() {
    const ok = await onTest(service, values);
    if (ok) { setExpanded(false); setValues({}); }
  }

  async function handleForceSave() {
    const ok = await onForceSave?.(service, values);
    if (ok) { setExpanded(false); setValues({}); }
  }

  const primaryField = fieldDefs[0];
  const hasValues = Object.values(values).some(v => v?.trim());

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
          setupLinkLabel={`${label} ${primaryField?.label ?? 'Credentials'} Setup`}
          setupLinkHref={primaryField?.linkHref}
          connected={connected}
          testing={testing === service}
          onSave={handleTest}
          onDisconnect={connected && onDisconnect ? () => { onDisconnect(service); setExpanded(false); } : null}
          error={error}
          extraActions={onForceSave && error && hasValues ? (
            <button onClick={handleForceSave} disabled={testing === service}
              style={{ fontSize: 12, color: 'var(--muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
              Save anyway
            </button>
          ) : null}
        >
          {fieldDefs.map(f => (
            <FieldGroup
              key={f.key} label={f.label} hint={f.hint}
              value={values[f.key] ?? ''}
              onChange={val => setField(f.key, val)}
              placeholder={f.placeholder}
              type={f.type ?? 'password'}
              required={f.type !== 'text' || f.key === fieldDefs[0].key}
            />
          ))}
        </SetupPanel>
      </Modal>
    </>
  );
}
