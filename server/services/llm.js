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

function textOf(content) {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

// No text at all: an empty string, or the stringified empty parts list.
const isEmptyReply = text => !text.trim() || text.trim() === '[]';

function parseJSON(raw, provider = 'llm') {
  try {
    return JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
  } catch {
    throw new Error(`[${provider}] invalid JSON in response: ${raw.slice(0, 120)}`);
  }
}

// ─── Public API (unchanged signatures) ───────────────────────────────────────

export async function call(messages, options = {}) {
  const {
    taskType  = 'chat',
    json      = false,
    maxTokens = 500,
    apiKeys   = {},
  } = options;

  // options.candidates / options.fallback replace the real providers and the time
  // limits; they exist so tests can use fake models and short timeouts.
  const candidates = options.candidates ?? buildCandidates(taskType, { maxTokens, apiKeys });
  const lcMessages = toLC(messages);

  // A reply that is empty, or (for json) not parseable, is a failed attempt like any
  // other, so the next provider gets a go instead of the caller getting nothing.
  return runWithFallback(candidates, async (model, _candidate, { signal } = {}) => {
    const res = await model.invoke(lcMessages, { runName: `llm:${taskType}`, tags: ['devos', taskType], signal });
    const out = textOf(res.content);
    if (isEmptyReply(out)) throw emptyReplyError();
    return json ? parseJSON(out, taskType) : out;
  }, { ...timeoutsFromEnv(process.env, 'LLM'), label: 'llm', ...options.fallback });
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
  const candidates = options.candidates ?? buildCandidates(taskType, { maxTokens, apiKeys, streaming: true });
  const lcMessages = toLC(messages);

  async function* textChunks(model, _candidate, { signal } = {}) {
    const stream = await model.stream(lcMessages, { runName: `llm:${taskType}`, tags: ['devos', taskType], signal });
    for await (const chunk of stream) {
      const t = chunk?.content;
      if (typeof t === 'string' && t) yield t;
    }
  }

  yield* streamWithFallback(candidates, textChunks, { ...timeoutsFromEnv(process.env, 'LLM'), label: 'llm', ...options.fallback });
}

export default { call, chat, classify, generate, streamTokens };
