import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedHosts, hostIsAllowed, validateWebhookUrl, postJson, integrationKeyProblem, OutboundUrlError } from '../lib/outboundRequest.js';
import { configWarnings, assertProductionConfig } from '../lib/startupConfig.js';

test('an unset or blank list means no restriction', () => {
  for (const raw of [undefined, null, '', '   ', 5]) assert.equal(parseAllowedHosts(raw), null);
  assert.equal(validateWebhookUrl('https://hooks.example.com/x', { allowedHosts: null }).hostname, 'hooks.example.com');
});

test('the list is split, trimmed, lowercased, and bad entries are dropped', () => {
  assert.deepEqual(parseAllowedHosts(' Hook.Make.com , *.zapier.com,, make.com. '), ['hook.make.com', '*.zapier.com', 'make.com']);
  assert.deepEqual(parseAllowedHosts('*, *.com, localhost, a b.com, https://x.com'), [], 'a set list with no valid entry allows nothing');
});

test('an exact entry matches only that host; a wildcard matches names under it but not the bare domain', () => {
  const list = parseAllowedHosts('hook.make.com,*.zapier.com');
  assert.equal(hostIsAllowed('hook.make.com', list), true);
  assert.equal(hostIsAllowed('HOOK.make.com.', list), true, 'case and a trailing dot do not matter');
  assert.equal(hostIsAllowed('x.hook.make.com', list), false, 'exact entries do not cover subdomains');
  assert.equal(hostIsAllowed('hooks.zapier.com', list), true);
  assert.equal(hostIsAllowed('a.b.zapier.com', list), true);
  assert.equal(hostIsAllowed('zapier.com', list), false);
});

test('look-alike hosts are refused', () => {
  const list = parseAllowedHosts('*.make.com,hook.make.com');
  for (const h of ['evilmake.com', 'make.com.evil.com', 'hook.make.com.evil.com', 'xhook.make.com.attacker.net', 'make.com']) {
    assert.equal(hostIsAllowed(h, list), false, h);
  }
});

test('validateWebhookUrl enforces the list and still applies every other rule', () => {
  const allowedHosts = parseAllowedHosts('*.make.com');
  assert.equal(validateWebhookUrl('https://hook.eu1.make.com/abc', { allowedHosts }).hostname, 'hook.eu1.make.com');
  assert.throws(() => validateWebhookUrl('https://example.com/abc', { allowedHosts }), /allowed list/);
  assert.throws(() => validateWebhookUrl('http://hook.make.com/abc', { allowedHosts }), /https/);
  assert.throws(() => validateWebhookUrl('https://user:pw@hook.make.com/abc', { allowedHosts }), /username/);
  assert.throws(() => validateWebhookUrl('https://127.0.0.1/abc', { allowedHosts: parseAllowedHosts('127.0.0.1') }), /private/, 'listing a private address does not unlock it');
});

test('the setting is read from the environment each time', () => {
  const saved = process.env.WEBHOOK_ALLOWED_HOSTS;
  try {
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    assert.ok(validateWebhookUrl('https://other.example.org/x'));
    process.env.WEBHOOK_ALLOWED_HOSTS = '*.make.com';
    assert.throws(() => validateWebhookUrl('https://other.example.org/x'), OutboundUrlError);
    assert.ok(validateWebhookUrl('https://hook.make.com/x'));
    process.env.WEBHOOK_ALLOWED_HOSTS = '*';
    assert.throws(() => validateWebhookUrl('https://hook.make.com/x'), OutboundUrlError, 'a setting with no valid entry fails closed');
  } finally {
    if (saved === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS; else process.env.WEBHOOK_ALLOWED_HOSTS = saved;
  }
});

test('sending is refused for a host that is not allowed, before any connection is made', async () => {
  const saved = process.env.WEBHOOK_ALLOWED_HOSTS;
  process.env.WEBHOOK_ALLOWED_HOSTS = 'hook.make.com';
  try {
    await assert.rejects(postJson('https://example.com/x', { a: 1 }), /allowed list/);
  } finally {
    if (saved === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS; else process.env.WEBHOOK_ALLOWED_HOSTS = saved;
  }
});

test('the generic save route applies the webhook rules to the webhook key and nothing else', () => {
  const allowedHosts = parseAllowedHosts('*.make.com');
  const check = (url, service = 'linkedin', key = 'LINKEDIN_WEBHOOK_URL') => integrationKeyProblem(service, key, url, { allowedHosts });
  assert.equal(check('https://hook.eu1.make.com/abc'), null);
  assert.match(check('https://example.com/abc'), /allowed list/);
  assert.match(check('http://hook.make.com/abc'), /https/);
  assert.match(check('https://169.254.169.254/x'), /private/);
  assert.match(check('not a url'), /not a valid URL/);
  // Other keys, including other LinkedIn keys, are not URLs and are never checked here.
  assert.equal(check('anything at all', 'gemini', 'GEMINI_API_KEY'), null);
  assert.equal(check('anything at all', 'linkedin', 'LINKEDIN_OTHER'), null);
});

test('a set but invalid allow-list is reported at boot, a valid or unset one is not', () => {
  assert.equal(configWarnings({ WEBHOOK_ALLOWED_HOSTS: '*' }).length, 1);
  assert.match(configWarnings({ WEBHOOK_ALLOWED_HOSTS: 'localhost, a b.com' })[0], /no valid entry/);
  assert.deepEqual(configWarnings({ WEBHOOK_ALLOWED_HOSTS: '*.make.com' }), []);
  assert.deepEqual(configWarnings({ WEBHOOK_ALLOWED_HOSTS: '   ' }), []);
  assert.deepEqual(configWarnings({}), []);
});

test('the boot warning is printed but does not stop the server', () => {
  const lines = [];
  const codes = [];
  assertProductionConfig({ NODE_ENV: 'test', WEBHOOK_ALLOWED_HOSTS: '*' }, c => codes.push(c), m => lines.push(m));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WEBHOOK_ALLOWED_HOSTS/);
  assert.deepEqual(codes, [], 'a warning is not a reason to exit');
});
