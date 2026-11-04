import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithFallback, aiErrorStatus } from '../lib/aiFallback.js';

const quiet = { warn: () => {} };
const candidate = (provider, model) => ({ provider, model, make: () => ({ provider, model }) });
const gemini = candidate('gemini', 'gemini-2.0-flash');
const groq   = candidate('groq', 'llama-3.3-70b-versatile');

const GEMINI_GONE = Object.assign(new Error('[404 Not Found] models/gemini-2.0-flash is not found for API version v1beta'), { status: 404 });
const GROQ_GONE   = Object.assign(new Error('404 The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.'), { status: 404 });

test('the first provider answers and the second is never built', async () => {
  let builtGroq = false;
  const second = { ...groq, make: () => { builtGroq = true; return {}; } };
  const out = await runWithFallback([gemini, second], async (m) => ({ reply: `from ${m.provider}` }), quiet);
  assert.deepEqual(out, { reply: 'from gemini' });
  assert.equal(builtGroq, false);
});

test('a retired first model falls through to the second', async () => {
  const out = await runWithFallback([gemini, groq], async (m) => {
    if (m.provider === 'gemini') throw GEMINI_GONE;
    return { reply: 'from groq' };
  }, quiet);
  assert.deepEqual(out, { reply: 'from groq' });
});

test('when both models are retired the error names BOTH and the status is 503', async () => {
  await assert.rejects(
    () => runWithFallback([gemini, groq], async (m) => { throw m.provider === 'gemini' ? GEMINI_GONE : GROQ_GONE; }, quiet),
    err => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'AI_UNAVAILABLE');
      assert.match(err.message, /Gemini: the model "gemini-2\.0-flash" is no longer available/);
      assert.match(err.message, /Groq: the model "llama-3\.3-70b-versatile" is no longer available/);
      assert.match(err.message, /GEMINI_MODEL/);
      return true;
    },
  );
});

test('the first provider\'s failure is not hidden behind the second one\'s different error', async () => {
  await assert.rejects(
    () => runWithFallback([gemini, groq], async (m) => {
      if (m.provider === 'gemini') throw GEMINI_GONE;
      throw Object.assign(new Error('Rate limit reached'), { status: 429 });
    }, quiet),
    err => {
      assert.match(err.message, /Gemini: the model .* no longer available/);
      assert.match(err.message, /Groq: rate-limited/);
      return true;
    },
  );
});

test('a tool-format failure is retried on the same model before moving on', async () => {
  const calls = [];
  const out = await runWithFallback([groq], async (m) => {
    calls.push(m.provider);
    if (calls.length < 3) throw new Error('tool_use_failed: failed_generation');
    return { reply: 'third time lucky' };
  }, quiet);
  assert.deepEqual(out, { reply: 'third time lucky' });
  assert.equal(calls.length, 3);
});

test('when every provider hits only rate limits or tool errors, the earlier friendly messages are kept', async () => {
  await assert.rejects(
    () => runWithFallback([gemini, groq], async () => { throw Object.assign(new Error('quota exceeded'), { status: 429 }); }, quiet),
    err => { assert.match(err.message, /rate-limited\. Wait a minute/); assert.equal(err.status, 503); return true; },
  );
  await assert.rejects(
    () => runWithFallback([groq], async () => { throw new Error('tool_use_failed'); }, quiet),
    /call a tool correctly/,
  );
});

test('a retired model is tried once per provider, not retried like a tool error', async () => {
  let tries = 0;
  await assert.rejects(() => runWithFallback([gemini], async () => { tries += 1; throw GEMINI_GONE; }, quiet));
  assert.equal(tries, 1);
});

test('no candidates at all still gives a clear 503', async () => {
  await assert.rejects(() => runWithFallback([], async () => ({})), err => err.status === 503 && /unknown reason/.test(err.message));
});

test('only "no provider could answer" becomes a 503; a stray err.status never reaches the client', async () => {
  const exhausted = await runWithFallback([], async () => ({})).catch(e => e);
  assert.equal(aiErrorStatus(exhausted), 503);
  assert.equal(aiErrorStatus(Object.assign(new Error('x'), { status: 401 })), 500, 'a 401 would look like an expired token');
  assert.equal(aiErrorStatus(Object.assign(new Error('x'), { status: 404 })), 500);
  assert.equal(aiErrorStatus(new Error('plain')), 500);
  assert.equal(aiErrorStatus(null), 500);
});

