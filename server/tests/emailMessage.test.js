import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawMessage, encodeSubject, isValidAddress, EmailValidationError } from '../lib/emailMessage.js';

const decode = raw => Buffer.from(raw, 'base64url').toString('utf8');
const parse = raw => {
  const [head, ...rest] = decode(raw).split('\r\n\r\n');
  return { head, body: rest.join('\r\n\r\n') };
};
const build = (over = {}) => buildRawMessage({ to: 'ada@example.com', subject: 'Hello', body: 'Hi Ada', ...over });

test('a plain message has the expected headers and a decodable body', () => {
  const { head, body } = parse(build());
  assert.match(head, /^To: ada@example\.com\r\nSubject: Hello\r\n/);
  assert.match(head, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(head, /Content-Transfer-Encoding: base64/);
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Hi Ada');
});

test('a line break in the subject is rejected, not stripped', () => {
  for (const subject of ['x\r\nBcc: attacker@example.com', 'x\nBcc: a@b.co', 'x\rBcc: a@b.co']) {
    assert.throws(() => build({ subject }), EmailValidationError);
  }
});

test('the recipient must be exactly one plain address', () => {
  for (const to of [
    'a@b.co\r\nBcc: x@y.co', 'a@b.co,c@d.co', 'a@b.co;c@d.co', 'Ada <a@b.co>',
    '"a b"@c.co', 'no-at-sign', '', null, undefined, 'a@b.co '.repeat(60),
  ]) {
    assert.throws(() => build({ to }), EmailValidationError, String(to));
  }
  assert.ok(isValidAddress('first.last+tag@sub.example.co.uk'));
});

test('an empty body is rejected', () => {
  assert.throws(() => build({ body: '   ' }), /Body is required/);
  assert.throws(() => build({ body: undefined }), EmailValidationError);
});

test('a missing subject falls back to a placeholder', () => {
  assert.match(parse(build({ subject: '  ' })).head, /Subject: \(no subject\)/);
  assert.match(parse(build({ subject: undefined })).head, /Subject: \(no subject\)/);
});

test('a non-ASCII subject is encoded and round-trips', () => {
  const subject = 'Café ☕ réunion — 日本語のテスト 🎉';
  const encoded = encodeSubject(subject);
  assert.match(encoded, /^=\?UTF-8\?B\?/);
  const decoded = encoded.split('\r\n ')
    .map(w => Buffer.from(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''), 'base64').toString('utf8'))
    .join('');
  assert.equal(decoded, subject);
  assert.doesNotMatch(parse(build({ subject })).head.split('\r\n').slice(0, 2).join(''), /[^\x20-\x7e]/);
});

test('a long non-ASCII subject is folded into encoded words of at most 75 characters', () => {
  const subject = '日本語'.repeat(40);
  const words = encodeSubject(subject).split('\r\n ');
  assert.ok(words.length > 1);
  for (const w of words) assert.ok(w.length <= 75, `${w.length}: ${w}`);
});

test('a non-ASCII body survives intact', () => {
  const text = 'Grüße — 你好 🌍\r\nsecond line';
  const { body } = parse(build({ body: text }));
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), text);
});

test('a body that looks like headers cannot add headers', () => {
  const { head } = parse(build({ body: 'hi\r\nBcc: attacker@example.com' }));
  assert.doesNotMatch(head, /Bcc/);
});

test('createDraft and sendEmail reject bad input before touching Gmail', async () => {
  process.env.ENCRYPTION_SECRET ??= 'email-message-test-secret-32-chars-min';
  const gmail = (await import('../services/gmail.js')).default;
  const bad = { to: 'a@b.co', subject: 'x\r\nBcc: z@y.co', body: 'hi' };
  await assert.rejects(() => gmail.createDraft(1, bad.to, bad.subject, bad.body), EmailValidationError);
  await assert.rejects(() => gmail.sendEmail(1, bad.to, bad.subject, bad.body), EmailValidationError);
  await assert.rejects(() => gmail.sendEmail(1, 'a@b.co,c@d.co', 'ok', 'hi'), EmailValidationError);
});
