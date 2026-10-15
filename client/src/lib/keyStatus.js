// A saved key counts as usable only if the server could decrypt it. After the
// server's ENCRYPTION_SECRET changes, keys still exist but are flagged
// `unreadable`; treating them as present would hide the "no AI engine" warning
// while nothing actually works.
export function isUsableKey(meta) {
  return Boolean(meta) && !meta.unreadable;
}
