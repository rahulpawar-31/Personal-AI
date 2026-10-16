// What the admin page says about the stored-key secret, from
// GET /api/admin/encryption: { total, onCurrent, toMove, unreadable, previousSecretSet }.
// Returns null when there is nothing to say (no rotation under way and nothing to move).
export function encryptionSummary(status) {
  if (!status || typeof status.total !== 'number') return null;
  const { total, toMove = 0, unreadable = 0, previousSecretSet = false } = status;
  if (!previousSecretSet && toMove === 0 && unreadable === 0) return null;

  const parts = [];
  if (toMove > 0) parts.push(`${toMove} of ${total} saved value${total === 1 ? '' : 's'} still on the old secret or format`);
  if (unreadable > 0) parts.push(`${unreadable} can no longer be read and need to be saved again`);

  let hint;
  if (toMove > 0) hint = 'Re-encrypt moves them to the current secret. Do this before removing the previous secret.';
  // The values that cannot be read are the case that matters most after the secret was changed by
  // mistake, so say how to get them back instead of "nothing to move".
  else if (unreadable > 0 && !previousSecretSet) {
    hint = 'If ENCRYPTION_SECRET was changed recently, set ENCRYPTION_SECRET_PREVIOUS to the old value and redeploy: the values open again and can then be re-encrypted. Otherwise each person needs to save the key again.';
  } else if (unreadable > 0) {
    hint = 'These open with neither the current nor the previous secret. If an even older secret was used, put it in ENCRYPTION_SECRET_PREVIOUS; otherwise each person needs to save the key again. Everything else is on the current secret.';
  } else if (previousSecretSet) hint = 'Everything readable is on the current secret. You can remove ENCRYPTION_SECRET_PREVIOUS and redeploy.';
  else hint = 'Nothing to move.';

  return {
    headline: parts.length ? parts.join('; ') : `All ${total} saved value${total === 1 ? ' is' : 's are'} on the current secret`,
    hint,
    canReencrypt: toMove > 0,
  };
}
