// server/services/stores/userStore.js
// UserStore: one interface (createUser, findByUsername, findById, updateEmail,
// updatePasswordHash, deleteUser, bumpTokenVersion, findByGoogleId, findByEmail, linkGoogleId,
// createGoogleUser, listUsers, setAdmin, isAdmin), three adapters. Callers
// (server/services/db.js) select one adapter once, at initDB() time — no
// per-call backend branching.
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Postgres adapter — production, Category 3 (remote but owned) ────────────

export function createPostgresUserStore(pool) {
  return {
    async createUser({ username, email, passwordHash }) {
      const lc = username.toLowerCase();
      const r = await pool.query(
        `INSERT INTO users (username, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, username, email, is_active AS "isActive", created_at AS "createdAt"`,
        [lc, email || null, passwordHash]
      );
      return r.rows[0];
    },

    async findByUsername(username) {
      const r = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
      return r.rows[0] ?? null;
    },

    async findById(id) {
      const r = await pool.query(
        `SELECT id, username, email, is_active AS "isActive", created_at AS "createdAt",
                token_version AS "tokenVersion"
         FROM users WHERE id = $1`,
        [id]
      );
      return r.rows[0] ?? null;
    },

    async updateEmail(userId, email) {
      await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email || null, userId]);
    },

    async updatePasswordHash(userId, passwordHash) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    },

    async deleteUser(userId) {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    },

    // Ends every refresh token issued so far: they carry the old number.
    async bumpTokenVersion(userId) {
      const r = await pool.query(
        'UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1 RETURNING token_version',
        [userId]
      );
      return r.rows[0] ? Number(r.rows[0].token_version) : null;
    },

    async findByGoogleId(googleId) {
      const r = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      return r.rows[0] ?? null;
    },

    async findByEmail(email) {
      // Case-insensitive: addresses differ only in case ("Ada@x.com" vs "ada@x.com") but name one mailbox.
      const r = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1', [email]);
      return r.rows[0] ?? null;
    },

    async linkGoogleId(userId, googleId) {
      await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, userId]);
    },

    async createGoogleUser({ username, email, googleId }) {
      const r = await pool.query(
        `INSERT INTO users (username, email, password_hash, google_id)
         VALUES ($1, $2, 'GOOGLE_AUTH_ONLY', $3)
         RETURNING id, username, email, is_active AS "isActive", created_at AS "createdAt"`,
        [username.toLowerCase(), email || null, googleId]
      );
      return r.rows[0];
    },

    async listUsers() {
      const r = await pool.query(
        `SELECT id, username, email, is_active AS "isActive", is_admin AS "isAdmin", created_at AS "createdAt" FROM users ORDER BY id`
      );
      return r.rows;
    },

    async setAdmin(userId, isAdmin) {
      await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [isAdmin, userId]);
    },

    async isAdmin(userId) {
      const r = await pool.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
      return r.rows[0]?.is_admin ?? false;
    },
  };
}

// ─── Shared core for the two array-backed adapters (JSON-file, in-memory) ────
// Same business logic either way; only how rows are read/written differs.
// Ids are a monotonic max(id)+1 counter (never Date.now() — two rows created
// in the same millisecond must not collide).

function createArrayBackedUserStore({ read, write }) {
  function nextId(users) {
    return users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
  }

  function toPublicShape(u) {
    return { id: u.id, username: u.username, email: u.email ?? null, isActive: u.isActive ?? true, createdAt: u.createdAt, tokenVersion: u.tokenVersion ?? 0 };
  }

  return {
    async createUser({ username, email, passwordHash }) {
      const lc = username.toLowerCase();
      const users = read();
      if (users.find(u => u.username === lc)) throw new Error('Username already taken');
      const user = {
        id: nextId(users), username: lc, email: email || null, passwordHash,
        isActive: true, isAdmin: false, createdAt: new Date().toISOString(),
      };
      write([...users, user]);
      return toPublicShape(user);
    },

    async findByUsername(username) {
      const lc = username.toLowerCase();
      return read().find(u => u.username === lc) ?? null;
    },

    async findById(id) {
      const u = read().find(u => String(u.id) === String(id));
      return u ? toPublicShape(u) : null;
    },

    async updateEmail(userId, email) {
      const users = read();
      const idx = users.findIndex(u => String(u.id) === String(userId));
      if (idx < 0) throw new Error('User not found');
      users[idx].email = email || null;
      write(users);
    },

    async updatePasswordHash(userId, passwordHash) {
      const users = read();
      const idx = users.findIndex(u => String(u.id) === String(userId));
      if (idx < 0) throw new Error('User not found');
      users[idx].passwordHash = passwordHash;
      write(users);
    },

    async deleteUser(userId) {
      write(read().filter(u => String(u.id) !== String(userId)));
    },

    async bumpTokenVersion(userId) {
      const users = read();
      const idx = users.findIndex(u => String(u.id) === String(userId));
      if (idx < 0) return null;
      users[idx].tokenVersion = (users[idx].tokenVersion ?? 0) + 1;
      write(users);
      return users[idx].tokenVersion;
    },

    async findByGoogleId(googleId) {
      return read().find(u => u.googleId === googleId) ?? null;
    },

    async findByEmail(email) {
      const wanted = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!wanted) return null;
      return read().find(u => typeof u.email === 'string' && u.email.trim().toLowerCase() === wanted) ?? null;
    },

    async linkGoogleId(userId, googleId) {
      const users = read();
      const idx = users.findIndex(u => String(u.id) === String(userId));
      if (idx >= 0) { users[idx].googleId = googleId; write(users); }
    },

    async createGoogleUser({ username, email, googleId }) {
      const lc = username.toLowerCase();
      const users = read();
      if (users.find(u => u.username === lc)) throw new Error('Username already taken');
      const user = {
        id: nextId(users), username: lc, email: email || null,
        passwordHash: 'GOOGLE_AUTH_ONLY', googleId,
        isActive: true, isAdmin: false, createdAt: new Date().toISOString(),
      };
      write([...users, user]);
      return toPublicShape(user);
    },

    async listUsers() {
      return read().map(u => ({
        id: u.id, username: u.username, email: u.email ?? null,
        isActive: u.isActive ?? true, isAdmin: u.isAdmin ?? false, createdAt: u.createdAt,
      }));
    },

    async setAdmin(userId, isAdmin) {
      const users = read();
      const idx = users.findIndex(u => String(u.id) === String(userId));
      if (idx >= 0) { users[idx].isAdmin = isAdmin; write(users); }
    },

    async isAdmin(userId) {
      const u = read().find(u => String(u.id) === String(userId));
      return u?.isAdmin ?? false;
    },
  };
}

// ─── JSON-file adapter — local dev / CI without DATABASE_URL ─────────────────

export function createJsonFileUserStore(filePath) {
  return createArrayBackedUserStore({
    read() {
      if (!existsSync(filePath)) return [];
      try { return JSON.parse(readFileSync(filePath, 'utf8')); }
      catch { return []; }
    },
    write(users) {
      writeFileSync(filePath, JSON.stringify(users, null, 2));
    },
  });
}

// ─── In-memory adapter — tests only ───────────────────────────────────────────

export function createInMemoryUserStore() {
  let rows = [];
  return createArrayBackedUserStore({
    read: () => rows,
    write: (next) => { rows = next; },
  });
}
