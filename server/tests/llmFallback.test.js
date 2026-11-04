import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'llm-fallback-test-secret-32-characters-ok';

const llm = (await import('../services/llm.js')).default;
const { createProviderHealth, streamWithFallback, runWithFallback, emptyReplyError } = await import('../lib/aiFallback.js');
const { friendlyAiError, describeAiFailure } = await import('../lib/models.js');

// Fake providers. `invoke` is what a chat model does for call(); `stream` for streamTokens().
const hangs = () => new Promise(() => {});
const quiet = { warn: () => {} };
const reply = content => ({ invoke: async () => ({ content }) });
const candidate = (provider, model) => ({ provider, model, make: () => model });
const gem  = (m)  => ({ provider: 'gemini', model: 'g', healthKey: `llm:gemini:${Math.random()}`, make: () => m });
const groq = (m)  => ({ provider: 'groq',   model: 'q', healthKey: `llm:groq:${Math.random()}`,   make: () => m });
const fb = () => ({ ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health: createProviderHealth() });
const msgs = [{ role: 'user', content: 'hi' }];

// ─── call() ───────────────────────────────────────────────────────────────────

test('call returns the first provider\'s answer and never touches the second', async () => {
  let secondUsed = false;
  const out = await llm.call(msgs, {
    candidates: [gem(reply('first')), groq({ invoke: async () => { secondUsed = true; return { content: 'second' }; } })],
    fallback: fb(),
  });
  assert.equal(out, 'first');
  assert.equal(secondUsed, false);
});

test('a provider that never answers is cut off and the next one answers, in bounded time', async () => {
  const started = Date.now();
  const out = await llm.call(msgs, { candidates: [gem({ invoke: hangs }), groq(reply('from groq'))], fallback: fb() });
  assert.equal(out, 'from groq');
  assert.ok(Date.now() - started < 300);
});

test('the hung call is cancelled through its abort signal', async () => {
  let signal;
  await llm.call(msgs, { candidates: [gem({ invoke: (_m, cfg) => { signal = cfg.signal; return hangs(); } }), groq(reply('ok'))], fallback: fb() });
  assert.equal(signal.aborted, true);
});

test('an empty reply goes to the next provider instead of being returned (the #417 case)', async () => {
  for (const empty of ['', '   \n', []]) {
    const out = await llm.call(msgs, { candidates: [gem(reply(empty)), groq(reply('real answer'))], fallback: fb() });
    assert.equal(out, 'real answer', JSON.stringify(empty));
  }
});

test('an empty reply with json: true no longer fails as "invalid JSON in response: "', async () => {
  const out = await llm.call(msgs, { json: true, candidates: [gem(reply('')), groq(reply('{"ok": true}'))], fallback: fb() });
  assert.deepEqual(out, { ok: true });
});

test('a reply that is not valid JSON also falls through to the next provider', async () => {
  const out = await llm.call(msgs, { json: true, candidates: [gem(reply('here you go: nope')), groq(reply('```json\n{"n": 1}\n```'))], fallback: fb() });
  assert.deepEqual(out, { n: 1 });
});

test('when every provider is empty the error says so, in words, with a 503', async () => {
  await assert.rejects(
    () => llm.call(msgs, { json: true, candidates: [gem(reply('')), groq(reply(''))], fallback: fb() }),
    err => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'AI_UNAVAILABLE');
      assert.match(err.message, /empty reply/);
      assert.doesNotMatch(err.message, /invalid JSON/);
      return true;
    },
  );
});

test('when every provider hangs the call ends with the took-too-long message', async () => {
  const started = Date.now();
  await assert.rejects(
    () => llm.call(msgs, { candidates: [gem({ invoke: hangs }), groq({ invoke: hangs })], fallback: fb() }),
    err => /took too long/.test(err.message),
  );
  assert.ok(Date.now() - started < 300);
});

test('a mix names each provider\'s cause', async () => {
  await assert.rejects(
    () => llm.call(msgs, { candidates: [gem({ invoke: hangs }), groq(reply(''))], fallback: fb() }),
    err => /Gemini: did not answer in time/.test(err.message) && /Groq: returned an empty reply/.test(err.message),
  );
});

test('a provider that went quiet is tried last on the next call, so it is not waited on again', async () => {
  const health = createProviderHealth();
  const slow = gem({ invoke: hangs });
  const ok   = groq(reply('quick'));
  await llm.call(msgs, { candidates: [slow, ok], fallback: { ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health } });
  const started = Date.now();
  assert.equal(await llm.call(msgs, { candidates: [slow, ok], fallback: { ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health } }), 'quick');
  assert.ok(Date.now() - started < 25, 'went straight to the working provider');
});

test('with no API key configured it still throws MISSING_API_KEY', async () => {
  const saved = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY };
  delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
  try {
    await assert.rejects(() => llm.call(msgs, { taskType: 'content' }), err => err.code === 'MISSING_API_KEY');
  } finally {
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    if (saved.q !== undefined) process.env.GROQ_API_KEY = saved.q;
  }
});

// ─── streamTokens() ───────────────────────────────────────────────────────────

const streamOf = (...chunks) => ({ stream: async () => (async function* () { for (const c of chunks) yield { content: c }; })() });
const collect = async iter => { const out = []; for await (const t of iter) out.push(t); return out; };

