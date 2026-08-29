export default function ServiceIcon({ service }) {
  const s = { display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (service === 'google') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
  if (service === 'gemini') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <path fill="#4285F4" d="M12 2 9.1 9.1 2 12l7.1 2.9L12 22l2.9-7.1L22 12l-7.1-2.9z"/>
    </svg>
  );
  if (service === 'groq') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <circle cx="12" cy="12" r="10" fill="#F55036"/>
      <text x="7" y="17" fontSize="13" fontWeight="bold" fill="white">G</text>
    </svg>
  );
  if (service === 'notion') return (
    <svg width="18" height="18" viewBox="0 0 100 100" style={s}>
      <rect width="100" height="100" rx="12" fill="white"/>
      <path d="M12 12 h50 l24 24 v52 H12 z" fill="white" stroke="#e5e5e5" strokeWidth="4"/>
      <path d="M26 30 L26 72 M26 30 L58 70 M58 30 L58 72" stroke="#1a1a1a" strokeWidth="8" strokeLinecap="round" fill="none"/>
    </svg>
  );
  if (service === 'github') return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#24292f" style={s}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
  );
  if (service === 'slack') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <path fill="#E01E5A" d="M5.04 15.17a2.52 2.52 0 0 1-2.52 2.52A2.52 2.52 0 0 1 0 15.17a2.52 2.52 0 0 1 2.52-2.52h2.52v2.52zM6.3 15.17a2.52 2.52 0 0 1 2.52-2.52 2.52 2.52 0 0 1 2.52 2.52v6.3A2.52 2.52 0 0 1 8.82 24a2.52 2.52 0 0 1-2.52-2.52v-6.3zM8.82 5.04a2.52 2.52 0 0 1-2.52-2.52A2.52 2.52 0 0 1 8.82 0a2.52 2.52 0 0 1 2.52 2.52v2.52H8.82zM8.82 6.3a2.52 2.52 0 0 1 2.52 2.52 2.52 2.52 0 0 1-2.52 2.52H2.52A2.52 2.52 0 0 1 0 8.82a2.52 2.52 0 0 1 2.52-2.52h6.3zM18.96 8.82a2.52 2.52 0 0 1 2.52-2.52A2.52 2.52 0 0 1 24 8.82a2.52 2.52 0 0 1-2.52 2.52h-2.52V8.82zM17.7 8.82a2.52 2.52 0 0 1-2.52 2.52 2.52 2.52 0 0 1-2.52-2.52V2.52A2.52 2.52 0 0 1 15.18 0a2.52 2.52 0 0 1 2.52 2.52v6.3zM15.18 18.96a2.52 2.52 0 0 1 2.52 2.52A2.52 2.52 0 0 1 15.18 24a2.52 2.52 0 0 1-2.52-2.52v-2.52h2.52zM15.18 17.7a2.52 2.52 0 0 1-2.52-2.52 2.52 2.52 0 0 1 2.52-2.52h6.3A2.52 2.52 0 0 1 24 15.18a2.52 2.52 0 0 1-2.52 2.52h-6.3z"/>
    </svg>
  );
  if (service === 'todoist') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <circle cx="12" cy="12" r="11" fill="#DB4035"/>
      <path d="M7 12l3.5 3.5L17 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
  if (service === 'trello') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <rect width="24" height="24" rx="5" fill="#0052CC"/>
      <rect x="3.5" y="4" width="6.5" height="12" rx="1.5" fill="white"/>
      <rect x="14" y="4" width="6.5" height="8.5" rx="1.5" fill="white"/>
    </svg>
  );
  if (service === 'linkedin') return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={s}>
      <rect width="24" height="24" rx="4" fill="#0A66C2"/>
      <path fill="white" d="M7.2 9.6h2.4V17H7.2V9.6zM8.4 8.6a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zM11.6 9.6h2.3v1h.03A2.6 2.6 0 0 1 16.3 9.4c2.4 0 2.9 1.6 2.9 3.7V17h-2.4v-3.4c0-.8 0-1.9-1.16-1.9-1.17 0-1.34.9-1.34 1.84V17h-2.4V9.6z"/>
    </svg>
  );
  // fallback
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#aaa' }} />;
}
