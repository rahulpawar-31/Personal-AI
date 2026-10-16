import { useState, useEffect } from 'react';

// Calls `handler` whenever the media query's result changes; returns the function
// that stops listening. Older browsers (Safari before 14) only have addListener /
// removeListener on a MediaQueryList, and calling addEventListener there throws.
export function subscribeToMedia(mq, handler) {
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }
  if (typeof mq.addListener === 'function') {
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }
  return () => {};
}

// True while the viewport matches the CSS media query. False where matchMedia
// does not exist (tests, very old browsers), so the desktop layout is the default.
export function useMediaQuery(query) {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    return subscribeToMedia(mq, onChange);
  }, [query]);
  return matches;
}