// ─── A model that never answers must not hang the request (#409) ─────────────

import { timeoutsFromEnv, ATTEMPT_TIMEOUT_MS, TOTAL_TIMEOUT_MS, createProviderHealth, DEMOTE_FOR_MS } from '../lib/aiFallback.js';

const hangs = () => new Promise(() => {});                       // never settles
// A fresh health record per test: the shared one is per process and would carry one test's timeout into the next.
const fast = () => ({ ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health: createProviderHealth() });

test('a provider that never answers times out and the next one answers', async () => {
  const started = Date.now();
  const out = await runWithFallback([gemini, groq], async (m) => (m.provider === 'gemini' ? hangs() : { reply: 'from groq' }), fast());
  assert.deepEqual(out, { reply: 'from groq' });
  assert.ok(Date.now() - started < 300, 'did not wait for the hanging provider');
});

test('the hanging attempt is cancelled, not just ignored', async () => {
  let firstSignal;
  await runWithFallback([gemini, groq], async (m, _c, { signal }) => {
    if (m.provider === 'gemini') { firstSignal = signal; return hangs(); }
    return { reply: 'ok' };
  }, fast());
  assert.equal(firstSignal.aborted, true);
});

test('a provider that answers in time is given a live signal and nothing is left running', async () => {
  let signal;
  const out = await runWithFallback([gemini], async (m, _c, ctx) => { signal = ctx.signal; return { reply: 'quick' }; }, fast());
  assert.deepEqual(out, { reply: 'quick' });
  await new Promise(r => setTimeout(r, 80)); // longer than the attempt timeout
  assert.equal(signal.aborted, false, 'the timer was cleared once it answered');
});

test('when every provider hangs the request ends with a 503 that says the AI took too long', async () => {
  const started = Date.now();
  await assert.rejects(
    () => runWithFallback([gemini, groq], async () => hangs(), fast()),
    err => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'AI_UNAVAILABLE');
      assert.match(err.message, /took too long to answer/);
      assert.match(err.message, /turn Agent OFF/i);
      return true;
    },
  );
  assert.ok(Date.now() - started < 300, 'ended within the budget, not minutes later');
});

test('a mix of timeout and another failure names each provider\'s cause', async () => {
  await assert.rejects(
    () => runWithFallback([gemini, groq], async (m) => { if (m.provider === 'gemini') return hangs(); throw GROQ_GONE; }, fast()),
    err => {
      assert.match(err.message, /Gemini: did not answer in time/);
      assert.match(err.message, /Groq: the model "llama-3\.3-70b-versatile" is no longer available/);
      return true;
    },
  );
});

test('a timeout is not retried on the same model', async () => {
  let calls = 0;
  await assert.rejects(() => runWithFallback([gemini], async () => { calls += 1; return hangs(); }, fast()));
  assert.equal(calls, 1);
});

test('the overall limit stops the chain: once it is spent, later providers are not tried', async () => {
  let clock = 0;
  let builtSecond = false;
  const second = { ...groq, make: () => { builtSecond = true; return {}; } };
  await assert.rejects(
    () => runWithFallback([gemini, second], async () => { clock = 10_000; throw new Error('boom'); }, { ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 500, now: () => clock, health: createProviderHealth() }),
    err => err.code === 'AI_UNAVAILABLE',
  );
  assert.equal(builtSecond, false);
});

test('each attempt only gets what is left of the overall limit', async () => {
  let clock = 0;
  const started = Date.now();
  // First attempt "uses" 460 of the 500 ms; the second is capped to the remaining 40, not the 5000 it would get alone.
  await assert.rejects(() => runWithFallback([gemini, groq], async (m) => {
    if (m.provider === 'gemini') { clock = 460; throw new Error('slow failure'); }
    return hangs();
  }, { ...quiet, attemptTimeoutMs: 5000, totalTimeoutMs: 500, now: () => clock, health: createProviderHealth() }));
  assert.ok(Date.now() - started < 1000, 'the second attempt was cut off at the remaining budget');
});

