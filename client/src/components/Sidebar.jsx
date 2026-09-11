import { groupMainNavItems } from '../navGroups.js';

function NavItem({ label, active, onClick, dot }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 14px 7px 12px',
        border: 'none', borderRadius: 7,
        margin: '1px 0',
        background: active ? 'var(--sidebar-active-bg)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--sidebar-item-color)',
        fontWeight: active ? 500 : 400,
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s, color 0.1s',
        position: 'relative',
        lineHeight: 1,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sidebar-hover-bg)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: dot ?? 'transparent',
        opacity: active ? 1 : 0.65,
      }} />
      {label}
    </button>
  );
}

function ServiceDot({ label, ok }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sidebar-item-color)' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: ok ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
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

  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onCloseMobile} />}
      <aside
        className={`sidebar${mobileOpen ? ' sidebar--open' : ''}`}
        style={{
          width: 220,
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
        <div style={{ padding: '18px 16px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 500, fontSize: 13, flexShrink: 0,
            letterSpacing: '-0.02em',
          }}>D</div>
          <span style={{ fontWeight: 500, fontSize: 14.5, color: 'var(--text)', letterSpacing: '-0.02em' }}>DevOS</span>
        </div>

        {/* Main nav */}
        <nav aria-label="Panels" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 0' }}>
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <div className="nav-section-label">{group}</div>
              {items.map(n => (
                <NavItem key={n.id} {...n} active={view === n.id} onClick={() => selectView(n.id)} />
              ))}
            </div>
          ))}
        </nav>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--sidebar-border)', margin: '6px 16px' }} />

        {/* Bottom nav */}
        <div style={{ padding: '0 8px 4px' }}>
          {bottomItems.map(n => (
            <NavItem key={n.id} {...n} active={view === n.id} onClick={() => selectView(n.id)} />
          ))}
        </div>

        {/* Service status */}
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--sidebar-border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 8px' }}>
            {services.map(s => <ServiceDot key={s.label} {...s} />)}
          </div>
          {!connected && (
            <button
              onClick={onConnectGoogle}
              style={{
                marginTop: 8, width: '100%', fontSize: 11, padding: '5px 8px',
                borderRadius: 6, border: '1px solid var(--sidebar-border)',
                background: 'transparent', color: 'var(--sidebar-item-color)',
                cursor: 'pointer', textAlign: 'center',
              }}
            >
              + Connect Google
            </button>
          )}
        </div>

        {/* User */}
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--sidebar-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: 'var(--sidebar-avatar-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--muted)', fontWeight: 500, fontSize: 11, flexShrink: 0,
          }}>
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--sidebar-item-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            @{user?.username}
          </span>
          <button
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            style={{
              padding: '3px 7px', fontSize: 11, borderRadius: 5,
              border: '1px solid var(--sidebar-border)',
              background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
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