test('streamTokens yields the first provider\'s tokens in order', async () => {
  const out = await collect(llm.streamTokens(msgs, { candidates: [gem(streamOf('a', 'b', 'c')), groq(streamOf('x'))], fallback: fb() }));
  assert.deepEqual(out, ['a', 'b', 'c']);
});

test('a stream whose first token never comes is replaced by the next provider', async () => {
  const stuck = { stream: async () => (async function* () { await hangs(); })() };
  const started = Date.now();
  const out = await collect(llm.streamTokens(msgs, { candidates: [gem(stuck), groq(streamOf('hello'))], fallback: fb() }));
  assert.deepEqual(out, ['hello']);
  assert.ok(Date.now() - started < 300);
});

test('a stream that ends with no text, or fails before sending any, is replaced by the next provider', async () => {
  const empty  = streamOf();
  const broken = { stream: async () => { throw new Error('503 overloaded'); } };
  assert.deepEqual(await collect(llm.streamTokens(msgs, { candidates: [gem(empty), groq(streamOf('ok'))], fallback: fb() })), ['ok']);
  assert.deepEqual(await collect(llm.streamTokens(msgs, { candidates: [gem(broken), groq(streamOf('ok'))], fallback: fb() })), ['ok']);
});

test('once tokens have been sent a later failure is thrown, not retried on another provider', async () => {
  const dies = { stream: async () => (async function* () { yield { content: 'par' }; throw new Error('connection reset'); })() };
  const got = [];
  await assert.rejects(async () => {
    for await (const t of llm.streamTokens(msgs, { candidates: [gem(dies), groq(streamOf('SHOULD NOT APPEAR'))], fallback: fb() })) got.push(t);
  }, /connection reset/);
  assert.deepEqual(got, ['par']);
});

test('a stream that goes quiet part-way ends with a timeout instead of hanging', async () => {
  const stalls = { stream: async () => (async function* () { yield { content: 'a' }; await hangs(); })() };
  const got = [];
  const started = Date.now();
  await assert.rejects(async () => {
    for await (const t of llm.streamTokens(msgs, { candidates: [gem(stalls)], fallback: fb() })) got.push(t);
  }, err => err.code === 'AI_TIMEOUT');
  assert.deepEqual(got, ['a']);
  assert.ok(Date.now() - started < 300);
});

test('when every stream fails the error is the 503 that names each provider', async () => {
  await assert.rejects(
    () => collect(llm.streamTokens(msgs, { candidates: [gem(streamOf()), groq({ stream: async () => { throw new Error('boom'); } })], fallback: fb() })),
    err => err.code === 'AI_UNAVAILABLE' && /Gemini: returned an empty reply/.test(err.message) && /Groq: boom/.test(err.message),
  );
});

test('a timed-out stream demotes its provider for the next call', async () => {
  const health = createProviderHealth();
  const stuck = gem({ stream: async () => (async function* () { await hangs(); })() });
  const ok = groq(streamOf('fast'));
  const opts = { ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health };
  await collect(llm.streamTokens(msgs, { candidates: [stuck, ok], fallback: opts }));
  const started = Date.now();
  assert.deepEqual(await collect(llm.streamTokens(msgs, { candidates: [stuck, ok], fallback: opts })), ['fast']);
  assert.ok(Date.now() - started < 25);
});

// ─── The messages the user sees ───────────────────────────────────────────────

test('friendlyAiError passes the composed "no provider could answer" message through unchanged', () => {
  const err = Object.assign(new Error(describeAiFailure([{ provider: 'gemini', model: 'g', message: 'x', code: 'AI_TIMEOUT' }, { provider: 'groq', model: 'q', message: 'y', code: 'AI_EMPTY' }])), { code: 'AI_UNAVAILABLE' });
  assert.equal(friendlyAiError(err), err.message);
  assert.match(err.message, /Gemini: did not answer in time; Groq: returned an empty reply/);
});

test('a single timeout or empty reply gets a plain sentence', () => {
  assert.match(friendlyAiError(Object.assign(new Error('no answer within 40s'), { code: 'AI_TIMEOUT' })), /took too long/);
  assert.match(friendlyAiError(emptyReplyError()), /empty reply/);
});

test('runWithFallback treats an empty-reply error like any other failed attempt', async () => {
  const out = await runWithFallback([candidate('gemini', 'g'), candidate('groq', 'q')], async (m) => { if (m === 'g') throw emptyReplyError(); return 'ok'; }, fb());
  assert.equal(out, 'ok');
});

test('streamWithFallback is usable directly: it stops once the overall limit is spent', async () => {
  let clock = 0;
  let builtSecond = false;
  const first = { provider: 'gemini', model: 'g', make: () => 'g' };
  const second = { provider: 'groq', model: 'q', make: () => { builtSecond = true; return 'q'; } };
  await assert.rejects(async () => {
    for await (const _ of streamWithFallback([first, second], async function* () { clock = 10_000; throw new Error('boom'); }, { ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 500, now: () => clock, health: createProviderHealth() })) { /* none */ }
  }, err => err.code === 'AI_UNAVAILABLE');
  assert.equal(builtSecond, false);
});
