// server/lib/aiFallback.js
// Try each AI provider in order until one answers, and remember why each failed.
//
// Intentionally sequential — this is a fallback chain (try model A, only fall
// back to B on failure), not independent work. Running candidates in parallel
// would fire (and pay for) several providers even when the first one succeeds.
import { describeAiFailure, failureOf } from './models.js';

// tool_use_failed is intermittent on Groq — retry the same model up to 2x first.
export const MAX_TOOL_RETRIES = 2;

// A model call that never answers must end. Each attempt gets ATTEMPT_TIMEOUT_MS,
// and the whole fallback chain gets TOTAL_TIMEOUT_MS, so a Gemini that hangs
// still leaves time to try Groq, and the request as a whole is over in about
// TOTAL_TIMEOUT_MS at worst. Without these, a slow or rate-limited provider kept
// the request open for minutes with no answer and no error (#409).
export const ATTEMPT_TIMEOUT_MS = 40_000;
export const TOTAL_TIMEOUT_MS   = 75_000;

// AGENT_ATTEMPT_TIMEOUT_MS / AGENT_TOTAL_TIMEOUT_MS override the defaults; a value
// that is not a positive whole number of milliseconds is ignored.
export function timeoutsFromEnv(env = process.env) {
  const read = (name, fallback) => {
    const n = Number(env[name]);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return { attemptTimeoutMs: read('AGENT_ATTEMPT_TIMEOUT_MS', ATTEMPT_TIMEOUT_MS), totalTimeoutMs: read('AGENT_TOTAL_TIMEOUT_MS', TOTAL_TIMEOUT_MS) };
}

// Runs fn(signal) and gives up after `ms`: the promise rejects with code
// AI_TIMEOUT and the signal is aborted so the underlying request is cancelled,
// not just ignored. fn must pass the signal on to the model call.
async function withTimeout(fn, ms) {
  const controller = new AbortController();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`no answer within ${Math.max(1, Math.round(ms / 1000))}s`);
      err.code = 'AI_TIMEOUT';
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

// candidates: [{ provider, model, make }] — make() builds the model instance.
// attempt(model, candidate, { signal }) does one try and returns the result, or
// throws; it should pass `signal` to the model call so a timeout cancels it.
// Resolves with the first success. If every provider fails, throws an error with
// code AI_UNAVAILABLE and status 503 whose message names each provider's cause.
// A provider that does not answer in time counts as failed, like any other error.
export async function runWithFallback(candidates, attempt, {
  maxToolRetries = MAX_TOOL_RETRIES, warn = console.warn,
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS, now = Date.now,
} = {}) {
  const deadline = now() + totalTimeoutMs;
  // Why each provider's last attempt failed, keyed by provider. Keeping all of
  // them (not just the last) is what stops a retired first model from hiding
  // behind a different error from the fallback.
  const failures = new Map();

  for (const candidate of candidates) {
    for (let n = 0; n <= maxToolRetries; n += 1) {
      // Whatever is left of the overall budget, capped per attempt. None left: stop.
      const budget = Math.min(attemptTimeoutMs, deadline - now());
      if (budget <= 0) break;
      try {
        return await withTimeout(signal => attempt(candidate.make(), candidate, { signal }), budget);
      } catch (err) {
        const failure = failureOf(err);
        failures.set(candidate.provider, { provider: candidate.provider, model: candidate.model, ...failure });
        if (failure.code === 'AI_TIMEOUT') {
          warn(`[agent] ${candidate.provider} (${candidate.model}) did not answer in time — trying next`);
          break; // a retry of the same model would likely hang again
        }

        if (/tool_use_failed|failed_generation/.test(failure.message) && n < maxToolRetries) {
          warn(`[agent] tool_use_failed (attempt ${n + 1}/${maxToolRetries + 1}) — retrying same model`);
          continue; // retry the same model
        }
        // quota, tool format exhausted, a retired model, or any other provider error → next provider
        warn(`[agent] ${candidate.provider} (${candidate.model}) failed — trying next (${failure.message.slice(0, 80)})`);
        break;
      }
    }
  }

  // 503, not 500: the app is fine, the AI providers it depends on are not.
  const exhausted = new Error(describeAiFailure([...failures.values()]));
  exhausted.code = 'AI_UNAVAILABLE';
  exhausted.status = 503;
  throw exhausted;
}

// HTTP status for an error that escaped the agent: 503 only for the "no provider
// could answer" error above. Never err.status: other errors can carry a status of
// their own (a 401 would make the client think its token expired).
export function aiErrorStatus(err) {
  return err?.code === 'AI_UNAVAILABLE' ? 503 : 500;
}
