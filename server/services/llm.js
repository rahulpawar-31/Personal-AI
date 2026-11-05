// server/services/llm.js
// LangChain-powered LLM router.
//   Gemini (large context)  → @langchain/google-genai
//   Groq   (fast triage)    → @langchain/groq
// Model names come from lib/models.js (and its environment overrides) so a
// provider retiring a model is a one-line change. Provider selection is task-based.
// Failover between providers is lib/aiFallback.js, the same one the chat agent
// uses: every call has a time limit, and a provider that times out, errors or
// returns an empty reply is skipped in favour of the next (#417). Public function
// signatures are unchanged so every existing caller (index.js, gmail.js,
// content.js, calendar.js) keeps working.

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatGroq } from '@langchain/groq';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import crypto from 'node:crypto';
import { modelId } from '../lib/models.js';
import { runWithFallback, streamWithFallback, timeoutsFromEnv, emptyReplyError } from '../lib/aiFallback.js';

// Task type → preferred provider (the other becomes the fallback)
const TASK_ROUTING = {
  digest:    'gemini',
  brief:     'gemini',
  content:   'gemini',
  changelog: 'gemini',
  readme:    'gemini',
  research:  'gemini',
  data:      'gemini',
  chat:      'groq',
  triage:    'groq',
  classify:  'groq',
  blocker:   'gemini',
  intent:    'groq',
  alert:     'groq',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function resolveKey(provider, apiKeys = {}) {
  if (provider === 'gemini') return apiKeys.GEMINI_API_KEY || process.env.GEMINI_API_KEY || null;
  if (provider === 'groq')   return apiKeys.GROQ_API_KEY   || process.env.GROQ_API_KEY   || null;
  return null;
}

// The client libraries retry a failed call up to 6 times with growing pauses by
// default, which on a rate-limited key keeps a request open for minutes. One retry
// covers a blip; after that the next provider is tried (see lib/aiFallback.js).
const MODEL_MAX_RETRIES = 1;

function modelName(provider) {
  return provider === 'gemini' ? modelId('gemini') : modelId('groqFast');
}

function buildModel(provider, apiKey, maxTokens, streaming) {
  if (provider === 'gemini') {
    return new ChatGoogleGenerativeAI({
      model: modelName(provider), apiKey, maxOutputTokens: maxTokens, streaming, maxRetries: MODEL_MAX_RETRIES,
    });
  }
  return new ChatGroq({
    model: modelName(provider), apiKey, maxTokens, streaming, maxRetries: MODEL_MAX_RETRIES,
  });
}

// Which key a call uses, without keeping the key itself: a short fingerprint, so
// one key going quiet does not demote a different key for the same provider.
const fingerprint = key => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8);

// The providers to try for a task, in order: the preferred one first, the other
// after it. Skips any provider without a key. Throws MISSING_API_KEY if none.
function buildCandidates(taskType, { maxTokens, apiKeys, streaming = false }) {
  const provider = TASK_ROUTING[taskType] ?? 'gemini';
  const order    = [provider, ...['gemini', 'groq'].filter(p => p !== provider)];

  const candidates = order
    .map(p => ({ p, key: resolveKey(p, apiKeys) }))
    .filter(x => x.key)
    .map(({ p, key }) => ({
      provider: p,
      model: modelName(p),
      healthKey: `llm:${p}:${modelName(p)}:${fingerprint(key)}`,
      make: () => buildModel(p, key, maxTokens, streaming),
    }));

  if (!candidates.length) {
    const err = new Error('No LLM API key configured — set GEMINI_API_KEY or GROQ_API_KEY (or add one in Settings)');
    err.code = 'MISSING_API_KEY';
    throw err;
  }

  console.log(`[llm] ${taskType} → ${candidates.map(c => c.provider).join(' → ')}`);
  return candidates;
}

// Convert our { role, content } messages into LangChain message instances.
function toLC(messages) {
  return messages.map(m => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant' || m.role === 'ai') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });
}

// The text in a message's content. Some models (Gemini, and any model that thinks)
// send a list of parts such as [{ type: 'text', text: '...' }, { type: 'thinking' }]
// instead of a string; only the text parts count, joined in order.
function partsText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('');
}

function textOf(content) {
  if (typeof content === 'string' || Array.isArray(content)) return partsText(content);
  return content == null ? '' : JSON.stringify(content);
}

// No text at all: nothing, a blank string, or parts that carry no text (an empty list,
// [{ type: 'text', text: '' }], thinking-only parts). Judged on what the model sent,
// not on a stringified form, so a model that really answers with the text "[]" (a
// valid empty JSON list) is not mistaken for an empty reply.
const isEmptyReply = content => !textOf(content).trim();

function parseJSON(raw, provider = 'llm') {
  try {
    return JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    throw new Error(`[${provider}] invalid JSON in response: ${raw.slice(0, 120)}`);
  }
}

