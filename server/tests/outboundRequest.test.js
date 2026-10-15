import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dns from 'node:dns';
import {
  isPrivateAddress, validateWebhookUrl, guardedLookup, sendJson, postJson, OutboundUrlError,
} from '../lib/outboundRequest.js';

const PRIVATE = [
  '127.0.0.1', '127.255.255.254', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '169.254.169.254', '0.0.0.0', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::127.0.0.1',
  '64:ff9b::7f00:1', '2002:7f00:1::',
];
const PUBLIC = [
  '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '11.0.0.1',
  '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::',
];

test('private, loopback, link-local and reserved addresses are all refused', () => {
  for (const ip of PRIVATE) assert.equal(isPrivateAddress(ip), true, ip);
});

test('ordinary public addresses are allowed', () => {
  for (const ip of PUBLIC) assert.equal(isPrivateAddress(ip), false, ip);
});

test('anything that is not a valid IP address is never treated as safe', () => {
  for (const x of ['', 'localhost', 'example.com', '1.2.3', '::g', '1.2.3.4.5']) {
    assert.equal(isPrivateAddress(x), true, x);
  }
});

test('a normal https webhook URL is accepted', () => {
  for (const u of ['https://hook.eu1.make.com/abc123', 'https://example.com:443/x?y=1', 'https://8.8.8.8/hook']) {
    assert.doesNotThrow(() => validateWebhookUrl(u), u);
  }
});

test('URLs that could reach the internal network are rejected', () => {
  const bad = [
    'http://hook.example.com/x',                 // not https
    'ftp://hook.example.com/x',
    'https://user:pass@hook.example.com/x',      // embedded credentials
    'https://hook.example.com:8443/x',           // unusual port
    'https://localhost/x', 'https://app.localhost/x', 'https://printer.local/x',
    'https://metadata.google.internal/x', 'https://intranet/x',
    'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data/', 'https://10.1.2.3/x',
    'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[fd00::1]/x',
    'https://2130706433/x',                      // 127.0.0.1 written as one number
    'https://0x7f.1/x',                          // ...and in hex
    'not a url', '', null, undefined,
  ];
  for (const u of bad) assert.throws(() => validateWebhookUrl(u), OutboundUrlError, String(u));
});

test('guardedLookup refuses a name that resolves to a private address (DNS rebinding)', async () => {
  const resolve = (answer) => (host, opts, cb) => cb(null, answer, 4);
  const run = (answer, options = {}) => new Promise(r => guardedLookup('evil.example', options, (err, a, f) => r({ err, a, f }), resolve(answer)));

  assert.ok((await run('127.0.0.1')).err instanceof OutboundUrlError);
  assert.ok((await run('169.254.169.254')).err instanceof OutboundUrlError);
  const ok = await run('93.184.216.34');
  assert.equal(ok.err, null);
  assert.equal(ok.a, '93.184.216.34');
  // With { all: true } the client asks for every address: one private entry is enough to refuse.
  const mixed = [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }];
  assert.ok((await run(mixed, { all: true })).err instanceof OutboundUrlError);
  assert.equal((await run([{ address: '93.184.216.34', family: 4 }], { all: true })).err, null);
});

test('guardedLookup passes a real DNS failure straight through', async () => {
  const failing = (host, opts, cb) => cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
  const err = await new Promise(r => guardedLookup('nope.example', {}, e => r(e), failing));
  assert.equal(err.code, 'ENOTFOUND');
});

test('postJson refuses a private target before opening any connection', async () => {
  await assert.rejects(() => postJson('https://127.0.0.1/hook', { a: 1 }), OutboundUrlError);
  await assert.rejects(() => postJson('http://example.com/hook', { a: 1 }), OutboundUrlError);
});

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(new URL(`http://127.0.0.1:${server.address().port}/hook`)); }
  finally { server.closeAllConnections?.(); server.close(); }
}
const local = { transport: http, lookup: dns.lookup };

test('sendJson posts the JSON body and reports the status', async () => {
  let seen;
  await withServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => { seen = { type: req.headers['content-type'], body }; res.statusCode = 200; res.end('ok'); });
  }, async url => {
    const r = await sendJson(url, { content: 'hello ☕', type: 'linkedin' }, local);
    assert.deepEqual(r, { status: 200, ok: true });
    assert.equal(seen.type, 'application/json');
    assert.deepEqual(JSON.parse(seen.body), { content: 'hello ☕', type: 'linkedin' });
  });
});

test('sendJson reports a failing status and does not follow a redirect', async () => {
  let hits = 0;
  await withServer((req, res) => {
    hits += 1;
    if (req.url === '/hook') { res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:1/secret'); res.end(); }
    else { res.statusCode = 200; res.end(); }
  }, async url => {
    const r = await sendJson(url, {}, local);
    assert.deepEqual(r, { status: 302, ok: false });
    assert.equal(hits, 1);
  });
  await withServer((req, res) => { res.statusCode = 500; res.end(); }, async url => {
    assert.deepEqual(await sendJson(url, {}, local), { status: 500, ok: false });
  });
});

test('sendJson gives up on an endpoint that never answers', async () => {
  await withServer(() => { /* accepts the request and never replies */ }, async url => {
    const started = Date.now();
    await assert.rejects(() => sendJson(url, {}, { ...local, timeoutMs: 300 }), /timed out/);
    assert.ok(Date.now() - started < 3000, 'must return soon after the timeout, not hang');
  });
});
