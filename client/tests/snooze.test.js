import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemKeys, applySnoozes, returnLabel } from '../src/snooze.js';

const T = iso => Date.parse(iso);
const NOW = T('2026-10-28T10:00:00Z');

test('each kind of item gets a stable key built from its own id', () => {
  assert.equal(itemKeys.mail({ id: 'abc' }), 'mail:gmail:abc');
  assert.equal(itemKeys.pr({ id: 7, repo: 'me/app' }), 'code:github:me/app#7');
  assert.equal(itemKeys.blocker({ id: 7, source: 'github' }), 'blocker:github:7');
  assert.equal(itemKeys.task({ id: 't1', source: 'todoist' }), 'task:todoist:t1');
  assert.equal(itemKeys.conflict({ eventA: { id: 'a' }, eventB: { id: 'b' } }), 'cal:a|b');
});

test('an item with no id has no key, so it cannot be snoozed', () => {
  assert.equal(itemKeys.mail({}), null);
  assert.equal(itemKeys.mail(undefined), null);
  assert.equal(itemKeys.pr({ repo: 'x' }), null);
  assert.equal(itemKeys.conflict({ eventA: { id: 'a' }, eventB: {} }), null);
});

test('the same item gets the same key on every load', () => {
  const load = () => itemKeys.pr({ id: 12, repo: 'me/app', title: 'changes between loads' });
  assert.equal(load(), load());
});

const queue = [
  { key: 'a', title: 'A' },
  { key: 'b', title: 'B' },
  { key: 'c', title: 'C' },
  { key: null, title: 'no key' },
];

test('with no snoozes, everything shows in the original order', () => {
  const { list, waiting } = applySnoozes(queue, [], NOW);
  assert.deepEqual(list.map(i => i.title), ['A', 'B', 'C', 'no key']);
  assert.deepEqual(waiting, []);
});

test('an item snoozed until later is hidden and listed as waiting', () => {
  const snoozes = [{ key: 'b', until: '2026-10-28T14:00:00Z', title: 'B' }];
  const { list, waiting } = applySnoozes(queue, snoozes, NOW);
  assert.deepEqual(list.map(i => i.title), ['A', 'C', 'no key']);
  assert.deepEqual(waiting.map(w => w.key), ['b']);
});

test('an item whose snooze has ended comes back at the top, marked', () => {
  const snoozes = [{ key: 'c', until: '2026-10-28T09:00:00Z', title: 'C' }];
  const { list, waiting } = applySnoozes(queue, snoozes, NOW);
  assert.deepEqual(list.map(i => i.title), ['C', 'A', 'B', 'no key']);
  assert.equal(list[0].backFromSnooze, true);
  assert.equal(list[1].backFromSnooze, undefined);
  assert.deepEqual(waiting, []);
});

test('the return moment itself counts as back', () => {
  const snoozes = [{ key: 'a', until: '2026-10-28T10:00:00Z', title: 'A' }];
  assert.equal(applySnoozes(queue, snoozes, NOW).list[0].backFromSnooze, true);
});

test('a snoozed item that is not in the queue right now still shows in the waiting list', () => {
  const snoozes = [{ key: 'gone', until: '2026-10-29T09:00:00Z', title: 'Old invoice' }];
  const { list, waiting } = applySnoozes(queue, snoozes, NOW);
  assert.equal(list.length, 4);
  assert.deepEqual(waiting.map(w => w.title), ['Old invoice']);
});

test('the waiting list is ordered by return time', () => {
  const snoozes = [
    { key: 'a', until: '2026-10-30T09:00:00Z', title: 'A' },
    { key: 'b', until: '2026-10-28T16:00:00Z', title: 'B' },
  ];
  assert.deepEqual(applySnoozes(queue, snoozes, NOW).waiting.map(w => w.key), ['b', 'a']);
});

test('an item with no key is never hidden, even if a snooze has a blank key', () => {
  const snoozes = [{ key: '', until: '2026-10-29T09:00:00Z', title: '' }];
  assert.equal(applySnoozes(queue, snoozes, NOW).list.length, 4);
});

test('return labels say today, tomorrow, or the date', () => {
  const now = new Date(2026, 9, 28, 10, 0).getTime(); // local 28 Oct 10:00
  assert.equal(returnLabel(new Date(2026, 9, 28, 16, 0).toISOString(), now), 'today 16:00');
  assert.equal(returnLabel(new Date(2026, 9, 29, 9, 0).toISOString(), now), 'tomorrow 09:00');
  assert.match(returnLabel(new Date(2026, 9, 31, 15, 0).toISOString(), now), /Sat 31 Oct, 15:00/);
});
