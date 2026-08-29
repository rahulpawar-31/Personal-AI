import { useEffect, useRef, useState } from 'react';

// ⌘K palette — jump to any panel or run a cross-panel action without
// touching the mouse. Items are supplied by App.jsx (nav + a couple of
// actions); this component only owns filtering/keyboard nav/focus.
export default function CommandPalette({ open, onClose, items }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const filtered = items.filter(it => {
    const q = query.toLowerCase();
    return it.label.toLowerCase().includes(q) || it.section?.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  if (!open) return null;

  function select(item) {
    item.onSelect();
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && filtered[activeIndex]) { e.preventDefault(); select(filtered[activeIndex]); }
  }

  let lastSection = null;

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk-box" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command palette">
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
                  aria-selected={i === activeIndex}
                  data-active={i === activeIndex}
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
