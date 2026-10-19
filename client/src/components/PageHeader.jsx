// Shared page heading: mono eyebrow (the nav group), big title, one-line
// subtitle, and an optional actions slot on the right.
export default function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {eyebrow && <div className="t-eyebrow">{eyebrow}</div>}
        <h1 style={{ fontSize: 'clamp(26px, 4vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 15.5, color: 'var(--text-2)' }}>{subtitle}</p>}
      </div>
      {children && <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{children}</div>}
    </header>
  );
}
