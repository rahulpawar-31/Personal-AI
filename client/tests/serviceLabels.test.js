import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceLabel, serviceLabels, groupKeysByService } from '../src/serviceLabels.js';

test('known service ids get their proper names', () => {
  assert.equal(serviceLabel('github'), 'GitHub');
  assert.equal(serviceLabel('linkedin'), 'LinkedIn');
  assert.deepEqual(serviceLabels(['gemini', 'todoist']), ['Gemini', 'Todoist']);
});

test('an unknown id is shown as stored, and bad input gives nothing', () => {
  assert.equal(serviceLabel('newthing'), 'newthing');
  assert.deepEqual(serviceLabels(undefined), []);
  assert.deepEqual(serviceLabels(null), []);
});


test('key rows are grouped under their service with a friendly label', () => {
  const rows = [
    { service: 'github', keyName: 'GITHUB_REPO' },
    { service: 'github', keyName: 'GITHUB_TOKEN' },
    { service: 'gemini', keyName: 'GEMINI_API_KEY' },
  ];
  const groups = groupKeysByService(rows);
  assert.deepEqual(groups.map(g => [g.label, g.keys.length]), [['GitHub', 2], ['Gemini', 1]]);
  assert.deepEqual(groupKeysByService(undefined), []);
});
