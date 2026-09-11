// server/services/stores/integrationStore.js
// IntegrationStore: one interface (get, set, delete, deleteAllForService,
// listForUser), three adapters — see userStore.js for the same pattern and
// rationale. Deals in plain strings; encryption/decryption is a separate
// concern that stays in services/integrations.js's wrapper functions, same
// as it already was before this file existed.
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Postgres adapter — production ────────────────────────────────────────────

export function createPostgresIntegrationStore(pool) {
  return {
    async get(userId, service, keyName) {
      const r = await pool.query(
        `SELECT key_value FROM user_integrations WHERE user_id = $1 AND service = $2 AND key_name = $3`,
        [userId, service, keyName]
      );
      return r.rows[0]?.key_value ?? null;
    },

    async set(userId, service, keyName, keyValue) {
      await pool.query(
        `INSERT INTO user_integrations (user_id, service, key_name, key_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, service, key_name)
         DO UPDATE SET key_value = EXCLUDED.key_value, updated_at = NOW()`,
        [userId, service, keyName, keyValue]
      );
    },

    async delete(userId, service, keyName) {
      await pool.query(
        `DELETE FROM user_integrations WHERE user_id = $1 AND service = $2 AND key_name = $3`,
        [userId, service, keyName]
      );
    },

    async deleteAllForService(userId, service) {
      await pool.query(
        `DELETE FROM user_integrations WHERE user_id = $1 AND service = $2`,
        [userId, service]
      );
    },

    async listForUser(userId) {
      const r = await pool.query(
        `SELECT service, key_name AS "keyName", key_value AS "keyValue", updated_at AS "updatedAt"
         FROM user_integrations WHERE user_id = $1`,
        [userId]
      );
      return r.rows;
    },
  };
}

// ─── Shared core for the two array-backed adapters (JSON-file, in-memory) ────

function createArrayBackedIntegrationStore({ read, write }) {
  function match(r, userId, service, keyName) {
    return String(r.userId) === String(userId) && r.service === service && r.keyName === keyName;
  }

  return {
    async get(userId, service, keyName) {
      const row = read().find(r => match(r, userId, service, keyName));
      return row ? row.keyValue : null;
    },

    async set(userId, service, keyName, keyValue) {
      const rows = read();
      const now  = new Date().toISOString();
      const idx  = rows.findIndex(r => match(r, userId, service, keyName));
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], keyValue, updatedAt: now };
      } else {
        rows.push({ userId: String(userId), service, keyName, keyValue, createdAt: now, updatedAt: now });
      }
      write(rows);
    },

    async delete(userId, service, keyName) {
      write(read().filter(r => !match(r, userId, service, keyName)));
    },

    async deleteAllForService(userId, service) {
      write(read().filter(r => !(String(r.userId) === String(userId) && r.service === service)));
    },

    async listForUser(userId) {
      return read()
        .filter(r => String(r.userId) === String(userId))
        .map(r => ({ service: r.service, keyName: r.keyName, keyValue: r.keyValue, updatedAt: r.updatedAt ?? r.createdAt }));
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

export function createJsonFileIntegrationStore(filePath) {
  return createArrayBackedIntegrationStore({
    read() {
      if (!existsSync(filePath)) return [];
      try { return JSON.parse(readFileSync(filePath, 'utf8')); }
      catch { return []; }
    },
    write(rows) {
      writeFileSync(filePath, JSON.stringify(rows, null, 2));
    },
  });
}

// ─── In-memory adapter — tests only ───────────────────────────────────────────

export function createInMemoryIntegrationStore() {
  let rows = [];
  return createArrayBackedIntegrationStore({
    read: () => rows,
    write: (next) => { rows = next; },
  });
}
