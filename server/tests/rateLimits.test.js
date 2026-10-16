import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { accountLimiter, sendLimiter, limitSendApprovals } from '../middleware/rateLimiter.js';

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

// /send stands in for /api/email/send; /approve/:id for the agent's approve route.
// `actions` maps a pending-action id to the row the store would return.
async function withApprovalApp(actions, fn) {
  const app = express();
  app.use((req, res, next) => { req.user = { userId: Number(req.headers['x-user']) }; next(); });
  app.post('/send', sendLimiter, (req, res) => res.json({ ok: true }));
  app.post('/approve/:id', limitSendApprovals(async (uid, id) => {
    if (id === 'boom') throw new Error('db down');
    return actions[id] ?? null;
  }), (req, res) => res.json({ ok: true }));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const call = (path, user) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'x-user': String(user) } }).then(r => r.status);
  try { await fn(call); } finally { server.close(); }
}

test('approving a send_email action draws from the same bucket as /send', async () => {
  const actions = { 1: { actionType: 'send_email', status: 'pending' } };
  await withApprovalApp(actions, async call => {
    for (let i = 0; i < 29; i++) assert.equal(await call('/send', 10), 200);
    assert.equal(await call('/approve/1', 10), 200, 'the 30th send is still allowed');
    assert.equal(await call('/approve/1', 10), 429, 'the 31st is blocked');
    assert.equal(await call('/send', 10), 429, 'and /send shares the exhausted bucket');
    assert.equal(await call('/approve/1', 11), 200, 'another user is unaffected');
  });
});

test('approving non-send actions or already-resolved ones is never limited', async () => {
  const actions = {
    task:     { actionType: 'add_task',   status: 'pending' },
    resolved: { actionType: 'send_email', status: 'approved' },
  };
  await withApprovalApp(actions, async call => {
    for (let i = 0; i < 35; i++) {
      assert.equal(await call('/approve/task', 12), 200);
      assert.equal(await call('/approve/resolved', 12), 200);
      assert.equal(await call('/approve/missing', 12), 200);
    }
    assert.equal(await call('/send', 12), 200, 'none of that used the send quota');
  });
});

test('a failed action lookup falls through to the route instead of failing the request', async () => {
  await withApprovalApp({}, async call => {
    assert.equal(await call('/approve/boom', 13), 200);
  });
});

import { loginAccountLimiter, authLimiter, loginAccountKey } from '../middleware/rateLimiter.js';

// Stands in for POST /api/auth/login: password "good" signs in, anything else fails with 401.
async function withLoginApp(limiter, fn) {
  const app = express();
  app.use(express.json());
  app.post('/login', limiter, (req, res) => (req.body?.password === 'good' ? res.json({ ok: true }) : res.status(401).json({ error: 'bad' })));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const call = (username, password = 'bad') => fetch(`http://127.0.0.1:${server.address().port}/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }).then(r => r.status);
  try { await fn(call); } finally { server.close(); }
}

test('loginAccountLimiter blocks the 11th failed sign-in for one account, and another account is unaffected', async () => {
  await withLoginApp(loginAccountLimiter, async call => {
    for (let i = 0; i < 10; i++) assert.equal(await call('ada'), 401);
    assert.equal(await call('ada'), 429);
    assert.equal(await call('ada', 'good'), 429, 'even the right password waits out the window');
    assert.equal(await call('bob'), 401, 'another account has its own bucket');
  });
});

test('loginAccountLimiter treats the username without regard to case or spaces', async () => {
  await withLoginApp(loginAccountLimiter, async call => {
    for (let i = 0; i < 5; i++) assert.equal(await call('Carol'), 401);
    for (let i = 0; i < 5; i++) assert.equal(await call('  carol '), 401);
    assert.equal(await call('CAROL'), 429);
  });
});

test('loginAccountLimiter does not count successful sign-ins', async () => {
  await withLoginApp(loginAccountLimiter, async call => {
    for (let i = 0; i < 25; i++) assert.equal(await call('dave', 'good'), 200);
    assert.equal(await call('dave'), 401, 'still has all ten failures available');
  });
});

test('loginAccountKey falls back to the address when there is no usable username', () => {
  assert.equal(loginAccountKey({ body: { username: ' Eve ' }, ip: '1.2.3.4' }), 'login:eve');
  assert.equal(loginAccountKey({ body: { username: 'x'.repeat(200) }, ip: '1.2.3.4' }), `login:${'x'.repeat(64)}`);
  for (const body of [undefined, {}, { username: '' }, { username: '   ' }, { username: 42 }, { username: null }]) {
    assert.equal(loginAccountKey({ body, ip: '1.2.3.4' }), '1.2.3.4');
  }
});

test('authLimiter allows 100 requests from one address in 15 minutes, then 429', async () => {
  await withLoginApp(authLimiter, async call => {
    for (let i = 0; i < 100; i++) assert.equal(await call(`user${i}`, 'good'), 200);
    assert.equal(await call('late', 'good'), 429);
  });
});
