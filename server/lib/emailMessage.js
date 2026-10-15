// server/lib/emailMessage.js
// The single place an outgoing email is assembled. Both the draft and send
// paths use buildRawMessage, so header values are checked and encoded once.
// Recipients, subjects and bodies can come from a request body or from model
// output, so none of them is trusted to be free of line breaks.

export class EmailValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailValidationError';
  }
}

const MAX_ADDRESS_LENGTH  = 254;
const MAX_SUBJECT_LENGTH  = 998;
// One plain address: no whitespace, commas, semicolons, quotes, brackets or
// backslashes, so a value can never name a second recipient or add a display name.
const ADDRESS = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/;

export function isValidAddress(address) {
  return typeof address === 'string'
    && address.length <= MAX_ADDRESS_LENGTH
    && ADDRESS.test(address);
}

// Rejects, never strips: silently removing a line break would send something
// other than what the caller asked for.
function assertSingleLine(label, value) {
  if (/[\r\n\0]/.test(value)) throw new EmailValidationError(`${label} must not contain line breaks`);
}

// RFC 2047 encoded-words: "=?UTF-8?B?...?=" is at most 75 characters, which
// leaves room for 45 raw bytes per word. Split on characters so a multi-byte
// character is never cut in half, and fold the words onto continuation lines.
export function encodeSubject(subject) {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  const words = [];
  let chunk = '';
  for (const ch of subject) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

function wrapBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

// Returns the base64url string the Gmail API expects in `raw`.
export function buildRawMessage({ to, subject, body }) {
  if (!isValidAddress(to)) throw new EmailValidationError('A single valid recipient address is required');
  const subjectText = String(subject ?? '').trim() || '(no subject)';
  assertSingleLine('Subject', subjectText);
  if (subjectText.length > MAX_SUBJECT_LENGTH) throw new EmailValidationError('Subject is too long');
  if (typeof body !== 'string' || !body.trim()) throw new EmailValidationError('Body is required');

  const message = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subjectText)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(body),
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
}
