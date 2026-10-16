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
  else if (previousSecretSet) hint = 'Everything readable is on the current secret. You can remove ENCRYPTION_SECRET_PREVIOUS and redeploy.';
  else hint = 'Nothing to move.';

  return {
    headline: parts.length ? parts.join('; ') : `All ${total} saved value${total === 1 ? ' is' : 's are'} on the current secret`,
    hint,
    canReencrypt: toMove > 0,
  };
}
