// server/services/db.js
// Postgres when DATABASE_URL is set; JSON file fallback for local dev.
//
// dbX functions below are thin delegators onto userStore/pendingActionStore
// (server/services/stores/*.js) — the backend is selected once, at the end of
// initDB(), never per-call. See docs/adr/0002 for why the two stores are kept
// separate rather than one, and why a third in-memory adapter exists.
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createPostgresUserStore, createJsonFileUserStore,
} from './stores/userStore.js';
import {
  createPostgresPendingActionStore, createJsonFilePendingActionStore,
} from './stores/pendingActionStore.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.join(__dirname, '..', 'users.json');
const PENDING_ACTIONS_FILE = path.join(__dirname, '..', 'pending_actions.json');

let pool = null;

// Default to the JSON-file adapters at module load, matching pool's default
// null (JSON-file) behavior for any dbX call that happens before initDB() runs.
let userStore          = createJsonFileUserStore(USERS_FILE);
let pendingActionStore = createJsonFilePendingActionStore(PENDING_ACTIONS_FILE);

export function getPool() { return pool; }

export async function initDB() {
  if (process.env.DATABASE_URL) {
    try {
      const { default: pkg } = await import('pg');
      const Pool = pkg.Pool ?? pkg;
      // Neon (and most hosted Postgres) requires SSL.
      // rejectUnauthorized:false works everywhere; for Neon the cert is valid so
      // we can set it to true when the URL contains neon.tech.
      const isNeon = process.env.DATABASE_URL.includes('neon.tech');
      // Add uselibpqcompat to silence pg's SSL deprecation warning on Neon URLs
      const connStr = isNeon && !process.env.DATABASE_URL.includes('uselibpqcompat')
        ? process.env.DATABASE_URL.replace('sslmode=require', 'sslmode=require&uselibpqcompat=true')
        : process.env.DATABASE_URL;
      pool = new Pool({
        connectionString: connStr,
        ssl: isNeon ? { rejectUnauthorized: true } : { rejectUnauthorized: false },
        // Neon serverless connections can be idle-dropped — keep pool small
        max: isNeon ? 5 : 10,
        idleTimeoutMillis: isNeon ? 10000 : 30000,
        connectionTimeoutMillis: 5000,
      });

      // ── Users table ───────────────────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id            SERIAL PRIMARY KEY,
          username      TEXT UNIQUE NOT NULL,
          email         TEXT UNIQUE,
          password_hash TEXT NOT NULL,
          google_id     TEXT UNIQUE,
          is_active     BOOLEAN DEFAULT TRUE,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id  TEXT UNIQUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin   BOOLEAN DEFAULT FALSE`);

      // ── User integrations table ───────────────────────────────────────────────
      // Stores one encrypted key/value per row, keyed by (user_id, service, key_name).
      // key_value is AES-256-GCM encrypted — never stored in plain text.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_integrations (
          id         SERIAL PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          service    TEXT NOT NULL,
          key_name   TEXT NOT NULL,
          key_value  TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (user_id, service, key_name)
        )
      `);

      // ── Per-user memory table ─────────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_memory (
          user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data       JSONB    NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // ── Email cache table — persists triage results across restarts ───────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_cache (
          user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          data       JSONB        NOT NULL DEFAULT '[]',
          fetched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);

      // ── Pending agent actions — state-changing tool calls awaiting human
      // approval before executeAction actually runs them (see SEC-2 remediation).
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pending_actions (
          id             SERIAL PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          action_type    TEXT NOT NULL,
          params         JSONB NOT NULL DEFAULT '{}',
          source_message TEXT,
          status         TEXT NOT NULL DEFAULT 'pending',
          result         JSONB,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolved_at    TIMESTAMPTZ
        )
      `);

      console.log(`[db] ${isNeon ? 'Neon' : 'Postgres'} connected — schema ready (users + user_integrations + user_memory)`);
    } catch (err) {
      console.error('[db] Postgres init failed:', err.message, '— falling back to JSON store');
      pool = null;
    }
  } else {
    console.log('[db] No DATABASE_URL — using JSON file store (users.json)');
  }

  userStore          = pool ? createPostgresUserStore(pool) : createJsonFileUserStore(USERS_FILE);
  pendingActionStore  = pool ? createPostgresPendingActionStore(pool) : createJsonFilePendingActionStore(PENDING_ACTIONS_FILE);
}

// ─── User CRUD ────────────────────────────────────────────────────────────────

export async function dbCreateUser(args)                    { return userStore.createUser(args); }
export async function dbFindByUsername(username)             { return userStore.findByUsername(username); }
export async function dbFindById(id)                         { return userStore.findById(id); }
export async function dbUpdateEmail(userId, email)           { return userStore.updateEmail(userId, email); }
export async function dbUpdatePasswordHash(userId, hash)     { return userStore.updatePasswordHash(userId, hash); }
export async function dbDeleteUser(userId)                   { return userStore.deleteUser(userId); }
export async function dbFindByGoogleId(googleId)              { return userStore.findByGoogleId(googleId); }
export async function dbFindByEmail(email)                   { return userStore.findByEmail(email); }
export async function dbLinkGoogleId(userId, googleId)        { return userStore.linkGoogleId(userId, googleId); }
export async function dbCreateGoogleUser(args)                { return userStore.createGoogleUser(args); }

// ─── Admin helpers ────────────────────────────────────────────────────────────

export async function dbListUsers()                          { return userStore.listUsers(); }
export async function dbSetAdmin(userId, isAdmin)             { return userStore.setAdmin(userId, isAdmin); }
export async function dbIsAdmin(userId)                       { return userStore.isAdmin(userId); }

// ─── Pending agent actions ────────────────────────────────────────────────────
// Queued state-changing tool calls awaiting explicit human approval — see SEC-2.

export async function dbCreatePendingAction(userId, actionType, params, sourceMessage = '') {
  return pendingActionStore.createPendingAction(userId, actionType, params, sourceMessage);
}
export async function dbGetPendingAction(userId, id)          { return pendingActionStore.getPendingAction(userId, id); }
export async function dbListPendingActions(userId, status = 'pending') { return pendingActionStore.listPendingActions(userId, status); }
export async function dbResolvePendingAction(userId, id, status, result = null) {
  return pendingActionStore.resolvePendingAction(userId, id, status, result);
}
