import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWithFallback } from '../lib/aiFallback.js';

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
