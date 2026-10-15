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
  let unreadable = 0;
  for (const { keyName, keyValue } of rows) {
    try { creds[keyName] = decrypt(keyValue); }
    catch { unreadable += 1; } // skipped — but not silently, see the warning below
  }
  // After ENCRYPTION_SECRET changes every key fails to decrypt and every
  // integration looks "not connected". Say so in the log (never the values).
  if (unreadable > 0) {
    console.warn(`[integrations] ${unreadable} saved key(s) for user ${userId} could not be decrypted — was ENCRYPTION_SECRET changed?`);
  }
  return creds;
}

/** Ids of every user who has stored at least one key for `service`. */
export async function listUserIdsWithService(service) {
  return currentStore().listUserIdsForService(service);
}

/**
 * Total number of saved keys in a listKeysWithMeta() result. That result is
 * { service: { keyName: meta } }, so it has no .length — count the key names.
 */
export function countSavedKeys(keysWithMeta) {
  return Object.values(keysWithMeta ?? {}).reduce((n, svc) => n + Object.keys(svc).length, 0);
}

// The key whose state decides whether a service counts as connected. These are
// the same keys the Settings rows use (primaryKey / keyName in SettingsPage.jsx),
// so the admin page and Settings never disagree. A service not listed here is
// connected if any of its keys is readable, so a new service never disappears.
const PRIMARY_KEY = {
  gemini:   'GEMINI_API_KEY',
  groq:     'GROQ_API_KEY',
  todoist:  'TODOIST_API_KEY',
  notion:   'NOTION_API_KEY',
  github:   'GITHUB_TOKEN',
  trello:   'TRELLO_API_KEY',
  slack:    'SLACK_BOT_TOKEN',
  linkedin: 'LINKEDIN_WEBHOOK_URL',
  google:   'GOOGLE_OAUTH_TOKENS',
};

function isServiceConnected(service, keys) {
  const primary = PRIMARY_KEY[service];
  if (primary) return Boolean(keys[primary]) && !keys[primary].unreadable;
  return Object.values(keys).some(meta => !meta?.unreadable);
}

/**
 * Names of the services a listKeysWithMeta() result has a working connection
 * for, sorted. Only service names leave this function (never key names, hints or
 * values), so the admin page can show what an account uses. Matches Settings: a
 * service is connected when its primary key is saved and still decrypts, so a
 * readable secondary key (e.g. GITHUB_REPO) does not make it connected.
 */
export function connectedServices(keysWithMeta) {
  return Object.entries(keysWithMeta ?? {})
    .filter(([service, keys]) => isServiceConnected(service, keys))
    .map(([service]) => service)
    .sort();
}

/**
 * One row per saved key, for the admin page: { service, keyName, updatedAt,
 * unreadable, serviceConnected }, sorted by service then key name.
 * `serviceConnected` is the same answer connectedServices() gives for that
 * row's service, so the key dialog and the Connected column agree. The masked
 * hint and the value are deliberately left out, so an admin can see what an
 * account has connected without seeing any part of a secret.
 */
export function describeKeys(keysWithMeta) {
  const connected = new Set(connectedServices(keysWithMeta));
  const rows = [];
  for (const [service, keys] of Object.entries(keysWithMeta ?? {})) {
    for (const [keyName, meta] of Object.entries(keys)) {
      rows.push({
        service, keyName,
        updatedAt: meta?.updatedAt ?? null,
        unreadable: Boolean(meta?.unreadable),
        serviceConnected: connected.has(service),
      });
    }
  }
  return rows.sort((a, b) => a.service.localeCompare(b.service) || a.keyName.localeCompare(b.keyName));
}

/** Delete all keys for a service (disconnect). */
export async function deleteService(userId, service) {
  await currentStore().deleteAllForService(userId, service);
}

/**
 * List keys with metadata (updatedAt + masked key hint) for the settings UI.
 * Returns { service: { keyName: { updatedAt, keyHint, unreadable? } } }.
 * `unreadable: true` means the stored value could not be decrypted, so the UI
 * can ask the user to re-enter it instead of showing a healthy connection.
 */
export async function listKeysWithMeta(userId) {
  const rows   = await currentStore().listForUser(userId);
  const result = {};
  for (const row of rows) {
    let meta;
    try {
      meta = { updatedAt: row.updatedAt, keyHint: maskKey(decrypt(row.keyValue)) };
    } catch {
      meta = { updatedAt: row.updatedAt, keyHint: '••••••••', unreadable: true };
    }
    if (!result[row.service]) result[row.service] = {};
    result[row.service][row.keyName] = meta;
  }
  return result;
}

/**
 * A hint that shows at most a sixth of the value from each end, so the
 * revealed part stays small however short the secret is. A 10-character key
 * shows 1 + 1 characters, a 24+ character key 4 + 4, and anything under 6
 * characters shows none.
 */
export function maskKey(plain) {
  const shown = Math.min(4, Math.floor(plain.length / 6));
  if (shown === 0) return '••••••••';
  return `${plain.slice(0, shown)}••••${plain.slice(-shown)}`;
}
