import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_DEFAULTS, modelId, classifyAiFailure, isModelUnavailableError, describeAiFailure, friendlyAiError,
} from '../lib/models.js';

// Messages shaped like what each provider returns for a retired model.
const GROQ_GONE   = { message: '404 The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.', status: 404 };
const GROQ_GONE_2 = { message: '404 {"error":{"message":"The model `llama-3.1-8b-instant` has been decommissioned","code":"model_not_found"}}' };
const GEMINI_GONE = { message: '[404 Not Found] models/gemini-2.0-flash is not found for API version v1beta, or is not supported for generateContent.', status: 404 };

test('defaults are the replacements the providers name', () => {
  assert.equal(modelId('gemini', {}), 'gemini-3.8-flash');
  assert.equal(modelId('groq', {}), 'openai/gpt-oss-120b');
  assert.equal(modelId('groqFast', {}), 'openai/gpt-oss-20b');
  for (const retired of ['gemini-2.0-flash', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
    assert.ok(!Object.values(MODEL_DEFAULTS).includes(retired), `${retired} must not be a default`);
  }
});

test('an environment variable overrides a model, and blank values are ignored', () => {
  assert.equal(modelId('gemini', { GEMINI_MODEL: 'gemini-3.6-flash' }), 'gemini-3.6-flash');
  assert.equal(modelId('groq', { GROQ_MODEL: '  qwen/qwen3.8-27b ' }), 'qwen/qwen3.8-27b');
  assert.equal(modelId('groqFast', { GROQ_FAST_MODEL: '' }), MODEL_DEFAULTS.groqFast);
  assert.equal(modelId('groqFast', { GROQ_FAST_MODEL: '   ' }), MODEL_DEFAULTS.groqFast);
});

test('a retired-model error is recognised for both providers', () => {
  for (const e of [GROQ_GONE, GROQ_GONE_2, GEMINI_GONE]) {
    assert.equal(classifyAiFailure(e), 'model', e.message);
    assert.equal(isModelUnavailableError(e), true);
  }
});

test('other failures are not mistaken for a retired model', () => {
  assert.equal(classifyAiFailure({ message: 'Rate limit reached for model x', status: 429 }), 'quota');
  assert.equal(classifyAiFailure({ message: 'Resource has been exhausted (e.g. check quota).' }), 'quota');
  assert.equal(classifyAiFailure({ message: 'tool_use_failed: failed_generation' }), 'tool');
  assert.equal(classifyAiFailure({ message: 'API key not valid. Please pass a valid API key.', status: 400 }), 'other');
  assert.equal(classifyAiFailure({ message: '401 Invalid API Key', status: 401 }), 'other');
  assert.equal(classifyAiFailure({ message: 'We cannot generate an accurate answer' }), 'other', 'the word "rate" inside other words is not a rate limit');
  assert.equal(isModelUnavailableError(new Error('fetch failed')), false);
});

test('every provider is reported, so the first failure cannot be hidden by the second', () => {
  const text = describeAiFailure([
    { provider: 'gemini', model: 'gemini-2.0-flash', ...GEMINI_GONE },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', ...GROQ_GONE },
  ]);
  assert.match(text, /Gemini: the model "gemini-2\.0-flash" is no longer available/);
  assert.match(text, /Groq: the model "llama-3\.3-70b-versatile" is no longer available/);
  assert.match(text, /GEMINI_MODEL/);
  assert.match(text, /GROQ_MODEL/);
});

test('a mix of causes is explained provider by provider', () => {
  const text = describeAiFailure([
    { provider: 'gemini', model: 'm', message: 'Resource has been exhausted', status: 429 },
    { provider: 'groq', model: 'g', ...GROQ_GONE },
  ]);
  assert.match(text, /Gemini: rate-limited/);
  assert.match(text, /Groq: the model "g" is no longer available/);
  assert.doesNotMatch(text, /GEMINI_MODEL/, 'only the provider with a dead model is told to change its model');
});

test('the earlier friendly messages still apply when every provider failed the same way', () => {
  assert.match(describeAiFailure([{ provider: 'groq', model: 'g', message: 'tool_use_failed' }]), /call a tool correctly/);
  assert.match(describeAiFailure([{ provider: 'groq', model: 'g', message: 'x', status: 429 }, { provider: 'gemini', model: 'm', message: 'quota exceeded' }]), /rate-limited\. Wait a minute/);
  assert.match(describeAiFailure([]), /unknown reason/);
});

test('an unrecognised failure is shown on one line and truncated', () => {
  const long = 'boom\n'.repeat(100);
  const text = describeAiFailure([{ provider: 'groq', model: 'g', message: long }]);
  assert.doesNotMatch(text, /\n/);
  assert.ok(text.length < 300);
  assert.match(text, /Groq: boom boom/);
});

test('friendlyAiError explains a retired model and passes other errors through', () => {
  assert.match(friendlyAiError(Object.assign(new Error(GROQ_GONE.message), { status: 404 })), /no longer available.*GROQ_MODEL/);
  assert.equal(friendlyAiError(new Error('socket hang up')), 'socket hang up');
  assert.match(friendlyAiError({ message: 'x', status: 429 }), /rate-limited/);
});
