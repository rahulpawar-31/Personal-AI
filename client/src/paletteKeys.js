// client/src/paletteKeys.js
// The keyboard rules of the command palette, kept apart from the component so they
// can be tested without a browser.

// The backdrop closes the palette on Enter or Space only when the key was pressed on
// the backdrop itself. Key presses made inside the palette bubble up to it, so without
// this check typing a space in the search box closed the palette (#422).
export function backdropKeyCloses(e) {
  return (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget;
}

// Tab and Shift+Tab stay inside the open dialog. `focusables` is the dialog's focusable
// elements in order and `active` is the element that has focus now. Returns the element
// to focus instead of letting the browser move on, or null when the browser's own move
// stays inside the dialog and can be left alone.
export function nextTabTarget({ shift, focusables, active }) {
  if (!focusables.length) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const at = focusables.indexOf(active);
  if (at === -1) return shift ? last : first;       // focus is outside the dialog: bring it in
  if (shift && active === first) return last;       // wrap backwards
  if (!shift && active === last) return first;      // wrap forwards
  return null;                                       // moving between two elements inside
}
