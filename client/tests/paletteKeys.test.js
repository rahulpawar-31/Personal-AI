import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backdropKeyCloses, nextTabTarget } from '../src/paletteKeys.js';

const backdrop = {}; const input = {};

test('Enter or Space pressed on the backdrop itself closes the palette', () => {
  assert.equal(backdropKeyCloses({ key: 'Enter', target: backdrop, currentTarget: backdrop }), true);
  assert.equal(backdropKeyCloses({ key: ' ', target: backdrop, currentTarget: backdrop }), true);
});

test('a space typed in the search box (a key event that bubbled up) does not close it (#422)', () => {
  assert.equal(backdropKeyCloses({ key: ' ', target: input, currentTarget: backdrop }), false);
  assert.equal(backdropKeyCloses({ key: 'Enter', target: input, currentTarget: backdrop }), false);
});

test('other keys never close it from the backdrop', () => {
  for (const key of ['a', 'Tab', 'ArrowDown', 'Escape']) {
    assert.equal(backdropKeyCloses({ key, target: backdrop, currentTarget: backdrop }), false, key);
  }
});

test('with one focusable element, Tab and Shift+Tab both stay on it', () => {
  const a = {};
  assert.equal(nextTabTarget({ shift: false, focusables: [a], active: a }), a);
  assert.equal(nextTabTarget({ shift: true, focusables: [a], active: a }), a);
});

test('Tab wraps from the last element to the first, Shift+Tab from the first to the last', () => {
  const [a, b, c] = [{}, {}, {}];
  assert.equal(nextTabTarget({ shift: false, focusables: [a, b, c], active: c }), a);
  assert.equal(nextTabTarget({ shift: true, focusables: [a, b, c], active: a }), c);
});

test('moving between two elements inside the dialog is left to the browser', () => {
  const [a, b, c] = [{}, {}, {}];
  assert.equal(nextTabTarget({ shift: false, focusables: [a, b, c], active: a }), null);
  assert.equal(nextTabTarget({ shift: true, focusables: [a, b, c], active: c }), null);
});

test('if focus has already left the dialog, Tab brings it back in', () => {
  const [a, b] = [{}, {}];
  const outside = {};
  assert.equal(nextTabTarget({ shift: false, focusables: [a, b], active: outside }), a);
  assert.equal(nextTabTarget({ shift: true, focusables: [a, b], active: outside }), b);
});

test('no focusable elements: nothing to move to', () => {
  assert.equal(nextTabTarget({ shift: false, focusables: [], active: {} }), null);
});
