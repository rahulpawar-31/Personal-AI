import { useEffect } from 'react';

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Global keyboard shortcuts for the app shell: ⌘K / Ctrl+K opens the
// command palette, 1-9 jumps to a nav panel (only outside text inputs),
// Escape is handed back to the caller to decide what it closes.
export function useKeyboardShortcuts({ onCommandPalette, onNavigateIndex, onEscape, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommandPalette?.();
        return;
      }

      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (mod || e.altKey || isTypingTarget(document.activeElement)) return;

      if (onNavigateIndex && /^[1-9]$/.test(e.key)) {
        onNavigateIndex(Number(e.key) - 1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onCommandPalette, onNavigateIndex, onEscape]);
}
