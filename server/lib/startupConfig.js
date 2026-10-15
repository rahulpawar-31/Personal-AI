// server/lib/startupConfig.js
// Fail-closed startup checks. In production a missing or weak setting must stop
// the process, because each development fallback (a throwaway JWT secret, the
// JSON-file user store, open signup) silently weakens authentication.
import { isProduction } from './env.js';

export const MIN_JWT_SECRET_LENGTH = 32;

// Returns a list of human-readable problems; empty outside production or when
// the configuration is complete.
export function productionConfigProblems(env = process.env) {
  if (!isProduction(env)) return [];
  const problems = [];
  const jwt = env.JWT_SECRET ?? '';
  if (jwt.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters`);
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
