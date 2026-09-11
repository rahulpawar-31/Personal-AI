// server/services/stores/pendingActionStore.js
// PendingActionStore: one interface (createPendingAction, getPendingAction,
// listPendingActions, resolvePendingAction), three adapters — see userStore.js
// for the same pattern and rationale.
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Postgres adapter — production ────────────────────────────────────────────

const SELECT_COLUMNS = `id, user_id AS "userId", action_type AS "actionType", params,
              source_message AS "sourceMessage", status, result,
              created_at AS "createdAt", resolved_at AS "resolvedAt"`;

export function createPostgresPendingActionStore(pool) {
  return {
    async createPendingAction(userId, actionType, params, sourceMessage = '') {
      const r = await pool.query(
        `INSERT INTO pending_actions (user_id, action_type, params, source_message)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SELECT_COLUMNS}`,
        [userId, actionType, JSON.stringify(params ?? {}), sourceMessage]
      );
      return r.rows[0];
    },

    async getPendingAction(userId, id) {
      const r = await pool.query(
        `SELECT ${SELECT_COLUMNS} FROM pending_actions WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      return r.rows[0] ?? null;
    },

    async listPendingActions(userId, status = 'pending') {
      const r = await pool.query(
        `SELECT ${SELECT_COLUMNS} FROM pending_actions WHERE user_id = $1 AND status = $2 ORDER BY created_at`,
        [userId, status]
      );
      return r.rows;
    },

    async resolvePendingAction(userId, id, status, result = null) {
      const r = await pool.query(
        `UPDATE pending_actions SET status = $1, result = $2, resolved_at = NOW()
         WHERE id = $3 AND user_id = $4 AND status = 'pending'
         RETURNING ${SELECT_COLUMNS}`,
        [status, result != null ? JSON.stringify(result) : null, id, userId]
      );
      return r.rows[0] ?? null;
    },
  };
}

// ─── Shared core for the two array-backed adapters (JSON-file, in-memory) ────

function toPendingActionRow(r) {
  return {
    id:            r.id,
    userId:        r.userId,
    actionType:    r.actionType,
    params:        r.params,
    sourceMessage: r.sourceMessage ?? null,
    status:        r.status,
    result:        r.result ?? null,
    createdAt:     r.createdAt,
    resolvedAt:    r.resolvedAt ?? null,
  };
}

function createArrayBackedPendingActionStore({ read, write }) {
  function nextId(rows) {
    return rows.length ? Math.max(...rows.map(r => r.id)) + 1 : 1;
  }

  return {
    async createPendingAction(userId, actionType, params, sourceMessage = '') {
      const rows = read();
      const row = {
        id: nextId(rows), userId, actionType, params: params ?? {}, sourceMessage,
        status: 'pending', result: null, createdAt: new Date().toISOString(), resolvedAt: null,
      };
      write([...rows, row]);
      return toPendingActionRow(row);
    },

    async getPendingAction(userId, id) {
      const row = read().find(r => String(r.id) === String(id) && String(r.userId) === String(userId));
      return row ? toPendingActionRow(row) : null;
    },

    async listPendingActions(userId, status = 'pending') {
      return read()
        .filter(r => String(r.userId) === String(userId) && r.status === status)
        .map(toPendingActionRow);
    },

    async resolvePendingAction(userId, id, status, result = null) {
      const rows = read();
      const idx  = rows.findIndex(r => String(r.id) === String(id) && String(r.userId) === String(userId) && r.status === 'pending');
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], status, result, resolvedAt: new Date().toISOString() };
      write(rows);
      return toPendingActionRow(rows[idx]);
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

export function createJsonFilePendingActionStore(filePath) {
  return createArrayBackedPendingActionStore({
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

export function createInMemoryPendingActionStore() {
  let rows = [];
  return createArrayBackedPendingActionStore({
    read: () => rows,
    write: (next) => { rows = next; },
  });
}
