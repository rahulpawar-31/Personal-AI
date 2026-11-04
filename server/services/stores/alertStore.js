// server/services/stores/alertStore.js
// AlertStore: everything the VIP / review-request alerts need to remember per
// user. One interface, three adapters, same pattern as snoozeStore.js. Every call
// is scoped to one user, except consumeLinkToken (the token itself identifies
// the user) and listLinked (the scheduler's list of who can be alerted).
//
//   prefs        - which alerts the user wants, and the Telegram chat they linked
//   link tokens  - short-lived, single-use codes that tie a Telegram chat to a user
//   sent record  - one row per alerted item, so an item alerts once (also what
//                  the per-user rate limit counts)
//
// claimAlert(userId, key, atISO) records the item and says whether this caller
// was the one to record it. Two ticks, or two processes, cannot both get true
// for the same user and item. releaseAlert gives the item back after a failed send.
import { readFileSync, writeFileSync, existsSync } from 'fs';

export const PREF_DEFAULTS = { vipEnabled: true, reviewEnabled: true, telegramChatId: null, telegramLinkedAt: null };

// ─── Postgres adapter ─────────────────────────────────────────────────────────

const PREF_COLUMNS = `user_id AS "userId", vip_enabled AS "vipEnabled", review_enabled AS "reviewEnabled",
                      telegram_chat_id AS "telegramChatId", telegram_linked_at AS "telegramLinkedAt"`;

const prefRow = r => r && ({ ...r, telegramLinkedAt: r.telegramLinkedAt ? new Date(r.telegramLinkedAt).toISOString() : null });

export function createPostgresAlertStore(pool) {
  return {
    async getPrefs(userId) {
      const r = await pool.query(`SELECT ${PREF_COLUMNS} FROM user_alert_prefs WHERE user_id = $1`, [userId]);
      return prefRow(r.rows[0]) ?? null;
    },

    // Only the two on/off switches; linking goes through linkTelegram.
    async savePrefs(userId, patch) {
      const r = await pool.query(
        `INSERT INTO user_alert_prefs (user_id, vip_enabled, review_enabled)
         VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE))
         ON CONFLICT (user_id) DO UPDATE
           SET vip_enabled    = COALESCE($2, user_alert_prefs.vip_enabled),
               review_enabled = COALESCE($3, user_alert_prefs.review_enabled),
               updated_at = NOW()
         RETURNING ${PREF_COLUMNS}`,
        [userId, patch.vipEnabled ?? null, patch.reviewEnabled ?? null]
      );
      return prefRow(r.rows[0]);
    },

    async linkTelegram(userId, chatId, atISO) {
      const r = await pool.query(
        `INSERT INTO user_alert_prefs (user_id, telegram_chat_id, telegram_linked_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET telegram_chat_id = EXCLUDED.telegram_chat_id, telegram_linked_at = EXCLUDED.telegram_linked_at, updated_at = NOW()
         RETURNING ${PREF_COLUMNS}`,
        [userId, String(chatId), atISO]
      );
      return prefRow(r.rows[0]);
    },

    async unlinkTelegram(userId) {
      await pool.query(
        'UPDATE user_alert_prefs SET telegram_chat_id = NULL, telegram_linked_at = NULL, updated_at = NOW() WHERE user_id = $1',
        [userId]
      );
    },

    // Everyone with a linked channel and at least one alert switched on.
    async listLinked() {
      const r = await pool.query(
        `SELECT ${PREF_COLUMNS} FROM user_alert_prefs
         WHERE telegram_chat_id IS NOT NULL AND (vip_enabled OR review_enabled)`
      );
      return r.rows.map(prefRow);
    },

    async createLinkToken(userId, tokenHash, expiresAtISO) {
      // One pending code per user: asking for a new one replaces the old.
      await pool.query('DELETE FROM alert_link_tokens WHERE user_id = $1 OR expires_at < NOW()', [userId]);
      await pool.query(
        'INSERT INTO alert_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, userId, expiresAtISO]
      );
    },

    async consumeLinkToken(tokenHash, nowISO) {
      const r = await pool.query(
        'DELETE FROM alert_link_tokens WHERE token_hash = $1 RETURNING user_id AS "userId", expires_at AS "expiresAt"',
        [tokenHash]
      );
      const row = r.rows[0];
      if (!row || new Date(row.expiresAt).toISOString() <= nowISO) return null;
      return row.userId;
    },

    async claimAlert(userId, key, atISO) {
      const r = await pool.query(
        `INSERT INTO user_alerts_sent (user_id, item_key, sent_at) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_key) DO NOTHING RETURNING item_key`,
        [userId, key, atISO]
      );
      return r.rowCount === 1;
    },

    async releaseAlert(userId, key) {
      await pool.query('DELETE FROM user_alerts_sent WHERE user_id = $1 AND item_key = $2', [userId, key]);
    },

    async countSentSince(userId, sinceISO) {
      const r = await pool.query(
        'SELECT COUNT(*)::int AS n FROM user_alerts_sent WHERE user_id = $1 AND sent_at >= $2',
        [userId, sinceISO]
      );
      return r.rows[0].n;
    },

    async pruneSentBefore(cutoffISO) {
      const r = await pool.query('DELETE FROM user_alerts_sent WHERE sent_at < $1', [cutoffISO]);
      return r.rowCount;
    },
  };
}

