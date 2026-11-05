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

// A provider that did not answer in time is tried last, not first, for the next
// DEMOTE_FOR_MS (#415). Without this, a provider that never answers costs a full
// ATTEMPT_TIMEOUT_MS on every single message before the working one is tried
// (live: every agent reply took ~41 s because Gemini hung and Groq answered).
// While demoted it is still tried if every other provider fails, so it is never
// dropped for good; one success from it clears the demotion at once, and after
// the cooldown it is first again.
export const DEMOTE_FOR_MS = 10 * 60_000;

// Remembers, in this process, which providers recently timed out. Keyed by a
// string the caller chooses (see candidate.healthKey): the key should include
// the user, since API keys are per user and one user's dead key must not slow
// another user's replies.
export function createProviderHealth({ demoteForMs = DEMOTE_FOR_MS } = {}) {
  const timedOutAt = new Map(); // key -> ms timestamp of the last timeout
  return {
    recordTimeout: (key, at) => { timedOutAt.set(key, at); },
    recordSuccess: key => { timedOutAt.delete(key); },
    isDemoted(key, at) {
      const t = timedOutAt.get(key);
      if (t === undefined) return false;
      if (at - t >= demoteForMs) { timedOutAt.delete(key); return false; }
      return true;
    },
    // Anything that went quiet recently moves behind the ones that did not; the
    // order within each group is kept.
    order(candidates, at) {
      const key = c => c.healthKey ?? c.provider;
      return [...candidates.filter(c => !this.isDemoted(key(c), at)), ...candidates.filter(c => this.isDemoted(key(c), at))];
    },
    size: () => timedOutAt.size,
  };
}

// One per process, shared by every request.
export const providerHealth = createProviderHealth();

