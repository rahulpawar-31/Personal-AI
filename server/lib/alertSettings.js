// server/lib/alertSettings.js
// Checks for the alert settings requests. No I/O, so each rule is easy to test.

// Request body -> only the switches that were sent, each checked. Throws a
// message the user can act on.
export function validateAlertSettings(body) {
  const src = body && typeof body === 'object' ? body : {};
  const patch = {};
  for (const [field, label] of [['vipEnabled', 'VIP email alerts'], ['reviewEnabled', 'Review request alerts']]) {
    if (field in src) {
      if (typeof src[field] !== 'boolean') throw new Error(`${label} must be on or off`);
      patch[field] = src[field];
    }
  }
  return patch;
}

// A VIP is one plain address: no display name, no angle brackets, one "@".
const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+$/;

export function validateVipEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new Error('Enter one email address, like boss@company.com');
  return email;
}
