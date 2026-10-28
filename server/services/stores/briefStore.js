// server/services/stores/briefStore.js
// BriefStore: the morning brief's per-user state. One interface (getPrefs,
// savePrefs, listPrefs, claimBrief, saveDigest, getDigest), three adapters,
// same pattern as userStore.js.
//
//   prefs  - the user's brief settings and the local date of the last brief sent
//   digest - the latest digest, kept so the app can show it after a restart
//
// claimBrief(userId, date) is the once-a-day guard: it records `date` as sent
// and says whether this caller was the one to record it. Two ticks, or two
// processes, cannot both get true for the same user and date.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const PREF_DEFAULTS = { enabled: true, time: '09:00', timezone: null, channel: 'slack', lastSentDate: null };

// ─── Postgres adapter ─────────────────────────────────────────────────────────

const PREF_COLUMNS = `user_id AS "userId", enabled, brief_time AS "time", timezone, channel,
                      last_sent_date AS "lastSentDate"`;

export function createPostgresBriefStore(pool) {
  async function getPrefs(userId) {
    const r = await pool.query(`SELECT ${PREF_COLUMNS} FROM user_brief_prefs WHERE user_id = $1`, [userId]);
    return r.rows[0] ?? null;
  }

  return {
    getPrefs,

    // Merges `patch` over what is saved (or the defaults). Leaves last_sent_date alone.
    async savePrefs(userId, patch) {
      const next = { ...PREF_DEFAULTS, ...((await getPrefs(userId)) ?? {}), ...patch };
      const r = await pool.query(
        `INSERT INTO user_brief_prefs (user_id, enabled, brief_time, timezone, channel)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, brief_time = EXCLUDED.brief_time,
               timezone = EXCLUDED.timezone, channel = EXCLUDED.channel, updated_at = NOW()
         RETURNING ${PREF_COLUMNS}`,
        [userId, next.enabled, next.time, next.timezone, next.channel]
      );
      return r.rows[0];
    },

    async listPrefs() {
      const r = await pool.query(`SELECT ${PREF_COLUMNS} FROM user_brief_prefs`);
      return r.rows;
    },

    async claimBrief(userId, date) {
      const r = await pool.query(
        `INSERT INTO user_brief_prefs (user_id, last_sent_date) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET last_sent_date = EXCLUDED.last_sent_date
           WHERE user_brief_prefs.last_sent_date IS DISTINCT FROM EXCLUDED.last_sent_date
         RETURNING user_id`,
        [userId, date]
      );
      return r.rowCount === 1;
    },

    async saveDigest(userId, digest) {
      await pool.query(
        `INSERT INTO user_digests (user_id, data, generated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, generated_at = NOW()`,
        [userId, JSON.stringify(digest)]
      );
    },

    async getDigest(userId) {
      const r = await pool.query('SELECT data FROM user_digests WHERE user_id = $1', [userId]);
      return r.rows[0]?.data ?? null;
    },
  };
}

// ─── Shared core for the two array/object-backed adapters ─────────────────────

function createFileBackedBriefStore({ readPrefs, writePrefs, readDigests, writeDigests }) {
  const sameUser = userId => row => String(row.userId) === String(userId);

  return {
    async getPrefs(userId) {
      return readPrefs().find(sameUser(userId)) ?? null;
    },

    async savePrefs(userId, patch) {
      const rows = readPrefs();
      const idx  = rows.findIndex(sameUser(userId));
      const next = { ...PREF_DEFAULTS, ...(idx >= 0 ? rows[idx] : {}), ...patch, userId };
      if (idx >= 0) rows[idx] = next; else rows.push(next);
      writePrefs(rows);
      return next;
    },

    async listPrefs() {
      return readPrefs();
    },

    async claimBrief(userId, date) {
      const rows = readPrefs();
      const idx  = rows.findIndex(sameUser(userId));
      if (idx >= 0 && rows[idx].lastSentDate === date) return false;
      if (idx >= 0) rows[idx] = { ...rows[idx], lastSentDate: date };
      else rows.push({ ...PREF_DEFAULTS, userId, lastSentDate: date });
      writePrefs(rows);
      return true;
    },

    async saveDigest(userId, digest) {
      const all = readDigests();
      all[String(userId)] = digest;
      writeDigests(all);
    },

    async getDigest(userId) {
      return readDigests()[String(userId)] ?? null;
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

export function createJsonFileBriefStore(prefsPath, digestsPath) {
  return createFileBackedBriefStore({
    readPrefs:    () => readJson(prefsPath, []),
    writePrefs:   rows => writeFileSync(prefsPath, JSON.stringify(rows, null, 2)),
    readDigests:  () => readJson(digestsPath, {}),
    writeDigests: all => writeFileSync(digestsPath, JSON.stringify(all, null, 2)),
  });
}

// ─── In-memory adapter — tests only ───────────────────────────────────────────

export function createInMemoryBriefStore() {
  let prefs = [];
  let digests = {};
  return createFileBackedBriefStore({
    readPrefs:    () => prefs.map(r => ({ ...r })),
    writePrefs:   rows => { prefs = rows; },
    readDigests:  () => ({ ...digests }),
    writeDigests: all => { digests = all; },
  });
}
