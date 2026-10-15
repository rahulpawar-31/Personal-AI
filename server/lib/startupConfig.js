// server/lib/startupConfig.js
// Fail-closed startup checks. In production a missing or weak setting must stop
// the process, because each development fallback (a throwaway JWT secret, the
// JSON-file user store, open signup) silently weakens authentication.
import { isProduction } from './env.js';

export const MIN_JWT_SECRET_LENGTH = 32;
// Entropy can't be measured from the value alone, but a 32-character secret
// that repeats a few characters ("aaaa…", "abababab…") or reads as a
// placeholder is certainly guessable. `openssl rand -hex 32` yields ~16
// distinct characters, so this floor never rejects a properly generated one.
export const MIN_JWT_DISTINCT_CHARS = 10;
const PLACEHOLDER_JWT = /change.?me|your.?secret|placeholder|example|password|secret.?key/i;

// Returns a list of human-readable problems; empty outside production or when
// the configuration is complete.
export function productionConfigProblems(env = process.env) {
  if (!isProduction(env)) return [];
  const problems = [];
  const jwt = env.JWT_SECRET ?? '';
  if (jwt.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters`);
  } else if (new Set(jwt).size < MIN_JWT_DISTINCT_CHARS || PLACEHOLDER_JWT.test(jwt)) {
    problems.push('JWT_SECRET looks guessable (repetitive or a placeholder); generate one with `openssl rand -hex 32`');
  }
  if (!env.DATABASE_URL?.trim()) {
    problems.push('DATABASE_URL must be set (the JSON-file store is for development only)');
  }
  if (!env.OWNER_USERNAME?.trim()) {
    problems.push('OWNER_USERNAME must be set (without it, signup is open to anyone)');
  }
  return problems;
}

export function assertProductionConfig(env = process.env, exit = process.exit) {
  const problems = productionConfigProblems(env);
  if (problems.length === 0) return;
  console.error('[config] Refusing to start in production with incomplete configuration:');
  for (const p of problems) console.error(`[config]  - ${p}`);
  exit(1);
}
