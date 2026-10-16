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
const DEV_FALLBACK_SECRET = 'devos-local-dev-fallback-do-not-use-in-prod';
const deriveKey = secret => crypto.scryptSync(secret, 'devos-aes-salt-v1', 32);

const ALGORITHM = 'aes-256-gcm';
const CIPHERTEXT_VERSION = 'v1';

function seal(key, plaintext) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const body   = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  // Format: v1:<iv>:<authTag>:<ciphertext>  — all base64url so safe to store anywhere.
  // The version prefix says which layout produced the value. Values written
  // before the prefix existed have no "v1:" and are still read.
  return `${CIPHERTEXT_VERSION}:${iv.toString('base64url')}:${tag.toString('base64url')}:${body.toString('base64url')}`;
}

// Splits a stored value into its parts, or throws for a shape we do not know.
function parse(ciphertext) {
  let parts = String(ciphertext).split(':');
  let versioned = false;
  if (parts.length === 4) {
    if (parts[0] !== CIPHERTEXT_VERSION) throw new Error(`Unsupported ciphertext version "${parts[0].slice(0, 8)}"`);
    parts = parts.slice(1);
    versioned = true;
  }
  if (parts.length !== 3) throw new Error('Ciphertext format invalid');
  const [ivB64, tagB64, bodyB64] = parts;
  return {
    versioned,
    iv: Buffer.from(ivB64, 'base64url'),
    tag: Buffer.from(tagB64, 'base64url'),
    body: Buffer.from(bodyB64, 'base64url'),
  };
}

function open(key, { iv, tag, body }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// A cipher that writes with `secret` and can still read values written with
// `previousSecret`, so the secret can be rotated without making saved values
// unreadable: set the new secret, keep the old one as previous, re-encrypt
// (services/reencrypt.js), then drop the previous one.
export function createCipher({ secret, previousSecret } = {}) {
  const key = deriveKey(secret || DEV_FALLBACK_SECRET);
  const previousKey = previousSecret && previousSecret !== secret ? deriveKey(previousSecret) : null;

  // Which key opened the value, and whether it has the current layout.
  // A value that matches neither key throws; so does a shape we do not know.
  function inspect(ciphertext) {
    const parsed = parse(ciphertext);
    try {
      return { plaintext: open(key, parsed), key: 'current', versioned: parsed.versioned };
    } catch (err) {
      if (!previousKey) throw err;
      try {
        return { plaintext: open(previousKey, parsed), key: 'previous', versioned: parsed.versioned };
      } catch {
        throw err; // report the current key's failure
      }
    }
  }

  return {
    hasPreviousSecret: Boolean(previousKey),
    encrypt: plaintext => seal(key, plaintext),
    decrypt: ciphertext => inspect(ciphertext).plaintext,
    inspect,
    // True when a stored value should be rewritten: it opened only with the
    // previous secret, or it predates the version prefix.
    needsReencrypt(ciphertext) {
      const info = inspect(ciphertext);
      return info.key === 'previous' || !info.versioned;
    },
  };
}

const defaultCipher = createCipher({
  secret: SECRET,
  previousSecret: process.env.ENCRYPTION_SECRET_PREVIOUS,
});

if (defaultCipher.hasPreviousSecret) {
  console.log(
    '[encryption] ENCRYPTION_SECRET_PREVIOUS is set: values saved under it are still readable. ' +
    'Re-encrypt from the admin page, then remove it.'
  );
}

export const hasPreviousSecret = defaultCipher.hasPreviousSecret;
export const encrypt = defaultCipher.encrypt;
export const decrypt = defaultCipher.decrypt;
export const needsReencrypt = defaultCipher.needsReencrypt;
export const inspectCiphertext = defaultCipher.inspect;
