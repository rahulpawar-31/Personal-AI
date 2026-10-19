import { NavIcon } from '../navIcons.jsx';

const TABS = [
  { id: 'digest', label: 'Today' },
  { id: 'chat',   label: 'Chat' },
  { id: 'comms',  label: 'Mail' },
  { id: 'tasks',  label: 'Tasks' },
];
const MAIN_TABS = new Set(TABS.map(t => t.id));

// Phone-only bottom bar (hidden above 768px via .mobile-tabbar). Anything
// that isn't one of the four tabs lives under "More", which opens the drawer.
export default function MobileTabBar({ view, setView, onOpenMore }) {
  return (
    <nav className="mobile-tabbar" aria-label="Main">
      {TABS.map(t => (
        <button key={t.id} onClick={() => setView(t.id)} aria-current={view === t.id ? 'page' : undefined}>
          <NavIcon id={t.id} size={20} />
          <span>{t.label}</span>
        </button>
      ))}
      <button onClick={onOpenMore} aria-current={MAIN_TABS.has(view) ? undefined : 'page'}>
        <NavIcon id="more" size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
