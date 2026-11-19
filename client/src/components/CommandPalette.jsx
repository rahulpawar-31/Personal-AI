import { useEffect, useRef, useState } from 'react';
import { backdropKeyCloses, nextTabTarget } from '../paletteKeys.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ⌘K palette — jump to any panel or run a cross-panel action without
// touching the mouse. Items are supplied by App.jsx (nav + a couple of
// actions); this component only owns filtering/keyboard nav/focus.
export default function CommandPalette({ open, onClose, items }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  const filtered = items.filter(it => {
    const q = query.toLowerCase();
    return it.label.toLowerCase().includes(q) || it.section?.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    // Whatever had focus when the palette opened gets it back when it closes.
    const invoker = document.activeElement;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      if (invoker && invoker !== document.body && invoker.isConnected) invoker.focus?.();
    };
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  // Clamped at use-time (not just reset via the query effect above) so
  // Enter/highlighting stay correct even if `items` itself shrinks for a
  // reason other than the search text changing (e.g. a service connects
  // while the palette is open and its "Connect X" action disappears).
  const safeIndex = filtered.length ? Math.min(activeIndex, filtered.length - 1) : 0;

  function select(item) {
    item.onSelect();
    onClose();
  }

  // Keeps Tab and Shift+Tab inside the dialog, so focus never reaches the page behind it.
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const focusables = [...(boxRef.current?.querySelectorAll(FOCUSABLE) ?? [])];
    const target = nextTabTarget({ shift: e.shiftKey, focusables, active: document.activeElement });
    if (target) { e.preventDefault(); target.focus(); }
    else if (!focusables.length) e.preventDefault();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[safeIndex]) { e.preventDefault(); select(filtered[safeIndex]); }
  }

  let lastSection = null;

  return (
    <div className="cmdk-backdrop" onClick={onClose} onKeyDown={e => { if (backdropKeyCloses(e)) onClose(); }}>
      <div ref={boxRef} className="cmdk-box" onClick={e => e.stopPropagation()} onKeyDown={trapTab} role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Jump to a panel or run a command…"
          aria-label="Command palette search"
        />
        <div className="cmdk-list" role="listbox">
          {filtered.length === 0 && <div className="cmdk-empty">No matches</div>}
          {filtered.map((it, i) => {
            const showSection = it.section !== lastSection;
            lastSection = it.section;
            return (
              <div key={it.id}>
                {showSection && <div className="nav-section-label">{it.section}</div>}
                <div
                  role="option"
                  aria-selected={i === safeIndex}
                  data-active={i === safeIndex}
                  className="cmdk-item"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => select(it)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {it.dot && <span className="ds-dot" style={{ background: it.dot }} />}
                    {it.label}
                  </span>
                  <span className="cmdk-kbd">↵</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
