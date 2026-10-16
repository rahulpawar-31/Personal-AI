// server/services/reencrypt.js
// Moves every stored credential to the current ENCRYPTION_SECRET after a
// rotation, and reports how many are left. Works on counts only: it never
// returns, logs or throws a stored value.

function emptyCounts() {
  return { total: 0, onCurrent: 0, toMove: 0, unreadable: 0 };
}

// How the stored values stand right now. `toMove` are readable but written under
// the previous secret or before the version prefix; `unreadable` open with
// neither secret and need the user to save the key again.
export async function encryptionStatus({ store, cipher }) {
  const counts = emptyCounts();
  for (const row of await store.listAll()) {
    counts.total += 1;
    try {
      if (cipher.needsReencrypt(row.keyValue)) counts.toMove += 1;
      else counts.onCurrent += 1;
    } catch {
      counts.unreadable += 1;
    }
  }
  return { ...counts, previousSecretSet: cipher.hasPreviousSecret };
}

// Rewrites each value that needs it under the current secret. Safe to run again:
// a value already on the current secret is left alone, and a value that changed
// between reading and writing is skipped and counted, not overwritten.
export async function reencryptAll({ store, cipher, dryRun = false }) {
  const result = { total: 0, alreadyCurrent: 0, reencrypted: 0, skippedChanged: 0, unreadable: 0, dryRun };
  for (const row of await store.listAll()) {
    result.total += 1;
    let info;
    try {
      info = cipher.inspect(row.keyValue);
    } catch {
      result.unreadable += 1;
      continue;
    }
    if (info.key === 'current' && info.versioned) { result.alreadyCurrent += 1; continue; }
    if (dryRun) { result.reencrypted += 1; continue; }
    const swapped = await store.replaceIfUnchanged(
      row.userId, row.service, row.keyName, row.keyValue, cipher.encrypt(info.plaintext)
    );
    if (swapped) result.reencrypted += 1;
    else result.skippedChanged += 1;
  }
  return result;
}
