// server/lib/models.js
// The one place AI model names live, and how a model failure is explained.
//
// Providers retire models on a schedule (Google shut down gemini-2.0-flash on
// 1 Jun 2026; Groq shut down llama-3.1-8b-instant and llama-3.3-70b-versatile on
// 16 Aug 2026), and a hard-coded name then breaks every chat message at once.
// Names are read at call time so an environment variable fixes a retirement
// without a code change or a redeploy of new code:
//
//   GEMINI_MODEL     large-context and general tasks (digest, content, changelog)
//   GROQ_MODEL       the tool-calling agent
//   GROQ_FAST_MODEL  quick triage, classify and chat
//
// The defaults are the replacements each provider names on its deprecations page.

export const MODEL_DEFAULTS = {
  gemini:   'gemini-3.8-flash',
  groq:     'openai/gpt-oss-120b',
  groqFast: 'openai/gpt-oss-20b',
};

export const MODEL_ENV = {
  gemini:   'GEMINI_MODEL',
  groq:     'GROQ_MODEL',
  groqFast: 'GROQ_FAST_MODEL',
};

export function modelId(slot, env = process.env) {
  return env[MODEL_ENV[slot]]?.trim() || MODEL_DEFAULTS[slot];
}

// ─── Classifying a provider failure ──────────────────────────────────────────

const TOOL_FORMAT = /tool_use_failed|failed_generation/i;
const QUOTA       = /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i;
const MODEL_GONE  = /model[_ ]not[_ ]found|model.{0,80}(does not exist|not found|no longer|not supported|decommission|deprecat|retired)|(does not exist|not found|decommission|deprecat|retired).{0,80}model/i;

// 'model' | 'quota' | 'tool' | 'other'
export function classifyAiFailure({ message = '', status } = {}) {
  if (TOOL_FORMAT.test(message)) return 'tool';
  if (status === 429 || QUOTA.test(message)) return 'quota';
  if (status === 404 || MODEL_GONE.test(message)) return 'model';
  return 'other';
}

export function failureOf(err) {
  return { message: String(err?.message ?? err ?? ''), status: err?.status ?? err?.response?.status };
}

// True when the provider reached the model lookup and said it is not available,
// which also means the API key itself was accepted.
export function isModelUnavailableError(err) {
  return classifyAiFailure(failureOf(err)) === 'model';
}

// ─── Explaining failures ─────────────────────────────────────────────────────

const TOOL_MESSAGE  = 'The AI model failed to call a tool correctly. Turn Agent OFF and try again, or wait and retry.';
const QUOTA_MESSAGE = 'All AI keys are currently rate-limited. Wait a minute then try again.';
const LABELS = { gemini: 'Gemini', groq: 'Groq' };

function oneLine(text, max = 140) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// failures: [{ provider, model, message, status }] — one per provider that was tried.
// Reports every provider, so a dead model on the first cannot hide behind the
// second one's different error.
export function describeAiFailure(failures) {
  if (!failures?.length) return 'The AI request failed for an unknown reason.';
  const kinds = failures.map(classifyAiFailure);
  if (kinds.every(k => k === 'tool'))  return TOOL_MESSAGE;
  if (kinds.every(k => k === 'quota')) return QUOTA_MESSAGE;

  const parts = failures.map((f, i) => {
    const who = LABELS[f.provider] ?? f.provider;
    if (kinds[i] === 'model') return `${who}: the model "${f.model}" is no longer available`;
    if (kinds[i] === 'quota') return `${who}: rate-limited`;
    if (kinds[i] === 'tool')  return `${who}: failed to call a tool correctly`;
    return `${who}: ${oneLine(f.message)}`;
  });
  let text = `No AI provider could answer. ${parts.join('; ')}.`;

  const gone = failures.filter((f, i) => kinds[i] === 'model');
  if (gone.length) {
    const names = [...new Set(gone.map(f => (f.provider === 'gemini' ? MODEL_ENV.gemini : `${MODEL_ENV.groq} / ${MODEL_ENV.groqFast}`)))];
    text += ` Set ${names.join(' and ')} to a model the account can use.`;
  }
  return text;
}

// For a single caught error, e.g. from the streaming chat path.
export function friendlyAiError(err) {
  const failure = failureOf(err);
  const kind = classifyAiFailure(failure);
  if (kind === 'model') {
    return `The AI model is no longer available at its provider. Set ${MODEL_ENV.gemini} and ${MODEL_ENV.groq} / ${MODEL_ENV.groqFast} to current models.`;
  }
  if (kind === 'quota') return QUOTA_MESSAGE;
  if (kind === 'tool')  return TOOL_MESSAGE;
  return failure.message || 'The AI request failed.';
}
