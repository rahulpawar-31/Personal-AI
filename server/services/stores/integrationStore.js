// server/services/stores/integrationStore.js
// IntegrationStore: one interface (get, set, delete, deleteAllForService,
// listForUser, listAll, replaceIfUnchanged), three adapters — see userStore.js for the same pattern and
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

    async listUserIdsForService(service) {
      const r = await pool.query(
        `SELECT DISTINCT user_id AS "userId" FROM user_integrations WHERE service = $1 ORDER BY user_id`,
        [service]
      );
      return r.rows.map(row => Number(row.userId));
    },

    // Every stored value, for re-encryption after a secret rotation.
    async listAll() {
      const r = await pool.query(
        `SELECT user_id AS "userId", service, key_name AS "keyName", key_value AS "keyValue"
         FROM user_integrations ORDER BY user_id, service, key_name`
      );
      return r.rows;
    },

    // Swaps a value only if it is still `expected`, so a key the user saved a
    // moment ago is never overwritten with an older value. updated_at is left
    // alone: re-encrypting is not a change the user made.
    async replaceIfUnchanged(userId, service, keyName, expected, keyValue) {
      const r = await pool.query(
        `UPDATE user_integrations SET key_value = $5
         WHERE user_id = $1 AND service = $2 AND key_name = $3 AND key_value = $4`,
        [userId, service, keyName, expected, keyValue]
      );
      return r.rowCount === 1;
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

    async listUserIdsForService(service) {
      const ids = new Set(read().filter(r => r.service === service).map(r => Number(r.userId)));
      return [...ids].sort((a, b) => a - b);
    },

    async listAll() {
      return read().map(r => ({ userId: r.userId, service: r.service, keyName: r.keyName, keyValue: r.keyValue }));
    },

    async replaceIfUnchanged(userId, service, keyName, expected, keyValue) {
      const rows = read();
      const idx  = rows.findIndex(r => match(r, userId, service, keyName));
      if (idx < 0 || rows[idx].keyValue !== expected) return false;
      rows[idx] = { ...rows[idx], keyValue };
      write(rows);
      return true;
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