// The time limits for a task type. LLM_ATTEMPT_TIMEOUT_MS / LLM_TOTAL_TIMEOUT_MS set
// them for every task; LLM_<TASK>_ATTEMPT_TIMEOUT_MS / LLM_<TASK>_TOTAL_TIMEOUT_MS
// (for example LLM_DIGEST_TOTAL_TIMEOUT_MS) raise or lower them for one, so a big
// digest or content call on Gemini can be given longer than a quick classify.
export function limitsFor(taskType, env = process.env) {
  const task = String(taskType).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return timeoutsFromEnv(env, `LLM_${task}`, timeoutsFromEnv(env, 'LLM'));
}

// ─── Public API (unchanged signatures) ───────────────────────────────────────

export async function call(messages, options = {}) {
  const { taskType = 'chat', maxTokens = 500, apiKeys = {} } = options;
  return callWith(buildCandidates(taskType, { maxTokens, apiKeys }), messages, options, limitsFor(taskType));
}

// The real work of call(), with the providers and the time limits passed in. Not part
// of the public API: it exists so tests can use fake models and short timeouts without
// call() having options that could swap the providers out.
export async function callWith(candidates, messages, options = {}, fallback = {}) {
  const { taskType = 'chat', json = false } = options;
  const lcMessages = toLC(messages);

  // A reply that is empty, or (for json) not parseable, is a failed attempt like any
  // other, so the next provider gets a go instead of the caller getting nothing.
  return runWithFallback(candidates, async (model, _candidate, { signal } = {}) => {
    const res = await model.invoke(lcMessages, { runName: `llm:${taskType}`, tags: ['devos', taskType], signal });
    if (isEmptyReply(res?.content)) throw emptyReplyError();
    const out = textOf(res.content);
    return json ? parseJSON(out, taskType) : out;
  }, { label: 'llm', ...fallback });
}

// Backwards-compatible simple chat helper
export async function chat(userMessage, systemPrompt = 'You are a helpful personal AI assistant.') {
  return call(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
    { taskType: 'chat' }
  );
}

const INTENT_GUIDE = `
Intent guide — pick the single closest match per action:
- add_task: add/create a task or to-do item
- update_task: mark a task done/in-progress/complete
- get_tasks: list, show or check tasks
- create_note: save/add/create a note, idea, or piece of writing to Notion
- get_notes: list or show notes
- draft_email: compose/write/draft an email (do NOT send)
- send_email: send an email immediately
- get_emails: show/check inbox or emails
- create_event: schedule/add/create a calendar event or meeting
- get_calendar: show/check upcoming events or schedule
- create_issue: file/create/open a GitHub issue or bug report
- get_issues: list/show GitHub issues
- get_prs: show/check pull requests
- get_trello: show/check Trello cards or board
- run_digest: run or trigger the full morning/daily digest briefing
- draft_linkedin: write/draft a LinkedIn post from a source article or topic
- save_memory: remember/save a personal fact or preference
- general_chat: anything that does not clearly match the intents above
`.trim();

// classify() — returns structured JSON matching the schema
export async function classify(text, schema, apiKeys = {}) {
  return call(
    [
      { role: 'system', content: `JSON only. Omit null/empty params.\n${INTENT_GUIDE}\nSchema:\n${schema}` },
      { role: 'user',   content: text },
    ],
    { taskType: 'classify', json: true, maxTokens: 800, apiKeys }
  );
}

// generate() — summary / content generation
export async function generate(prompt, context = '', taskType = 'digest', apiKeys = {}) {
  return call(
    [
      { role: 'system', content: 'Be concise and accurate.' },
      ...(context ? [{ role: 'user', content: `Context:\n${context}` }] : []),
      { role: 'user', content: prompt },
    ],
    { taskType, maxTokens: 600, apiKeys }
  );
}

// Streaming call — yields text tokens via async generator (LangChain .stream()).
// The first token must arrive in time and the stream must not go quiet; a provider
// that fails before sending anything is replaced by the next (see streamWithFallback).
export async function* streamTokens(messages, options = {}) {
  const { taskType = 'chat', maxTokens = 600, apiKeys = {} } = options;
  yield* streamWith(buildCandidates(taskType, { maxTokens, apiKeys, streaming: true }), messages, options, limitsFor(taskType));
}

// The real work of streamTokens(); see callWith for why it is separate.
export async function* streamWith(candidates, messages, options = {}, fallback = {}) {
  const { taskType = 'chat' } = options;
  const lcMessages = toLC(messages);

  async function* textChunks(model, _candidate, { signal } = {}) {
    const stream = await model.stream(lcMessages, { runName: `llm:${taskType}`, tags: ['devos', taskType], signal });
    for await (const chunk of stream) {
      const t = partsText(chunk?.content); // a string, or the text parts of a list
      if (t) yield t;
    }
  }

  yield* streamWithFallback(candidates, textChunks, { label: 'llm', ...fallback });
}

export default { call, chat, classify, generate, streamTokens };
