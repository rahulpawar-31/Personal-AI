import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from './api.js';
import { ToastContainer, toast } from './toast.jsx';
import ChatPanel       from './components/ChatPanel.jsx';
import EmailPanel      from './components/EmailPanel.jsx';
import CalendarPanel   from './components/CalendarPanel.jsx';
import TaskPanel       from './components/TaskPanel.jsx';
import DigestPanel     from './components/DigestPanel.jsx';
import LinkedInPanel   from './components/LinkedInPanel.jsx';
import GitHubPanel     from './components/GitHubPanel.jsx';
import SlackPanel      from './components/SlackPanel.jsx';
import Sidebar         from './components/Sidebar.jsx';
import MobileTopBar    from './components/MobileTopBar.jsx';
import CommandPalette  from './components/CommandPalette.jsx';
import AuthPage        from './AuthPage.jsx';
import OnboardingWizard from './OnboardingWizard.jsx';
import SettingsPage     from './SettingsPage.jsx';
import AdminPage        from './AdminPage.jsx';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js';
import { flattenVisualOrder } from './navGroups.js';

const BASE_NAV = [
  { id: 'digest',   label: "Today's digest", dot: '#888780' },
  { id: 'comms',    label: 'Comms',          dot: '#1D9E75' },
  { id: 'calendar', label: 'Calendar',       dot: '#7F77DD' },
  { id: 'tasks',    label: 'Tasks',          dot: '#D85A30' },
  { id: 'github',   label: 'GitHub',         dot: '#24292f' },
  { id: 'linkedin', label: 'LinkedIn',       dot: '#0A66C2' },
  { id: 'slack',    label: 'Slack',          dot: '#611f69' },
  { id: 'chat',     label: 'Chat',           dot: '#378ADD' },
  { id: 'settings', label: 'Settings',       dot: null },
];
const ADMIN_NAV = { id: 'admin', label: 'Admin', dot: '#c0392b' };

// Panel a chat action affects → the toast copy pointing the user at it.
const PANEL_LABEL = { tasks: 'Tasks', calendar: 'Calendar', github: 'GitHub', comms: 'Comms', digest: "Today's digest" };

