import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { parseTrustProxyHops, DEFAULT_TRUST_PROXY_HOPS } from '../lib/env.js';
import { forwardedForEntries, addressForHops, describeRequestPath } from '../lib/requestPath.js';

test('the proxy hop count defaults to 1 and accepts whole numbers from 0 to 5', () => {
  assert.equal(DEFAULT_TRUST_PROXY_HOPS, 1);
  for (const raw of [undefined, null, '', '  ']) assert.deepEqual(parseTrustProxyHops(raw), { hops: 1, valid: true });
  assert.deepEqual(parseTrustProxyHops('0'), { hops: 0, valid: true });
  assert.deepEqual(parseTrustProxyHops(' 2 '), { hops: 2, valid: true });
  assert.deepEqual(parseTrustProxyHops('5'), { hops: 5, valid: true });
});

test('anything else falls back to the default and is reported as invalid', () => {
  for (const raw of ['6', '-1', '1.5', 'two', 'true', '1;2', '1e1']) assert.deepEqual(parseTrustProxyHops(raw), { hops: 1, valid: false }, raw);
});

test('the forwarded chain is split, trimmed, and IPv4-mapped IPv6 is unwrapped', () => {
  assert.deepEqual(forwardedForEntries(' 1.1.1.1 , 2.2.2.2,,::ffff:3.3.3.3'), ['1.1.1.1', '2.2.2.2', '3.3.3.3']);
  assert.deepEqual(forwardedForEntries(['1.1.1.1', '2.2.2.2, 3.3.3.3']), ['1.1.1.1', '2.2.2.2', '3.3.3.3']);
  assert.deepEqual(forwardedForEntries(undefined), []);
  assert.deepEqual(forwardedForEntries(''), []);
});

test('each hop setting picks the address Express would, counting inwards from the connection', () => {
  const chain = ['9.9.9.9', '8.8.8.8']; // client, then the proxy before the last one
  assert.equal(addressForHops('10.0.0.1', chain, 0), '10.0.0.1');
  assert.equal(addressForHops('10.0.0.1', chain, 1), '8.8.8.8');
  assert.equal(addressForHops('10.0.0.1', chain, 2), '9.9.9.9');
  assert.equal(addressForHops('10.0.0.1', chain, 3), '9.9.9.9', 'a longer count stops at the leftmost entry');
  assert.equal(addressForHops('10.0.0.1', [], 1), '10.0.0.1');
  assert.equal(addressForHops('', [], 0), null);
});

// The real thing: Express's own answer must match addressForHops for every count.
async function ipSeen(hops, forwardedFor) {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/ip', (req, res) => res.json({ ip: req.ip, path: describeRequestPath(req, hops) }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/ip`, { headers: { 'X-Forwarded-For': forwardedFor } }).then(r => r.json());
  } finally {
    server.close();
  }
}

test('addressForHops agrees with Express for 0, 1, 2 and 3 hops on a Vercel-then-Render style chain', async () => {
  for (const hops of [0, 1, 2, 3]) {
    const out = await ipSeen(hops, '203.0.113.7, 76.76.21.21');
    assert.equal(out.ip.replace('::ffff:', ''), addressForHops('127.0.0.1', ['203.0.113.7', '76.76.21.21'], hops), `hops=${hops}`);
  }
});

test('describeRequestPath lists what each setting would pick and reports the current one', async () => {
  const { path } = await ipSeen(1, '203.0.113.7, 76.76.21.21');
  assert.equal(path.trustProxyHops, 1);
  assert.deepEqual(path.forwardedFor, ['203.0.113.7', '76.76.21.21']);
  assert.equal(path.clientAddressSeen, '76.76.21.21');
  assert.deepEqual(path.ifHopsWere.map(h => h.address), ['127.0.0.1', '76.76.21.21', '203.0.113.7', '203.0.113.7']);
  assert.deepEqual(path.ifHopsWere.map(h => h.hops), [0, 1, 2, 3]);
});

test('with no forwarding header the connection address is all there is', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/ip', (req, res) => res.json(describeRequestPath(req, 1)));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const out = await fetch(`http://127.0.0.1:${server.address().port}/ip`).then(r => r.json());
    assert.deepEqual(out.forwardedFor, []);
    assert.equal(out.clientAddressSeen, '127.0.0.1');
    assert.equal(out.ifHopsWere.every(h => h.address === '127.0.0.1'), true);
  } finally {
    server.close();
  }
});
