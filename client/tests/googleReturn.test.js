import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleReturn } from '../src/googleReturn.js';

test('?google_connected=true is a connection from Settings (and only that)', () => {
  assert.deepEqual(parseGoogleReturn('?google_connected=true'), { connected: true, fromSettings: true });
});

test('?connected=true is a connection that did not start in Settings', () => {
  assert.deepEqual(parseGoogleReturn('?connected=true'), { connected: true, fromSettings: false });
});

test('anything else is not a Google return, including look-alikes', () => {
  for (const s of ['', '?', '?connected=false', '?google_connected=false', '?connected=truex', '?xconnected=true', '?auth_error=google_failed', '?foo=google_connected=true']) {
    assert.deepEqual(parseGoogleReturn(s), { connected: false, fromSettings: false }, s);
  }
});

test('other parameters beside it do not matter', () => {
  assert.deepEqual(parseGoogleReturn('?x=1&google_connected=true&y=2'), { connected: true, fromSettings: true });
});