export default function App() {
  const [navItems, setNavItems] = useState(BASE_NAV);
  const VALID_VIEWS = new Set([...BASE_NAV.map(n => n.id), 'admin']);
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem('devos_view');
    return saved && VALID_VIEWS.has(saved) ? saved : 'digest';
  });
  // ChatPanel's send() is a long-lived async closure (streaming response,
  // can take seconds) that keeps whatever handleChatAction instance was in
  // scope at send-time. Reading a live ref instead of the closed-over
  // `view` means the "already there" check below is always current,
  // regardless of which stale handleChatAction instance ends up called.
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [connected,      setConnected]      = useState(false);
  const [health,         setHealth]         = useState({});
  const [taskRefreshKey,     setTaskRefreshKey]     = useState(0);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [githubRefreshKey,   setGithubRefreshKey]   = useState(0);
  const [emailRefreshKey,    setEmailRefreshKey]    = useState(0);
  const [digestRefreshKey,   setDigestRefreshKey]   = useState(0);

  const [user,           setUser]           = useState(null);
  const [authChecked,    setAuthChecked]    = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [sidebarOpen,    setSidebarOpen]    = useState(false);
  const [paletteOpen,    setPaletteOpen]    = useState(false);

  const isLoggedIn = Boolean(user);

  function applyUser(u) {
    setUser(u);
    if (u?.isAdmin) setNavItems([...BASE_NAV, ADMIN_NAV]);
    else setNavItems(BASE_NAV);
  }

  function handleAuth(newUser, isSignup) {
    applyUser(newUser);
    if (isSignup) {
      localStorage.setItem('devos_onboarding', 'true');
      setShowOnboarding(true);
    }
  }

  function handleOnboardingComplete() {
    localStorage.removeItem('devos_onboarding');
    setShowOnboarding(false);
  }

  function handleLogout() {
    localStorage.removeItem('devos_token');
    localStorage.removeItem('devos_onboarding');
    setUser(null);
  }

  async function handleConnectGoogle() {
    try {
      const r = await apiFetch('/api/auth/google/init');
      if (r.status === 401) { handleLogout(); return; }
      let data;
      try { data = await r.json(); } catch { return; }
      if (data.url) window.location.href = data.url;
    } catch { /* network error */ }
  }

  function fetchHealth() {
    apiFetch('/api/health')
      .then(r => r.json())
      .then(d => { setHealth(d); setConnected(d.google); return null; })
      .catch(() => {});
  }

  function handleViewChange(newView) {
    if (view === 'settings') fetchHealth();
    localStorage.setItem('devos_view', newView);
    setView(newView);
  }

  // Keyboard/palette navigation bypasses Sidebar's own click handler (which
  // also closes the mobile drawer) — route both through here so the drawer
  // never gets left open over whatever panel was just jumped to.
  function navigateTo(newView) {
    handleViewChange(newView);
    setSidebarOpen(false);
  }

  function handleChatAction(panel) {
    if (panel === 'tasks')    setTaskRefreshKey(k => k + 1);
    if (panel === 'calendar') setCalendarRefreshKey(k => k + 1);
    if (panel === 'github')   setGithubRefreshKey(k => k + 1);
    if (panel === 'comms')    setEmailRefreshKey(k => k + 1);
    if (panel === 'digest')   setDigestRefreshKey(k => k + 1);

    // Chat and panels drive the same actions but look disconnected —
    // this makes the link visible instead of silently bumping a refresh key.
    const label = PANEL_LABEL[panel];
    if (label && viewRef.current !== panel) {
      toast(`Updated ${label}`, 'success', 5000, { label: 'View →', onClick: () => handleViewChange(panel) });
    }
  }

  const lastRefreshRef = useRef(Date.now());

  const refreshAll = useCallback(() => {
    lastRefreshRef.current = Date.now();
    setTaskRefreshKey(k => k + 1);
    setCalendarRefreshKey(k => k + 1);
    setGithubRefreshKey(k => k + 1);
    setEmailRefreshKey(k => k + 1);
    setDigestRefreshKey(k => k + 1);
    apiFetch('/api/health')
      .then(r => r.json())
      .then(d => { setHealth(d); setConnected(d.google); return null; })
      .catch(() => {});
  }, []);

  // Auto-refresh: on tab focus (if away >5 min) + every 10 min while active
  useEffect(() => {
    if (!isLoggedIn) return;

    const STALE_MS = 5 * 60 * 1000;
    const INTERVAL_MS = 10 * 60 * 1000;

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshRef.current > STALE_MS) {
        refreshAll();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAll();
    }, INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    };
  }, [isLoggedIn, refreshAll]);

  // Same order Sidebar renders its groups in (navGroups.js is the shared
  // source of truth) — settings/admin are deliberately excluded, there's
  // no room left in 1-9 once the 8 grouped panels take their slots.
  const shortcutItems = flattenVisualOrder(navItems);

  useKeyboardShortcuts({
    enabled: isLoggedIn && !showOnboarding,
    onCommandPalette: () => setPaletteOpen(true),
    onNavigateIndex: i => { if (shortcutItems[i]) navigateTo(shortcutItems[i].id); },
    onEscape: () => {
      if (paletteOpen) setPaletteOpen(false);
      else if (sidebarOpen) setSidebarOpen(false);
    },
  });

  const paletteItems = [
    ...navItems.map(n => ({
      id: `nav-${n.id}`, label: n.label, section: 'Go to', dot: n.dot,
      onSelect: () => navigateTo(n.id),
    })),
    { id: 'refresh-all', label: 'Refresh all panels', section: 'Actions', onSelect: refreshAll },
    ...(!connected ? [{ id: 'connect-google', label: 'Connect Google', section: 'Actions', onSelect: handleConnectGoogle }] : []),
  ];

  useEffect(() => {
    const token = localStorage.getItem('devos_token');
    if (token) {
      // Use apiFetch (not raw fetch) so an expired 15m access token gets a
      // silent refresh attempt via the httpOnly refresh cookie before we
      // give up and treat the session as logged out.
      apiFetch('/api/users/me')
        .then(async r => {
          if (r.ok) return r.json();
          // Only clear the token on 401 (invalid/expired token).
          // 502/503 means the server is restarting — keep the token so the
          // user stays logged in once the server comes back up.
          if (r.status === 401) {
            localStorage.removeItem('devos_token');
            localStorage.removeItem('devos_onboarding');
          }
          return null;
        })
        .then(u => {
          if (u) {
            applyUser(u);
            if (localStorage.getItem('devos_onboarding') === 'true') setShowOnboarding(true);
          }
          setAuthChecked(true);
          return null;
        })
        .catch(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }

    const params = new URLSearchParams(window.location.search);
    const googleToken = new URLSearchParams(window.location.hash.slice(1)).get('google_token');
    if (googleToken) {
      localStorage.setItem('devos_token', googleToken);
      window.history.replaceState({}, '', '/');
      fetch('/api/users/me', { headers: { Authorization: `Bearer ${googleToken}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(u => { if (u) { applyUser(u); setAuthChecked(true); } return null; })
        .catch(() => {});
      fetchHealth();
      return;
    }

    if (localStorage.getItem('devos_token')) fetchHealth();

    if (window.location.search.includes('connected=true')) {
      setConnected(true);
      if (localStorage.getItem('devos_onboarding') !== 'true') {
        window.history.replaceState({}, '', '/');
      }
    }
    if (window.location.search.includes('google_connected=true')) {
      setConnected(true);
      setView('settings');
    }
  }, []);

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--hint)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }
  if (!user) return <AuthPage onAuth={handleAuth} />;
  if (showOnboarding) return <OnboardingWizard user={user} onComplete={handleOnboardingComplete} />;

  const isTasksView = view === 'tasks';
  const isChatView  = view === 'chat';

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      <ToastContainer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

      <Sidebar
        view={view}
        setView={handleViewChange}
        navItems={navItems}
        user={user}
        health={health}
        connected={connected}
        onLogout={handleLogout}
        onConnectGoogle={handleConnectGoogle}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <main style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
      }}>
        <MobileTopBar onOpenMenu={() => setSidebarOpen(true)} />
        <div
          className={isTasksView || isChatView ? 'main-content--tight' : 'main-content'}
          style={{
            flex: 1,
            overflow: isTasksView ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: view === 'digest'   ? 'block' : 'none' }}><DigestPanel health={health} connected={connected} refreshKey={digestRefreshKey} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: view === 'comms'    ? 'block' : 'none' }}><EmailPanel connected={connected} refreshKey={emailRefreshKey} onConnectGoogle={handleConnectGoogle} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: view === 'calendar' ? 'block' : 'none' }}><CalendarPanel connected={connected} refreshKey={calendarRefreshKey} onConnectGoogle={handleConnectGoogle} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: isTasksView ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}><TaskPanel refreshKey={taskRefreshKey} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: view === 'github'   ? 'block' : 'none' }}><GitHubPanel health={health} refreshKey={githubRefreshKey} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: view === 'linkedin' ? 'block' : 'none' }}><LinkedInPanel health={health} /></div>
          <div style={{ display: view === 'slack'    ? 'block' : 'none' }}><SlackPanel health={health} onGoToSettings={() => handleViewChange('settings')} /></div>
          <div style={{ display: isChatView ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}><ChatPanel onAction={handleChatAction} health={health} connected={connected} /></div>
          {view === 'settings' && <SettingsPage user={user} onLogout={handleLogout} health={health} />}
          {view === 'admin'    && <AdminPage user={user} />}
        </div>
      </main>
    </div>
  );
}
