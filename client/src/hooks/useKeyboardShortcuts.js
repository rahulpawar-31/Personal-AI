import { useEffect } from 'react';

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// True while a "real" modal (a Settings credentials dialog, say) is on
// screen — excludes the command palette itself (.cmdk-box), which has its
// own role="dialog" but should keep responding to Escape/typing normally.
// While a blocking modal is open we stand down entirely and let its own
// local key handling (e.g. its own Escape listener) be the only thing
// that responds — otherwise a digit key could unmount the panel behind
// it and discard whatever the user was typing into the modal.
function isBlockingModalOpen() {
  return !!document.querySelector('[role="dialog"]:not(.cmdk-box)');
}

// Global keyboard shortcuts for the app shell: ⌘K / Ctrl+K opens the
// command palette, 1-9 jumps to a nav panel (only outside text inputs),
// Escape is handed back to the caller to decide what it closes.
export function useKeyboardShortcuts({ onCommandPalette, onNavigateIndex, onEscape, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      if (isBlockingModalOpen()) return;

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
