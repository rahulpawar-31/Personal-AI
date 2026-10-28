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
// claimCalendarCheck and claimWrapup are the same guard for the 7 AM calendar
// check and the end-of-day wrap-up, kept apart so the daily jobs never block
// each other. saveWrapup/getWrapup keep the latest wrap-up, like saveDigest.
import { readFileSync, writeFileSync, existsSync } from 'fs';

const PREF_DEFAULTS = {
  enabled: true, time: '09:00', timezone: null, channel: 'slack',
  wrapupEnabled: false, wrapupTime: '17:30',
  lastSentDate: null, lastCalendarCheckDate: null, lastWrapupDate: null,
};

// ─── Postgres adapter ─────────────────────────────────────────────────────────

const PREF_COLUMNS = `user_id AS "userId", enabled, brief_time AS "time", timezone, channel,
                      wrapup_enabled AS "wrapupEnabled", wrapup_time AS "wrapupTime",
                      last_sent_date AS "lastSentDate",
                      last_calendar_check_date AS "lastCalendarCheckDate",
                      last_wrapup_date AS "lastWrapupDate"`;

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
        `INSERT INTO user_brief_prefs (user_id, enabled, brief_time, timezone, channel, wrapup_enabled, wrapup_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE
           SET enabled = EXCLUDED.enabled, brief_time = EXCLUDED.brief_time,
               timezone = EXCLUDED.timezone, channel = EXCLUDED.channel,
               wrapup_enabled = EXCLUDED.wrapup_enabled, wrapup_time = EXCLUDED.wrapup_time,
               updated_at = NOW()
         RETURNING ${PREF_COLUMNS}`,
        [userId, next.enabled, next.time, next.timezone, next.channel, next.wrapupEnabled, next.wrapupTime]
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

    async claimCalendarCheck(userId, date) {
      const r = await pool.query(
        `INSERT INTO user_brief_prefs (user_id, last_calendar_check_date) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET last_calendar_check_date = EXCLUDED.last_calendar_check_date
           WHERE user_brief_prefs.last_calendar_check_date IS DISTINCT FROM EXCLUDED.last_calendar_check_date
         RETURNING user_id`,
        [userId, date]
      );
      return r.rowCount === 1;
    },

    async claimWrapup(userId, date) {
      const r = await pool.query(
        `INSERT INTO user_brief_prefs (user_id, last_wrapup_date) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET last_wrapup_date = EXCLUDED.last_wrapup_date
           WHERE user_brief_prefs.last_wrapup_date IS DISTINCT FROM EXCLUDED.last_wrapup_date
         RETURNING user_id`,
        [userId, date]
      );
      return r.rowCount === 1;
    },

    // Gives the day back after a failed run so a later tick can try again. Does
    // nothing if a newer date has been claimed since.
    async releaseWrapup(userId, date) {
      await pool.query(
        'UPDATE user_brief_prefs SET last_wrapup_date = NULL WHERE user_id = $1 AND last_wrapup_date = $2',
        [userId, date]
      );
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

    async saveWrapup(userId, wrapup) {
      await pool.query(
        `INSERT INTO user_wrapups (user_id, data, generated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, generated_at = NOW()`,
        [userId, JSON.stringify(wrapup)]
      );
    },

    async getWrapup(userId) {
      const r = await pool.query('SELECT data FROM user_wrapups WHERE user_id = $1', [userId]);
      return r.rows[0]?.data ?? null;
    },
  };
}

// ─── Shared core for the two array/object-backed adapters ─────────────────────

function createFileBackedBriefStore({ readPrefs, writePrefs, readDigests, writeDigests, readWrapups, writeWrapups }) {
  const sameUser = userId => row => String(row.userId) === String(userId);

  // Record `date` in `field` for the user; false if it was already that date.
  function claim(field, userId, date) {
    const rows = readPrefs();
    const idx  = rows.findIndex(sameUser(userId));
    if (idx >= 0 && rows[idx][field] === date) return false;
    if (idx >= 0) rows[idx] = { ...rows[idx], [field]: date };
    else rows.push({ ...PREF_DEFAULTS, userId, [field]: date });
    writePrefs(rows);
    return true;
  }

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

    claimBrief:         async (userId, date) => claim('lastSentDate', userId, date),
    claimCalendarCheck: async (userId, date) => claim('lastCalendarCheckDate', userId, date),
    claimWrapup:        async (userId, date) => claim('lastWrapupDate', userId, date),

    async releaseWrapup(userId, date) {
      const rows = readPrefs();
      const idx  = rows.findIndex(sameUser(userId));
      if (idx < 0 || rows[idx].lastWrapupDate !== date) return;
      rows[idx] = { ...rows[idx], lastWrapupDate: null };
      writePrefs(rows);
    },

    async saveWrapup(userId, wrapup) {
      const all = readWrapups();
      all[String(userId)] = wrapup;
      writeWrapups(all);
    },

    async getWrapup(userId) {
      return readWrapups()[String(userId)] ?? null;
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

export function createJsonFileBriefStore(prefsPath, digestsPath, wrapupsPath) {
  return createFileBackedBriefStore({
    readPrefs:    () => readJson(prefsPath, []),
    writePrefs:   rows => writeFileSync(prefsPath, JSON.stringify(rows, null, 2)),
    readDigests:  () => readJson(digestsPath, {}),
    writeDigests: all => writeFileSync(digestsPath, JSON.stringify(all, null, 2)),
    readWrapups:  () => readJson(wrapupsPath, {}),
    writeWrapups: all => writeFileSync(wrapupsPath, JSON.stringify(all, null, 2)),
  });
}

// ─── In-memory adapter — tests only ───────────────────────────────────────────

export function createInMemoryBriefStore() {
  let prefs = [];
  let digests = {};
  let wrapups = {};
  return createFileBackedBriefStore({
    readPrefs:    () => prefs.map(r => ({ ...r })),
    writePrefs:   rows => { prefs = rows; },
    readDigests:  () => ({ ...digests }),
    writeDigests: all => { digests = all; },
    readWrapups:  () => ({ ...wrapups }),
    writeWrapups: all => { wrapups = all; },
  });
}
