import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleReturnPath } from '../lib/googleReturn.js';

test('a connection started from Settings comes back to the app root, marked so Settings opens', () => {
  assert.equal(googleReturnPath({ fromSettings: true }), '/?google_connected=true');
});

test('a connection started anywhere else comes back to the app root', () => {
  assert.equal(googleReturnPath({ fromSettings: false }), '/?connected=true');
  assert.equal(googleReturnPath({}), '/?connected=true');
  assert.equal(googleReturnPath(), '/?connected=true');
});

test('the return path is never a page the deployed site does not serve (#421)', () => {
  for (const fromSettings of [true, false, undefined]) {
    const url = new URL(googleReturnPath({ fromSettings }), 'https://example.test');
    assert.equal(url.pathname, '/', 'the frontend only has a page at /');
  }
});
