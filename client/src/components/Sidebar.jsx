import { groupMainNavItems } from '../navGroups.js';
import { NavIcon } from '../navIcons.jsx';
import Logo from './Logo.jsx';

function NavItem({ id, label, active, onClick, shortcut, badge }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="nav-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 11,
        width: '100%', minHeight: 40, padding: '0 10px',
        border: 'none', borderRadius: 8,
        margin: '1px 0',
        background: active ? 'var(--sidebar-active-bg)' : 'transparent',
        color: active ? 'var(--sidebar-text)' : 'var(--sidebar-item-color)',
        fontWeight: 500,
        fontSize: 14,
        cursor: 'pointer',
        textAlign: 'left',
        lineHeight: 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sidebar-hover-bg)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <NavIcon id={id} />
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--sidebar-muted)' }}>{shortcut}</span>}
      {badge && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '2px 6px', borderRadius: 5, background: 'var(--sidebar-active-bg)', color: 'var(--accent-soft)',
        }}>{badge}</span>
      )}
    </button>
  );
}

function ServiceDot({ label, ok }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sidebar-item-color)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'var(--success)' : '#D08A1E', flexShrink: 0 }} />
      {label}
    </span>
  );
}

export default function Sidebar({ view, setView, navItems, user, health, connected, onLogout, onConnectGoogle, mobileOpen = false, onCloseMobile }) {
  const bottomItems = navItems.filter(n => ['settings', 'admin'].includes(n.id));

  const services = [
    { label: 'AI',     ok: health.gemini || health.groq },
    { label: 'Google', ok: connected },
    { label: 'GitHub', ok: health.github },
    { label: 'Notion', ok: health.notion },
    { label: 'Slack',  ok: health.slack },
  ];

  function selectView(id) {
    setView(id);
    onCloseMobile?.();
  }

  const grouped = groupMainNavItems(navItems);
  const order = grouped.flatMap(g => g.items.map(n => n.id));
  const shortcutIndex = id => order.indexOf(id) + 1;

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} />}
      <aside
        className={`sidebar${mobileOpen ? ' sidebar--open' : ''}`}
        style={{
          width: 232,
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '24px 24px 8px' }}>
          <Logo color="var(--sidebar-text)" />
        </div>

        {/* Main nav */}
        <nav aria-label="Panels" style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 0' }}>
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <div className="nav-section-label">{group}</div>
              {items.map(n => (
                <NavItem key={n.id} {...n} shortcut={String(shortcutIndex(n.id))} active={view === n.id} onClick={() => selectView(n.id)} />
              ))}
            </div>
          ))}
        </nav>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '6px 24px' }} />

        {/* Bottom nav */}
        <div style={{ padding: '0 14px 4px' }}>
          {bottomItems.map(n => (
            <NavItem key={n.id} {...n} badge={n.id === 'admin' ? 'admin' : undefined} active={view === n.id} onClick={() => selectView(n.id)} />
          ))}
        </div>

        {/* Service status */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--sidebar-border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 8px' }}>
            {services.map(s => <ServiceDot key={s.label} {...s} />)}
          </div>
          {!connected && (
            <button
              onClick={onConnectGoogle}
              style={{
                marginTop: 8, width: '100%', fontSize: 12.5, padding: '8px', minHeight: 36,
                borderRadius: 8, border: '1px solid var(--sidebar-border)',
                background: 'transparent', color: 'var(--sidebar-item-color)',
                cursor: 'pointer', textAlign: 'center',
              }}
            >
              + Connect Google
            </button>
          )}
        </div>

        {/* User */}
        <div style={{ padding: '12px 24px 18px', borderTop: '1px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--sidebar-avatar-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--sidebar-text)', fontWeight: 600, fontSize: 13, flexShrink: 0,
          }}>
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: 'var(--sidebar-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.username}
          </span>
          <button
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            style={{
              width: 44, height: 44, padding: 0, fontSize: 14, borderRadius: 8,
              border: '1px solid var(--sidebar-border)',
              background: 'transparent', color: 'var(--sidebar-item-color)', cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ↩
          </button>
        </div>
      </aside>
    </>
  );
}
