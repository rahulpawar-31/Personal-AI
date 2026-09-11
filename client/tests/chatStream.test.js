import { test } from 'node:test';
import assert from 'node:assert/strict';

// apiFetch (called internally by streamChat) reads the auth token via the
// browser localStorage API. Node's global `localStorage` object exists but
// isn't backed by a working store outside a browser/jsdom context, so shim a
// minimal in-memory one before importing anything that touches it.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const { streamChat } = await import('../src/lib/chatStream.js');

function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

async function collect(payload) {
  const events = [];
  for await (const event of streamChat(payload)) events.push(event);
  return events;
}

test('yields parsed status/token/done events in order', async (t) => {
  const body =
    `data: ${JSON.stringify({ type: 'status', text: 'Thinking…' })}\n\n` +
    `data: ${JSON.stringify({ type: 'token', text: 'Hel' })}\n\n` +
    `data: ${JSON.stringify({ type: 'token', text: 'lo' })}\n\n` +
    `data: ${JSON.stringify({ type: 'done', reply: 'Hello', intents: [] })}\n\n`;

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => sseResponse([body]);

  assert.deepEqual(await collect({ message: 'hi', history: [] }), [
    { type: 'status', text: 'Thinking…' },
    { type: 'token', text: 'Hel' },
    { type: 'token', text: 'lo' },
    { type: 'done', reply: 'Hello', intents: [] },
  ]);
});

test('reassembles a JSON event line split across two stream chunks', async (t) => {
  const full = `data: ${JSON.stringify({ type: 'token', text: 'split-across-chunks' })}\n\n`;
  const mid = Math.floor(full.length / 2);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => sseResponse([full.slice(0, mid), full.slice(mid)]);

  assert.deepEqual(await collect({ message: 'x', history: [] }), [
    { type: 'token', text: 'split-across-chunks' },
  ]);
});

test('throws with the server-provided error message on a non-ok response', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'boom' }), { status: 500 });

  await assert.rejects(() => collect({ message: 'x', history: [] }), /boom/);
});

test('skips malformed non-JSON data lines instead of throwing', async (t) => {
  const body = `data: not json\n\n` + `data: ${JSON.stringify({ type: 'done', reply: 'ok' })}\n\n`;

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => sseResponse([body]);

  assert.deepEqual(await collect({ message: 'x', history: [] }), [
    { type: 'done', reply: 'ok' },
  ]);
});
