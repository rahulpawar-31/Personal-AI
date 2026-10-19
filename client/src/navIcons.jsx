// 24x24 stroke paths for the nav, shared by the sidebar and phone tab bar.
export const NAV_ICONS = {
  digest:   'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chat:     'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  comms:    'M3 6h18v12H3z M3 7l9 6 9-6',
  calendar: 'M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4',
  tasks:    'M5 12.5l4.5 4.5L19 7',
  github:   'M8 8l-5 4 5 4 M16 8l5 4-5 4 M14 5l-4 14',
  linkedin: 'M4 4h16v16H4z M8 10v6 M8 7.5v.01 M12 16v-6 M12 12.5c0-2 4-2 4 0V16',
  slack:    'M5 9h14 M5 15h14 M9 4l-2 16 M17 4l-2 16',
  settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5v4 M8 15v4',
  admin:    'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  more:     'M4 7h16M4 12h16M4 17h16',
};

export function NavIcon({ id, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={NAV_ICONS[id]} />
    </svg>
  );
}