// ─── Shared core for the two object-backed adapters (JSON-file, in-memory) ───

function createObjectBackedAlertStore({ read, write }) {
  const sameUser = userId => row => String(row.userId) === String(userId);

  function mutate(fn) {
    const state = read();
    const result = fn(state);
    write(state);
    return result;
  }

  function upsertPrefs(state, userId, patch) {
    const idx  = state.prefs.findIndex(sameUser(userId));
    const next = { ...PREF_DEFAULTS, ...(idx >= 0 ? state.prefs[idx] : {}), ...patch, userId };
    if (idx >= 0) state.prefs[idx] = next; else state.prefs.push(next);
    return next;
  }

  return {
    async getPrefs(userId) {
      return read().prefs.find(sameUser(userId)) ?? null;
    },

    async savePrefs(userId, patch) {
      const only = {};
      if (typeof patch.vipEnabled === 'boolean')    only.vipEnabled = patch.vipEnabled;
      if (typeof patch.reviewEnabled === 'boolean') only.reviewEnabled = patch.reviewEnabled;
      return mutate(state => upsertPrefs(state, userId, only));
    },

    async linkTelegram(userId, chatId, atISO) {
      return mutate(state => upsertPrefs(state, userId, { telegramChatId: String(chatId), telegramLinkedAt: atISO }));
    },

    async unlinkTelegram(userId) {
      mutate(state => {
        if (state.prefs.some(sameUser(userId))) upsertPrefs(state, userId, { telegramChatId: null, telegramLinkedAt: null });
      });
    },

    async listLinked() {
      return read().prefs.filter(p => p.telegramChatId && (p.vipEnabled || p.reviewEnabled));
    },

    async createLinkToken(userId, tokenHash, expiresAtISO) {
      mutate(state => {
        const now = new Date().toISOString();
        state.tokens = state.tokens.filter(t => !sameUser(userId)(t) && t.expiresAt > now);
        state.tokens.push({ tokenHash, userId, expiresAt: expiresAtISO });
      });
    },

    async consumeLinkToken(tokenHash, nowISO) {
      return mutate(state => {
        const found = state.tokens.find(t => t.tokenHash === tokenHash);
        if (!found) return null;
        state.tokens = state.tokens.filter(t => t !== found);
        return found.expiresAt > nowISO ? found.userId : null;
      });
    },

    async claimAlert(userId, key, atISO) {
      return mutate(state => {
        if (state.sent.some(s => sameUser(userId)(s) && s.key === key)) return false;
        state.sent.push({ userId, key, sentAt: atISO });
        return true;
      });
    },

    async releaseAlert(userId, key) {
      mutate(state => { state.sent = state.sent.filter(s => !(sameUser(userId)(s) && s.key === key)); });
    },

    async countSentSince(userId, sinceISO) {
      return read().sent.filter(s => sameUser(userId)(s) && s.sentAt >= sinceISO).length;
    },

    async pruneSentBefore(cutoffISO) {
      return mutate(state => {
        const before = state.sent.length;
        state.sent = state.sent.filter(s => s.sentAt >= cutoffISO);
        return before - state.sent.length;
      });
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

const emptyState = () => ({ prefs: [], tokens: [], sent: [] });

export function createJsonFileAlertStore(filePath) {
  return createObjectBackedAlertStore({
    read() {
      if (!existsSync(filePath)) return emptyState();
      try { return { ...emptyState(), ...JSON.parse(readFileSync(filePath, 'utf8')) }; }
      catch { return emptyState(); }
    },
    write(state) {
      writeFileSync(filePath, JSON.stringify(state, null, 2));
    },
  });
}

// ─── In-memory adapter — tests only ───────────────────────────────────────────

export function createInMemoryAlertStore() {
  let state = emptyState();
  return createObjectBackedAlertStore({
    read: () => structuredClone(state),
    write: next => { state = next; },
  });
}
