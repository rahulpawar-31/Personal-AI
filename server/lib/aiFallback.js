// server/lib/aiFallback.js
// Try each AI provider in order until one answers, and remember why each failed.
//
// Intentionally sequential — this is a fallback chain (try model A, only fall
// back to B on failure), not independent work. Running candidates in parallel
// would fire (and pay for) several providers even when the first one succeeds.
import { describeAiFailure, failureOf } from './models.js';

// tool_use_failed is intermittent on Groq — retry the same model up to 2x first.
export const MAX_TOOL_RETRIES = 2;

// candidates: [{ provider, model, make }] — make() builds the model instance.
// attempt(model, candidate) does one try and returns the result, or throws.
// Resolves with the first success. If every provider fails, throws an error with
// code AI_UNAVAILABLE and status 503 whose message names each provider's cause.
export async function runWithFallback(candidates, attempt, { maxToolRetries = MAX_TOOL_RETRIES, warn = console.warn } = {}) {
  // Why each provider's last attempt failed, keyed by provider. Keeping all of
  // them (not just the last) is what stops a retired first model from hiding
  // behind a different error from the fallback.
  const failures = new Map();

  for (const candidate of candidates) {
    for (let n = 0; n <= maxToolRetries; n += 1) {
      try {
        return await attempt(candidate.make(), candidate);
      } catch (err) {
        const failure = failureOf(err);
        failures.set(candidate.provider, { provider: candidate.provider, model: candidate.model, ...failure });

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
