// Hamburger + brand mark, visible only below the 768px breakpoint
// (see .mobile-topbar in index.css) — opens the Sidebar drawer.
export default function MobileTopBar({ onOpenMenu }) {
  return (
    <div className="mobile-topbar">
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        style={{ padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 5h14M2 9h14M2 13h14" />
        </svg>
      </button>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 11, flexShrink: 0,
        letterSpacing: '-0.02em',
      }}>D</div>
      <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)', letterSpacing: '-0.01em' }}>DevOS</span>
    </div>
  );
}
