import Logo from './Logo.jsx';

// Brand mark + menu button, visible only below the 768px breakpoint
// (see .mobile-topbar in index.css) — opens the Sidebar drawer.
export default function MobileTopBar({ onOpenMenu }) {
  return (
    <div className="mobile-topbar">
      <Logo size={26} textSize={18} color="var(--text)" tone="ink" />
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        style={{ marginLeft: 'auto', width: 44, height: 44, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
    </div>
  );
}
