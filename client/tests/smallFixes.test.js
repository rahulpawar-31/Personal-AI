import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDateTimeLocal, nextHourLocal, localToInstantISO } from '../src/dateInput.js';
import { setupLinkLabel } from '../src/components/settings/setupLabel.js';
import { newTaskErrors } from '../src/taskErrors.js';

function inZone(tz, fn) {
  const saved = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
}

test('the new-event default is local time, not UTC (it showed 7:30 AM at 1 PM in India)', () => {
  // 07:30 UTC is 13:00 in India (UTC+5:30), so the next full hour is 14:00 local.
  const now = new Date('2026-10-15T07:30:00Z');
  assert.equal(inZone('Asia/Kolkata', () => nextHourLocal(now)), '2026-10-15T14:00');
  assert.equal(inZone('America/Los_Angeles', () => nextHourLocal(now)), '2026-10-15T01:00');
  assert.equal(inZone('UTC', () => nextHourLocal(now)), '2026-10-15T08:00');
});

test('the next hour rolls over midnight and month end correctly', () => {
  assert.equal(inZone('UTC', () => nextHourLocal(new Date('2026-10-31T23:20:00Z'))), '2026-11-01T00:00');
  assert.equal(inZone('Asia/Kolkata', () => nextHourLocal(new Date('2026-10-15T18:40:00Z'))), '2026-10-16T01:00');
});

test('toDateTimeLocal pads single digits and uses local fields', () => {
  assert.equal(inZone('UTC', () => toDateTimeLocal(new Date('2026-03-05T04:07:00Z'))), '2026-03-05T04:07');
});

test('the setup link does not repeat the service name', () => {
  assert.equal(setupLinkLabel('Trello', 'Trello API Key'), 'Trello API Key Setup');
  assert.equal(setupLinkLabel('Notion', 'Integration Token'), 'Notion Integration Token Setup');
  assert.equal(setupLinkLabel('GitHub', 'GitHub Token'), 'GitHub Token Setup');
  assert.equal(setupLinkLabel('Slack', undefined), 'Slack Credentials Setup');
  assert.equal(setupLinkLabel('trello', 'Trello API Key'), 'Trello API Key Setup', 'case does not matter');
});

test('a failing task source is reported once, then not again', () => {
  const seen = new Set();
  assert.deepEqual(newTaskErrors({ notion: 'Notion is down' }, seen), ['Notion is down']);
  assert.deepEqual(newTaskErrors({ notion: 'Notion is down' }, seen), [], 'same message, already shown');
  assert.deepEqual(newTaskErrors({ notion: 'Notion is down', todoist: 'Todoist is down' }, seen), ['Todoist is down']);
  assert.deepEqual(newTaskErrors({ notion: 'Notion key rejected' }, seen), ['Notion key rejected'], 'a different message is new');
});

test('no errors, or odd values, produce nothing', () => {
  const seen = new Set();
  for (const e of [undefined, null, {}, { a: '' }, { a: 42 }, { a: null }]) assert.deepEqual(newTaskErrors(e, seen), []);
});

test('an event time is sent as an absolute instant, so a UTC server cannot shift it', () => {
  // 14:00 on the user's clock is 08:30 UTC in India but 21:00 UTC in Los Angeles.
  assert.equal(inZone('Asia/Kolkata', () => localToInstantISO('2026-10-15T14:00')), '2026-10-15T08:30:00.000Z');
  assert.equal(inZone('America/Los_Angeles', () => localToInstantISO('2026-10-15T14:00')), '2026-10-15T21:00:00.000Z');
  assert.equal(inZone('UTC', () => localToInstantISO('2026-10-15T14:00')), '2026-10-15T14:00:00.000Z');
});

test('the default shown in the form round-trips to the right instant', () => {
  const now = new Date('2026-10-15T07:30:00Z'); // 13:00 in India
  const shown = inZone('Asia/Kolkata', () => nextHourLocal(now));
  assert.equal(shown, '2026-10-15T14:00');
  assert.equal(inZone('Asia/Kolkata', () => localToInstantISO(shown)), '2026-10-15T08:30:00.000Z');
});

test('an unparseable value is passed through unchanged', () => {
  assert.equal(localToInstantISO('not a date'), 'not a date');
});
