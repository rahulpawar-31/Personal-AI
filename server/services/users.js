// server/services/users.js
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { dbCreateUser, dbFindByUsername, dbFindById, dbUpdateEmail, dbUpdatePasswordHash, dbDeleteUser, dbBumpTokenVersion, dbFindByGoogleId, dbFindByEmail, dbLinkGoogleId, dbCreateGoogleUser } from './db.js';
import { isHttps } from '../lib/env.js';

export { dbFindByGoogleId, dbFindByEmail, dbLinkGoogleId, dbCreateGoogleUser };

// Dev-only fallback (production refuses to start without JWT_SECRET, see
// lib/startupConfig.js). Random bytes, so it cannot be guessed from the clock.
const _jwtFallback = crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — using temporary secret; tokens will invalidate on restart');
}

export function getJwtSecret() {
  return process.env.JWT_SECRET || _jwtFallback;
}

const SALT_ROUNDS = 12;

// Lowercased on both sides because dbCreateUser stores usernames lowercased.
export function isSignupAllowed(username, ownerUsername) {
  if (!ownerUsername) return true;
  return username.trim().toLowerCase() === ownerUsername.trim().toLowerCase();
}

export async function createUser(username, password, email) {
  if (!username?.trim())          throw new Error('Username is required');
  if (!/^\w{3,32}$/.test(username.trim())) throw new Error('Username must be 3–32 characters (letters, numbers, underscores)');
  if (!password?.trim())                    throw new Error('Password cannot be blank or only spaces');
  if (password.length < 8)                 throw new Error('Password must be at least 8 characters');

  // PRD P0: this is a single-owner tool with zero intended signups right now —
  // open registration let a stranger get a valid JWT for a live production
  // instance. When OWNER_USERNAME is set (production), only that account may
  // sign up. Unset in dev/CI (see server/tests/smoke-auth.sh), where open
  // signup is expected and harmless.
  if (!isSignupAllowed(username, process.env.OWNER_USERNAME)) {
    throw new Error('Signups are currently invite-only.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    return await dbCreateUser({ username: username.trim(), email: email?.trim() || null, passwordHash });
  } catch (err) {
    if (err.code === '23505' || err.message?.includes('unique') || err.message?.includes('already taken')) {
      throw new Error('Username already taken — please choose another');
    }
    throw err;
  }
}

// A sign-in that failed because of what the caller sent (wrong or missing
// credentials). Anything else thrown while signing in (a database error, say) is
// the server's fault and must not be reported or counted as a failed attempt.
export class LoginError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LoginError';
  }
}

// 401 for a credential failure, 503 for everything else.
export function loginFailureStatus(err) {
  return err instanceof LoginError ? 401 : 503;
}

export async function loginUser(username, password) {
  if (!username || !password) throw new LoginError('Username and password are required');
  const user = await dbFindByUsername(username);
  if (!user) throw new LoginError('Invalid username or password');

  // Handle both Postgres (snake_case) and JSON file (camelCase) schemas
  const hash = user.password_hash ?? user.passwordHash;
  if (hash === 'GOOGLE_AUTH_ONLY') throw new LoginError('This account uses Google sign-in. Click "Continue with Google" below.');
  const ok   = await bcrypt.compare(password, hash);
  if (!ok) throw new LoginError('Invalid username or password');

  return { id: user.id, username: user.username, email: user.email ?? null, tokenVersion: tokenVersionOf(user) };
}

// A user row is snake_case from Postgres and camelCase from the JSON file.
// Accounts that predate the column have no number, which counts as 0.
export function tokenVersionOf(row) {
  return Number(row?.token_version ?? row?.tokenVersion ?? 0) || 0;
}

// Short-lived access token — sent in response body, stored in localStorage by frontend.
export function signToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, type: 'access' }, getJwtSecret(), { expiresIn: '15m' });
}

