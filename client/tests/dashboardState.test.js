import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsYouState } from '../src/dashboardState.js';

const CLEAR_WORDS = /nothing needs you|a clear day|nothing here/i;

test('a checked account with an empty queue is the only one told it is clear', () => {
  const s = needsYouState({ workConnected: 2, digestStatus: 'ready' });
  assert.equal(s.kind, 'clear');
  assert.match(s.summary, /Nothing needs you right now/);
  assert.match(s.detail, /clear day/);
  assert.equal(s.action, null);
});

test('no work service connected and no digest: setup, with Open Settings (the #426 case)', () => {
  const s = needsYouState({ workConnected: 0, digestStatus: 'none' });
  assert.equal(s.kind, 'setup');
  assert.deepEqual(s.action, { id: 'settings', label: 'Open Settings' });
  assert.doesNotMatch(s.summary + s.detail, CLEAR_WORDS);
});

test('connected but never scanned: prompts the first scan with Run digest', () => {
  const s = needsYouState({ workConnected: 1, digestStatus: 'none' });
  assert.equal(s.kind, 'noScan');
  assert.deepEqual(s.action, { id: 'run', label: 'Run digest' });
  assert.doesNotMatch(s.summary + s.detail, CLEAR_WORDS);
});

test('while the first load is still out, nothing is claimed either way', () => {
  const s = needsYouState({ workConnected: 3, digestStatus: 'loading' });
  assert.equal(s.kind, 'loading');
  assert.doesNotMatch(s.summary + s.detail, CLEAR_WORDS);
  assert.equal(s.action, null);
});

test('a digest that could not be loaded, or a scan that failed, offers Retry and implies no clear queue', () => {
  for (const input of [{ workConnected: 2, digestStatus: 'error' }, { workConnected: 2, digestStatus: 'ready', runFailed: true }]) {
    const s = needsYouState(input);
    assert.equal(s.kind, 'error');
    assert.deepEqual(s.action, { id: 'retry', label: 'Retry' });
    assert.doesNotMatch(s.summary + s.detail, CLEAR_WORDS);
  }
});

test('a scan in progress says so and shows no buttons', () => {
  const s = needsYouState({ workConnected: 2, digestStatus: 'none', running: true });
  assert.equal(s.kind, 'scanning');
  assert.doesNotMatch(s.summary, CLEAR_WORDS);
  assert.equal(s.action, null);
});

test('items in the queue win over every empty-state message, with the right noun', () => {
  assert.equal(needsYouState({ workConnected: 0, digestStatus: 'error', queueLength: 1 }).summary, '1 thing needs you today.');
  assert.equal(needsYouState({ workConnected: 2, digestStatus: 'ready', queueLength: 3 }).summary, '3 things need you today.');
  assert.equal(needsYouState({ queueLength: 2 }).kind, 'items');
});

test('the default is the loading state, never a clear queue', () => {
  assert.equal(needsYouState().kind, 'loading');
  assert.equal(needsYouState({}).kind, 'loading');
});

test('"clear" only ever comes from a digest that exists and did not fail', () => {
  for (const digestStatus of ['loading', 'none', 'error']) {
    for (const workConnected of [0, 1, 5]) {
      assert.notEqual(needsYouState({ workConnected, digestStatus }).kind, 'clear', `${digestStatus}/${workConnected}`);
    }
  }
  assert.notEqual(needsYouState({ workConnected: 2, digestStatus: 'ready', runFailed: true }).kind, 'clear');
});
