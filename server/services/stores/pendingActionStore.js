// server/services/stores/pendingActionStore.js
// PendingActionStore: one interface (createPendingAction, getPendingAction,
// listPendingActions, transitionPendingAction), three adapters — see
// userStore.js for the same pattern and rationale.
//
// transitionPendingAction(userId, id, fromStatus, toStatus, result) is one
// atomic "move this row from fromStatus to toStatus, only if it's still in
// fromStatus" primitive, reused three ways by routes/actions.js:
//   - claim:    pending    -> processing  (before running the side effect)
//   - finalize: processing -> approved/error (after running it)
//   - reject:   pending    -> rejected    (no side effect, one step)
// The atomic guard is what prevents a pending action from ever being
// processed twice by two concurrent approve requests — see docs/adr/0003.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const TERMINAL_STATUSES = new Set(['approved', 'rejected', 'error']);

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

    async transitionPendingAction(userId, id, fromStatus, toStatus, result = null) {
      const resolvedAtClause = TERMINAL_STATUSES.has(toStatus) ? 'NOW()' : 'resolved_at';
      const r = await pool.query(
        `UPDATE pending_actions SET status = $1, result = $2, resolved_at = ${resolvedAtClause}
         WHERE id = $3 AND user_id = $4 AND status = $5
         RETURNING ${SELECT_COLUMNS}`,
        [toStatus, result != null ? JSON.stringify(result) : null, id, userId, fromStatus]
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

    async transitionPendingAction(userId, id, fromStatus, toStatus, result = null) {
      const rows = read();
      const idx  = rows.findIndex(r => String(r.id) === String(id) && String(r.userId) === String(userId) && r.status === fromStatus);
      if (idx < 0) return null;
      rows[idx] = {
        ...rows[idx], status: toStatus, result,
        resolvedAt: TERMINAL_STATUSES.has(toStatus) ? new Date().toISOString() : rows[idx].resolvedAt,
      };
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
