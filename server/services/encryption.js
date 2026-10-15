// server/services/encryption.js
// AES-256-GCM authenticated encryption for stored API keys.
// ENCRYPTION_SECRET → 32-byte key via scrypt. Never store the secret in the DB.
import crypto from 'crypto';
import { isProduction } from '../lib/env.js';

const SECRET = process.env.ENCRYPTION_SECRET;

if (!SECRET) {
  if (isProduction()) {
    console.error(
      '[encryption] ENCRYPTION_SECRET is not set in production. Refusing to start — ' +
      'without it, stored credentials would be encrypted under a hardcoded key shipped in source. ' +
      'Set ENCRYPTION_SECRET before deploying.'
    );
    process.exit(1);
  }
  console.warn(
    '[encryption] ENCRYPTION_SECRET not set — using insecure dev fallback. ' +
    'Set this variable in your deployment environment before storing real user keys.'
  );
}

// scrypt derives a fixed 32-byte key from whatever-length secret the user provides.
// Salt is a fixed constant — unique per application, not per record.
// Per-record randomness comes from the 12-byte IV, not the key.
const KEY = crypto.scryptSync(
  SECRET ?? 'devos-local-dev-fallback-do-not-use-in-prod',
  'devos-aes-salt-v1',
  32
);

const ALGORITHM = 'aes-256-gcm';
const CIPHERTEXT_VERSION = 'v1';

export function encrypt(plaintext) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const body   = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  // Format: v1:<iv>:<authTag>:<ciphertext>  — all base64url so safe to store anywhere.
  // The version prefix says which key and layout produced the value, so a later
  // key rotation can read old values with the old key while writing new ones
  // with the new one. Values written before the prefix existed have no "v1:".
  return `${CIPHERTEXT_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${body.toString('base64url')}`;
}

export function decrypt(ciphertext) {
  let parts = ciphertext.split(':');
  if (parts.length === 4) {
    if (parts[0] !== CIPHERTEXT_VERSION) throw new Error(`Unsupported ciphertext version "${parts[0].slice(0, 8)}"`);
    parts = parts.slice(1);
  }
  if (parts.length !== 3) throw new Error('Ciphertext format invalid');
  const [ivB64, tagB64, bodyB64] = parts;
  const iv  = Buffer.from(ivB64,  'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const body = Buffer.from(bodyB64, 'base64url');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