// Long-lived refresh token — sent as httpOnly cookie only.
export function signRefreshToken(user) {
  return jwt.sign({ userId: user.id, username: user.username, type: 'refresh', tv: user.tokenVersion ?? 0 }, getJwtSecret(), { expiresIn: '30d' });
}

// A refresh token only works while its number matches the account's. Raising
// the account's number (endSessions) therefore ends every session at once.
// Tokens issued before this existed have no number, which counts as 0.
export function refreshTokenIsCurrent(payload, account) {
  return (payload?.tv ?? 0) === (account?.tokenVersion ?? 0);
}

// Ends every session of a user: their refresh tokens stop working at once.
// Access tokens already handed out last until they expire (15 minutes).
// Returns the new number, or null if the user does not exist.
export async function endSessions(userId) {
  return dbBumpTokenVersion(userId);
}

// Who is logging out. The access token may already have expired (that is a
// common reason to log out), so expiry is ignored, but the signature is not,
// and a refresh token is refused. Worst case a stolen old token signs its
// owner out, which gives an attacker nothing.
export function identifyForLogout(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { ignoreExpiration: true });
    if (payload.type === 'refresh' || !payload.userId) return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

// For Authorization: Bearer. A refresh token must never work here: it lives 30
// days, so accepting it would turn one leaked cookie into a month of API access.
// Tokens with no type are access tokens issued before the type claim existed.
export function verifyAccessToken(token) {
  const payload = verifyToken(token);
  if (payload.type === 'refresh') throw new Error('Refresh token cannot be used as an access token');
  return payload;
}

// Set the httpOnly refresh cookie on a response.
export function setRefreshCookie(res, user) {
  res.cookie('refresh_token', signRefreshToken(user), {
    httpOnly:  true,
    sameSite:  'lax',
    secure:    isHttps(),
    maxAge:    30 * 24 * 60 * 60 * 1000, // 30 days in ms
    path:      '/api/auth/refresh',
  });
}

// Clear the refresh cookie on logout.
export function clearRefreshCookie(res) {
  res.clearCookie('refresh_token', { httpOnly: true, sameSite: 'lax', path: '/api/auth/refresh' });
}

export async function getUserById(id) {
  return dbFindById(id);
}

export async function updateEmail(userId, email) {
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new Error('Invalid email format');
  }
  await dbUpdateEmail(userId, email?.trim() || null);
}

// Ends the other sessions BEFORE saving the new password. If the second step
// fails the account is left with its old password and its sessions ended, which
// is safe; the other order could save the password, fail to end the sessions,
// and report an error while old sessions keep working. Returns the new number.
export async function applyPasswordChange(userId, newHash, deps = { endSessions, saveHash: dbUpdatePasswordHash }) {
  const tokenVersion = await deps.endSessions(userId);
  await deps.saveHash(userId, newHash);
  return tokenVersion ?? 0;
}

export async function updatePassword(userId, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) throw new Error('Both current and new password are required');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');
  const user = await dbFindById(userId);
  if (!user) throw new Error('User not found');
  const fullUser = await dbFindByUsername(user.username);
  const hash = fullUser.password_hash ?? fullUser.passwordHash;
  const ok = await bcrypt.compare(currentPassword, hash);
  if (!ok) throw new Error('Current password is incorrect');
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // The caller gets the new number so it can keep the current session signed in.
  const tokenVersion = await applyPasswordChange(userId, newHash);
  return { id: user.id, username: user.username, tokenVersion };
}

export async function deleteUser(userId, password) {
  if (!password) throw new Error('Password is required');
  const user = await dbFindById(userId);
  if (!user) throw new Error('User not found');
  const fullUser = await dbFindByUsername(user.username);
  const hash = fullUser.password_hash ?? fullUser.passwordHash;
  if (hash === 'GOOGLE_AUTH_ONLY') throw new Error('This account uses Google sign-in — no password to verify. Contact support to delete it.');
  const ok = await bcrypt.compare(password, hash);
  if (!ok) throw new Error('Password is incorrect');
  await dbDeleteUser(userId);
}
