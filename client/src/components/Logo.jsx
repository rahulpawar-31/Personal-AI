// Dayhand monogram: a "D" with an "H" cut into it. `tone="mint"` is the
// mint tile with an ink D (for dark surfaces); `tone="ink"` inverts it.
export function LogoMark({ size = 30, tone = 'mint' }) {
  const tile = tone === 'mint' ? '#6FD3AE' : '#17191B';
  const ink  = tone === 'mint' ? '#17191B' : '#6FD3AE';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Dayhand" style={{ flexShrink: 0 }}>
      <rect width="64" height="64" rx="16" fill={tile} />
      <path d="M13 12H29A20 20 0 0 1 29 52H13Z" fill={ink} stroke={ink} strokeWidth="4" strokeLinejoin="round" />
      <path d="M23 23V41 M37 23V41 M23 32H37" stroke={tile} strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function Logo({ size = 30, tone = 'mint', color = 'currentColor', textSize = 21 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color }}>
      <LogoMark size={size} tone={tone} />
      <span style={{ fontWeight: 600, fontSize: textSize, letterSpacing: '-0.04em', lineHeight: 1 }}>dayhand</span>
    </span>
  );
}
