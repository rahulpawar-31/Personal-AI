import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { accountLimiter, sendLimiter } from '../middleware/rateLimiter.js';

// A tiny app that stands in for requireAuth by reading the user id from a
// header, so each limiter is exercised exactly as the routes use it.
async function withApp(limiter, handler, fn) {
  const app = express();
  app.use((req, res, next) => { req.user = { userId: Number(req.headers['x-user']) }; next(); });
  app.post('/x', limiter, handler);
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const call = user => fetch(`http://127.0.0.1:${server.address().port}/x`, { method: 'POST', headers: { 'x-user': String(user) } }).then(r => r.status);
  try { await fn(call); } finally { server.close(); }
}

test('accountLimiter blocks the sixth failed attempt, per user', async () => {
  await withApp(accountLimiter, (req, res) => res.status(400).json({ error: 'nope' }), async call => {
    for (let i = 0; i < 5; i++) assert.equal(await call(1), 400);
    assert.equal(await call(1), 429);
    assert.equal(await call(2), 400, 'another user has their own bucket');
  });
});

test('accountLimiter does not count successful requests', async () => {
  await withApp(accountLimiter, (req, res) => res.json({ ok: true }), async call => {
    for (let i = 0; i < 10; i++) assert.equal(await call(3), 200);
  });
});

test('sendLimiter allows 30 per hour per user and then returns 429', async () => {
  await withApp(sendLimiter, (req, res) => res.json({ ok: true }), async call => {
    for (let i = 0; i < 30; i++) assert.equal(await call(4), 200);
    assert.equal(await call(4), 429);
    assert.equal(await call(5), 200);
  });
});
