import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preClassify, PRECLASSIFY_MAX_LENGTH } from '../lib/actions.js';

const intents = msg => preClassify(msg)?.actions.map(a => a.intent);

test('short commands are still recognised', () => {
  assert.deepEqual(intents('What do I have today?'), ['get_calendar', 'get_tasks']);
  assert.deepEqual(intents('check my inbox'), ['get_emails']);
  assert.equal(preClassify('tell me a joke'), null);
});

test('a command at the length limit is still recognised', () => {
  const msg = 'check my inbox' + ' '.repeat(PRECLASSIFY_MAX_LENGTH);
  assert.deepEqual(intents(msg), ['get_emails'], 'surrounding whitespace does not count');
  const padded = 'check my inbox ' + 'x'.repeat(PRECLASSIFY_MAX_LENGTH - 'check my inbox '.length);
  assert.deepEqual(intents(padded), ['get_emails']);
});

test('a longer message skips the shortcut and is left to the LLM classifier', () => {
  assert.equal(preClassify('check my inbox ' + 'x'.repeat(PRECLASSIFY_MAX_LENGTH)), null);
});

test('a huge message returns at once instead of backtracking', () => {
  for (const msg of ['what ' + 'meeting '.repeat(12_500), 'what ' + 's on '.repeat(20_000), 'any ' + 'new '.repeat(25_000)]) {
    const start = performance.now();
    assert.equal(preClassify(msg), null);
    assert.ok(performance.now() - start < 50);
  }
});