// <PREFIX>_ATTEMPT_TIMEOUT_MS / <PREFIX>_TOTAL_TIMEOUT_MS override the defaults (the
// chat agent uses AGENT, the digest / brief / content calls in llm.js use LLM); a
// value that is not a positive whole number of milliseconds is ignored.
export function timeoutsFromEnv(env = process.env, prefix = 'AGENT') {
  const read = (name, fallback) => {
    const n = Number(env[`${prefix}_${name}`]);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return { attemptTimeoutMs: read('ATTEMPT_TIMEOUT_MS', ATTEMPT_TIMEOUT_MS), totalTimeoutMs: read('TOTAL_TIMEOUT_MS', TOTAL_TIMEOUT_MS) };
}

// Runs fn(signal) and gives up after `ms`: the promise rejects with code
// AI_TIMEOUT and the signal is aborted so the underlying request is cancelled,
// not just ignored. fn must pass the signal on to the model call.
function timeoutError(ms) {
  const err = new Error(`no answer within ${Math.max(1, Math.round(ms / 1000))}s`);
  err.code = 'AI_TIMEOUT';
  return err;
}

// Settles with `promise`, or rejects with AI_TIMEOUT after `ms` and aborts `controller`.
async function within(promise, ms, controller) {
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = timeoutError(ms);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  return within(Promise.resolve().then(() => fn(controller.signal)), ms, controller);
}

// A reply with no text in it. Not an error from the provider, but as useless as one,
// so it counts as a failure and the next provider is tried (code AI_EMPTY).
export function emptyReplyError() {
  const err = new Error('the model returned an empty reply');
  err.code = 'AI_EMPTY';
  return err;
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
  health = providerHealth, label = 'agent',
} = {}) {
  const deadline = now() + totalTimeoutMs;
  const keyOf = c => c.healthKey ?? c.provider;
  // Why each provider's last attempt failed, keyed by provider. Keeping all of
  // them (not just the last) is what stops a retired first model from hiding
  // behind a different error from the fallback.
  const failures = new Map();

  for (const candidate of health.order(candidates, now())) {
    for (let n = 0; n <= maxToolRetries; n += 1) {
      // Whatever is left of the overall budget, capped per attempt. None left: stop.
      const budget = Math.min(attemptTimeoutMs, deadline - now());
      if (budget <= 0) break;
      try {
        const result = await withTimeout(signal => attempt(candidate.make(), candidate, { signal }), budget);
        health.recordSuccess(keyOf(candidate));
        return result;
      } catch (err) {
        const failure = failureOf(err);
        failures.set(candidate.provider, { provider: candidate.provider, model: candidate.model, ...failure });
        if (failure.code === 'AI_TIMEOUT') {
          health.recordTimeout(keyOf(candidate), now());
          warn(`[${label}] ${candidate.provider} (${candidate.model}) did not answer in time — trying it last for the next ${Math.round(DEMOTE_FOR_MS / 60000)} min`);
          break; // a retry of the same model would likely hang again
        }

        if (/tool_use_failed|failed_generation/.test(failure.message) && n < maxToolRetries) {
          warn(`[${label}] tool_use_failed (attempt ${n + 1}/${maxToolRetries + 1}) — retrying same model`);
          continue; // retry the same model
        }
        // quota, tool format exhausted, a retired model, or any other provider error → next provider
        warn(`[${label}] ${candidate.provider} (${candidate.model}) failed — trying next (${failure.message.slice(0, 80)})`);
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

// Streaming twin of runWithFallback, for callers that forward tokens as they arrive.
// makeStream(model, candidate, { signal }) returns an async iterable of text.
//
// The first token has to arrive within the attempt budget (and the overall limit),
// and every later token within attemptTimeoutMs of the one before it, so a stream
// that goes quiet ends. A provider that times out, errors, or finishes with no text
// before anything was sent is skipped and the next one is tried. Once a token has
// been yielded the caller has already shown it, so a failure after that is thrown,
// not retried on another provider.
export async function* streamWithFallback(candidates, makeStream, {
  warn = console.warn, label = 'llm',
  attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, totalTimeoutMs = TOTAL_TIMEOUT_MS, now = Date.now,
  health = providerHealth,
} = {}) {
  const deadline = now() + totalTimeoutMs;
  const keyOf = c => c.healthKey ?? c.provider;
  const failures = new Map();

  for (const candidate of health.order(candidates, now())) {
    const firstTokenBudget = Math.min(attemptTimeoutMs, deadline - now());
    if (firstTokenBudget <= 0) break;

    const controller = new AbortController();
    let iterator;
    let yielded = false;
    try {
      iterator = makeStream(candidate.make(), candidate, { signal: controller.signal })[Symbol.asyncIterator]();
      for (;;) {
        const wait = yielded ? attemptTimeoutMs : firstTokenBudget;
        const step = await within(iterator.next(), wait, controller);
        if (step.done) break;
        if (!yielded) { yielded = true; health.recordSuccess(keyOf(candidate)); }
        yield step.value;
      }
      if (yielded) return;
      throw emptyReplyError();
    } catch (err) {
      const failure = failureOf(err);
      // A stream that went quiet counts against the provider even part-way through,
      // so the next call does not wait on it again.
      if (failure.code === 'AI_TIMEOUT') health.recordTimeout(keyOf(candidate), now());
      if (yielded) throw err; // already partly shown: cannot start over elsewhere
      failures.set(candidate.provider, { provider: candidate.provider, model: candidate.model, ...failure });
      warn(`[${label}] ${candidate.provider} (${candidate.model}) failed to stream — trying next (${failure.message.slice(0, 80)})`);
    } finally {
      // Abort first, so the request itself is cancelled and not only the iteration:
      // this is what happens when the caller stops reading (the browser closed the
      // chat), as well as after a failure. Harmless once the stream has finished.
      controller.abort();
      // Not awaited: on a stream that is stuck waiting, return() queues behind the
      // pending read and would never settle. The abort signal is what stops it.
      Promise.resolve(iterator?.return?.()).catch(() => {});
    }
  }

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
