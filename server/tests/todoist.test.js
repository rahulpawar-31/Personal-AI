import { test } from 'node:test';
import assert from 'node:assert/strict';
import todoist from '../services/todoist.js';
import { describeSourceError } from '../lib/sourceErrors.js';

const creds = { TODOIST_API_KEY: 'td_stub' };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  const realError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => { calls.push(String(url)); return handler(String(url)); };
  try { return await fn(calls); } finally { globalThis.fetch = real; console.error = realError; }
}

test('completed tasks use the v1 path with both since and until (the old path was read as a task id)', async () => {
  await withFetch(() => json({ items: [{ id: 'a1', content: 'Ship it', completed_at: '2026-10-14T10:00:00Z' }] }), async calls => {
    const out = await todoist.getRecentlyCompleted(creds, 30);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Ship it');
    assert.equal(out[0].status, 'Done');
    const url = new URL(calls[0]);
    assert.equal(url.pathname, '/api/v1/tasks/completed/by_completion_date');
    assert.ok(url.searchParams.get('since'), 'since is sent');
    assert.ok(url.searchParams.get('until'), 'until is sent');
    assert.ok(Date.parse(url.searchParams.get('until')) > Date.parse(url.searchParams.get('since')));
    assert.equal(url.searchParams.get('limit'), '200', 'asks for the largest page, as the old call did');
    assert.ok(!calls[0].includes('completed_by_completion_date'), 'the broken path is gone');
  });
});

test('the window never exceeds the API limit of about three months', async () => {
  await withFetch(() => json({ items: [] }), async calls => {
    await todoist.getRecentlyCompleted(creds, 400);
    const url = new URL(calls[0]);
    const days = (Date.parse(url.searchParams.get('until')) - Date.parse(url.searchParams.get('since'))) / 86400000;
    assert.ok(days <= 85.01, `asked for ${days} days`);
  });
});

test('completed tasks follow the cursor across pages, and stop when there is none', async () => {
  await withFetch(url => {
    const cursor = new URL(url).searchParams.get('cursor');
    if (!cursor) return json({ items: [{ id: '1', content: 'one' }], next_cursor: 'c2' });
    if (cursor === 'c2') return json({ items: [{ id: '2', content: 'two' }], next_cursor: null });
    return json({ items: [] });
  }, async calls => {
    const out = await todoist.getRecentlyCompleted(creds);
    assert.deepEqual(out.map(t => t.title), ['one', 'two']);
    assert.equal(calls.length, 2);
  });
});

test('paging is capped so a huge history cannot loop for long', async () => {
  await withFetch(() => json({ items: [{ id: 'x', content: 'x' }], next_cursor: 'again' }), async calls => {
    await todoist.getRecentlyCompleted(creds);
    assert.equal(calls.length, 3);
  });
});

test('a failure is swallowed by default but thrown when the caller asks', async () => {
  await withFetch(() => json({ error: 'bad' }, 400), async () => {
    assert.deepEqual(await todoist.getRecentlyCompleted(creds), []);
    await assert.rejects(() => todoist.getRecentlyCompleted(creds, 30, { throwOnError: true }), /Todoist 400/);
    assert.deepEqual(await todoist.getTasks('today', creds), []);
    await assert.rejects(() => todoist.getTasks('today', creds, { throwOnError: true }), /Todoist 400/);
  });
});

test('active tasks try the v1 filter endpoint first and fall back to the older form', async () => {
  await withFetch(url => (url.includes('/tasks/filter') ? json({}, 404) : json({ results: [{ id: 't', content: 'old-style', priority: 4 }] })), async calls => {
    const out = await todoist.getTasks('today | overdue', creds);
    assert.equal(out[0].title, 'old-style');
    assert.ok(calls[0].includes('/tasks/filter?query='));
    assert.ok(calls[1].includes('/tasks?filter='));
  });
  await withFetch(() => json({ results: [{ id: 't', content: 'filtered' }] }), async calls => {
    assert.equal((await todoist.getTasks('today', creds))[0].title, 'filtered');
    assert.equal(calls.length, 1, 'no fallback when the first call works');
  });
});

test('nothing is called when Todoist is not configured', async () => {
  await withFetch(() => json({}), async calls => {
    assert.deepEqual(await todoist.getTasks('today', {}), []);
    assert.deepEqual(await todoist.getRecentlyCompleted({}), []);
    assert.equal(calls.length, 0);
  });
});

test('source errors become plain sentences without echoing long provider text', () => {
  assert.match(describeSourceError('notion', { code: 'object_not_found', message: 'Could not find database with ID: abc' }), /share it with the DevOS integration/);
  assert.match(describeSourceError('notion', { code: 'unauthorized', message: 'API token is invalid.' }), /rejected the API key/);
  assert.match(describeSourceError('todoist', new Error('Todoist 403: Forbidden')), /rejected the API key/);
  const long = describeSourceError('todoist', new Error('Todoist 400: ' + 'x'.repeat(500)));
  assert.ok(long.length < 200);
  assert.match(describeSourceError('todoist', new Error('Todoist 500: boom')), /Todoist tasks failed to load: Todoist 500: boom/);
});
