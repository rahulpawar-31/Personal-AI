import { ROLES } from '../roles.js';

// Radio list of roles. `value` is the selected id (or null); `onChange` gets the new id.
export default function RolePicker({ value, onChange, disabled = false, name = 'role' }) {
  return (
    <div role="radiogroup" aria-label="Your role" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ROLES.map(r => {
        const selected = value === r.id;
        return (
          <label key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px',
            border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', background: selected ? 'rgba(15,123,92,0.04)' : 'var(--bg)',
            cursor: disabled ? 'default' : 'pointer', transition: 'border-color 0.2s',
          }}>
            <input
              type="radio"
              name={name}
              value={r.id}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(r.id)}
              style={{ margin: 0, accentColor: 'var(--accent)' }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{r.label}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.hint}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
