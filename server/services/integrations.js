// server/services/integrations.js
// Per-user integration key storage.
// Postgres when available; JSON file fallback for local dev.
// Values are AES-256-GCM encrypted at rest. The decrypt key never touches the DB.
//
// Delegates to IntegrationStore (server/services/stores/integrationStore.js)
// for persistence; encryption/decryption and per-caller shaping stay here.
// The store is selected fresh on every call (not cached once at an init
// step, unlike db.js's userStore/pendingActionStore) because this module has
// no init lifecycle of its own — it just asks db.js's getPool() each time,
// exactly as it already did before the store existed.
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';
import { encrypt, decrypt } from './encryption.js';
import {
  createPostgresIntegrationStore, createJsonFileIntegrationStore,
} from './stores/integrationStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE      = path.join(__dirname, '..', 'integrations.json');

function currentStore() {
  const pool = getPool();
  return pool ? createPostgresIntegrationStore(pool) : createJsonFileIntegrationStore(FILE);
}

// ─── Core operations ──────────────────────────────────────────────────────────

/** Save (insert or overwrite) one key for a user. Value is encrypted before storage. */
export async function saveKey(userId, service, keyName, keyValue) {
  await currentStore().set(userId, service, keyName, encrypt(keyValue));
}

/** Get one decrypted value, or null if not stored. */
export async function getKey(userId, service, keyName) {
  const encrypted = await currentStore().get(userId, service, keyName);
  return encrypted ? decrypt(encrypted) : null;
}

/** Delete one key. */
export async function deleteKey(userId, service, keyName) {
  await currentStore().delete(userId, service, keyName);
}

/**
 * List which services + key names are configured for a user.
 * Returns an array of { service, keyName } — values are never included.
 */
export async function listKeys(userId) {
  const rows = await currentStore().listForUser(userId);
  return rows.map(({ service, keyName }) => ({ service, keyName }));
}

/**
 * Get all decrypted keys for a user as a flat object { KEY_NAME: value }.
 * Used at request time to inject credentials into service calls.
 */
export async function getUserCredentials(userId) {
  const rows  = await currentStore().listForUser(userId);
  const creds = {};
  for (const { keyName, keyValue } of rows) {
    try { creds[keyName] = decrypt(keyValue); }
    catch { /* skip corrupted entries */ }
  }
  return creds;
}

/** Delete all keys for a service (disconnect). */
export async function deleteService(userId, service) {
  await currentStore().deleteAllForService(userId, service);
}

/**
 * List keys with metadata (updatedAt + masked key hint) for the settings UI.
 * Returns { service: { keyName: { updatedAt, keyHint } } }.
 */
export async function listKeysWithMeta(userId) {
  const rows   = await currentStore().listForUser(userId);
  const result = {};
  for (const row of rows) {
    let keyHint = '••••••••';
    try {
      const plain = decrypt(row.keyValue);
      keyHint = plain.length >= 10
        ? `${plain.slice(0, 6)}••••${plain.slice(-4)}`
        : `${plain.slice(0, 3)}•••${plain.slice(-2)}`;
    } catch { /* corrupted — leave as dots */ }
    if (!result[row.service]) result[row.service] = {};
    result[row.service][row.keyName] = { updatedAt: row.updatedAt, keyHint };
  }
  return result;
}
