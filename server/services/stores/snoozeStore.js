// server/services/stores/snoozeStore.js
// SnoozeStore: the "Needs you" items a user has put off. One interface
// (upsertSnooze, listSnoozes, removeSnooze, removeReturnedBefore), three
// adapters, same pattern as userStore.js. Every call is scoped to one user, so
// one user's snoozes can never be read or changed through another's id.
//
// A row is { key, until, title }: `key` identifies the item (built by the
// client, for example "mail:gmail:18c3..."), `until` is the ISO instant it
// comes back, `title` is a copy of its title so a snoozed item can be listed
// even when it is not in the current Needs-you list.
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Postgres adapter ─────────────────────────────────────────────────────────

const toRow = r => ({ key: r.key, until: new Date(r.until).toISOString(), title: r.title ?? '' });

export function createPostgresSnoozeStore(pool) {
  return {
    async upsertSnooze(userId, { key, until, title = '' }) {
      const r = await pool.query(
        `INSERT INTO user_snoozes (user_id, item_key, until, title) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, item_key) DO UPDATE SET until = EXCLUDED.until, title = EXCLUDED.title
         RETURNING item_key AS key, until, title`,
        [userId, key, until, title]
      );
      return toRow(r.rows[0]);
    },

    async listSnoozes(userId) {
      const r = await pool.query(
        'SELECT item_key AS key, until, title FROM user_snoozes WHERE user_id = $1 ORDER BY until',
        [userId]
      );
      return r.rows.map(toRow);
    },

    async removeSnooze(userId, key) {
      const r = await pool.query('DELETE FROM user_snoozes WHERE user_id = $1 AND item_key = $2', [userId, key]);
      return r.rowCount > 0;
    },

    async removeReturnedBefore(userId, cutoffISO) {
      const r = await pool.query('DELETE FROM user_snoozes WHERE user_id = $1 AND until < $2', [userId, cutoffISO]);
      return r.rowCount;
    },
  };
}

// ─── Shared core for the two array-backed adapters (JSON-file, in-memory) ────

function createArrayBackedSnoozeStore({ read, write }) {
  const sameUser = userId => row => String(row.userId) === String(userId);
  const publicRow = r => ({ key: r.key, until: r.until, title: r.title ?? '' });

  return {
    async upsertSnooze(userId, { key, until, title = '' }) {
      const rows = read();
      const idx  = rows.findIndex(r => sameUser(userId)(r) && r.key === key);
      const next = { userId, key, until, title };
      if (idx >= 0) rows[idx] = next; else rows.push(next);
      write(rows);
      return publicRow(next);
    },

    async listSnoozes(userId) {
      return read().filter(sameUser(userId)).map(publicRow).sort((a, b) => a.until.localeCompare(b.until));
    },

    async removeSnooze(userId, key) {
      const rows = read();
      const kept = rows.filter(r => !(sameUser(userId)(r) && r.key === key));
      if (kept.length === rows.length) return false;
      write(kept);
      return true;
    },

    async removeReturnedBefore(userId, cutoffISO) {
      const rows = read();
      const kept = rows.filter(r => !(sameUser(userId)(r) && r.until < cutoffISO));
      if (kept.length !== rows.length) write(kept);
      return rows.length - kept.length;
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

export function createJsonFileSnoozeStore(filePath) {
  return createArrayBackedSnoozeStore({
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

export function createInMemorySnoozeStore() {
  let rows = [];
  return createArrayBackedSnoozeStore({
    read: () => rows.map(r => ({ ...r })),
    write: next => { rows = next; },
  });
}