test('timeoutsFromEnv uses the defaults, and accepts only positive whole milliseconds', () => {
  assert.deepEqual(timeoutsFromEnv({}), { attemptTimeoutMs: ATTEMPT_TIMEOUT_MS, totalTimeoutMs: TOTAL_TIMEOUT_MS });
  assert.deepEqual(timeoutsFromEnv({ AGENT_ATTEMPT_TIMEOUT_MS: '20000', AGENT_TOTAL_TIMEOUT_MS: '50000' }), { attemptTimeoutMs: 20000, totalTimeoutMs: 50000 });
  for (const bad of ['0', '-5', '1.5', 'abc', '']) {
    assert.deepEqual(timeoutsFromEnv({ AGENT_ATTEMPT_TIMEOUT_MS: bad }), { attemptTimeoutMs: ATTEMPT_TIMEOUT_MS, totalTimeoutMs: TOTAL_TIMEOUT_MS }, bad);
  }
});

test('the defaults leave room for a fallback: one attempt is shorter than the whole', () => {
  assert.ok(ATTEMPT_TIMEOUT_MS < TOTAL_TIMEOUT_MS);
  assert.ok(TOTAL_TIMEOUT_MS < 120_000, 'under the client backstop');
});

// ─── A provider that went quiet is tried last for a while (#415) ─────────────

const withKey = (c, healthKey) => ({ ...c, healthKey });
const opts = health => ({ ...quiet, attemptTimeoutMs: 40, totalTimeoutMs: 400, health });

test('after one timeout the next reply tries the working provider first and is not slowed again', async () => {
  const health = createProviderHealth();
  const attempt = async (m) => { if (m.provider === 'gemini') return hangs(); return { reply: 'from groq' }; };

  const first = Date.now();
  await runWithFallback([gemini, groq], attempt, opts(health));
  assert.ok(Date.now() - first >= 35, 'the first reply waited out Gemini\'s timeout');

  const tried = [];
  const second = Date.now();
  const out = await runWithFallback([gemini, groq], async (m) => { tried.push(m.provider); return attempt(m); }, opts(health));
  assert.deepEqual(out, { reply: 'from groq' });
  assert.deepEqual(tried, ['groq'], 'Gemini was not even tried');
  assert.ok(Date.now() - second < 30, 'answered straight away');
});

test('a demoted provider is still used when the others fail, and one success clears the demotion', async () => {
  const health = createProviderHealth();
  health.recordTimeout('gemini', Date.now());
  const tried = [];
  const out = await runWithFallback([gemini, groq], async (m) => {
    tried.push(m.provider);
    if (m.provider === 'groq') throw GROQ_GONE;
    return { reply: 'from gemini' };
  }, opts(health));
  assert.deepEqual(out, { reply: 'from gemini' });
  assert.deepEqual(tried, ['groq', 'gemini'], 'tried last, not dropped');

  const again = [];
  await runWithFallback([gemini, groq], async (m) => { again.push(m.provider); return { reply: 'ok' }; }, opts(health));
  assert.deepEqual(again, ['gemini'], 'back to the normal order after it answered');
});

test('the demotion ends after the cooldown', () => {
  const health = createProviderHealth({ demoteForMs: 1000 });
  health.recordTimeout('gemini', 5000);
  assert.deepEqual(health.order([gemini, groq], 5500).map(c => c.provider), ['groq', 'gemini']);
  assert.deepEqual(health.order([gemini, groq], 6000).map(c => c.provider), ['gemini', 'groq'], 'exactly at the cooldown');
  assert.equal(health.size(), 0, 'the old entry is forgotten');
});

test('another user\'s dead key does not demote this user\'s provider', () => {
  const health = createProviderHealth();
  const mine   = withKey(gemini, '1:gemini:m');
  const theirs = withKey(gemini, '2:gemini:m');
  health.recordTimeout('2:gemini:m', 1000);
  assert.deepEqual(health.order([theirs, groq], 1001).map(c => c.provider), ['groq', 'gemini']);
  assert.deepEqual(health.order([mine, groq], 1001).map(c => c.provider), ['gemini', 'groq']);
});

test('only a timeout demotes: quota, a retired model or a tool error do not', async () => {
  const health = createProviderHealth();
  for (const err of [GEMINI_GONE, new Error('429 quota exceeded'), new Error('tool_use_failed')]) {
    await runWithFallback([gemini, groq], async (m) => { if (m.provider === 'gemini') throw err; return { reply: 'ok' }; }, opts(health));
  }
  assert.equal(health.size(), 0);
});

test('the default health record is shared by every call in the process', async () => {
  const { providerHealth } = await import('../lib/aiFallback.js');
  assert.equal(typeof providerHealth.order, 'function');
  assert.ok(DEMOTE_FOR_MS >= 60_000, 'long enough to matter, short enough to recover');
});
