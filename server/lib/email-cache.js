import { getPool } from '../services/db.js';

export const EMAIL_TTL = 5 * 60 * 1000; // 5 minutes

// In-process hot cache — avoids DB round-trips within the same process.
const _emailCache = new Map();

export async function getEmailCache(userId) {
  // Hot cache hit
  const hot = _emailCache.get(userId);
  if (hot && Date.now() - hot.at < EMAIL_TTL) return hot;

  // DB fallback — survives server restarts
  const pool = getPool();
  if (pool) {
    try {
      const r = await pool.query(
        'SELECT data, fetched_at FROM email_cache WHERE user_id = $1',
        [userId]
      );
      if (r.rows[0]) {
        const at = new Date(r.rows[0].fetched_at).getTime();
        if (Date.now() - at < EMAIL_TTL) {
          const entry = { data: r.rows[0].data, at };
          _emailCache.set(userId, entry);
          return entry;
        }
      }
    } catch { /* DB unavailable — fall back to the null (cache miss) below */ }
  }

  return null;
}

export async function setEmailCache(userId, data) {
  const entry = { data, at: Date.now() };
  _emailCache.set(userId, entry);

  const pool = getPool();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO email_cache (user_id, data, fetched_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET data = $2, fetched_at = NOW()`,
        [userId, JSON.stringify(data)]
      );
    } catch { /* best-effort DB write — hot cache above already has this entry */ }
  }
}

export async function invalidateEmailCache(userId) {
  _emailCache.delete(userId);

  const pool = getPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM email_cache WHERE user_id = $1', [userId]);
    } catch { /* best-effort — hot cache above is already invalidated */ }
  }
}
