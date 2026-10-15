import { test } from 'node:test';
import assert from 'node:assert/strict';
import github, { summariseContributions } from '../services/github.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
const commit = n => ({ commit: { author: { date: day(n) } } });

test('commits are counted per day for the last 30 days only', () => {
  const r = summariseContributions({
    commits: [commit(0), commit(0), commit(1), commit(29), commit(31), commit(90)],
    pulls: [], reviewEvents: [], login: 'ada', repo: 'ada/devos', now: NOW,
  });
  assert.equal(r.totalCommits, 4, 'the 31- and 90-day-old commits are outside the window');
  assert.equal(r.dailyActivity.length, 30);
  assert.equal(r.dailyActivity.at(-1).count, 2, 'today');
  assert.equal(r.dailyActivity.at(-2).count, 1, 'yesterday');
  assert.equal(r.dailyActivity[0].count, 1, '29 days ago');
});

test('the streak counts consecutive active days back from today', () => {
  const base = { pulls: [], reviewEvents: [], login: 'ada', repo: 'ada/devos', now: NOW };
  assert.equal(summariseContributions({ ...base, commits: [commit(0), commit(1), commit(2), commit(4)] }).streak, 3);
  assert.equal(summariseContributions({ ...base, commits: [commit(1), commit(2)] }).streak, 0, 'nothing today');
  assert.equal(summariseContributions({ ...base, commits: [] }).streak, 0);
});

test('only this account\'s recent pull requests and this repo\'s reviews count', () => {
  const r = summariseContributions({
    commits: [],
    pulls: [
      { user: { login: 'Ada' }, created_at: day(2) },
      { user: { login: 'ada' }, created_at: day(40) },
      { user: { login: 'someone-else' }, created_at: day(1) },
    ],
    reviewEvents: [
      { type: 'PullRequestReviewEvent', repo: { name: 'ada/devos' }, created_at: day(3) },
      { type: 'PullRequestReviewEvent', repo: { name: 'ada/other' }, created_at: day(3) },
      { type: 'PullRequestEvent', repo: { name: 'ada/devos' }, created_at: day(3) },
    ],
    login: 'ada', repo: 'ada/devos', now: NOW,
  });
  assert.equal(r.prsOpened, 1);
  assert.equal(r.reviewsDone, 1);
  assert.equal(r.author, 'ada');
  assert.equal(r.repo, 'ada/devos');
});

test('commits with no usable date are ignored instead of breaking the count', () => {
  const r = summariseContributions({ commits: [{}, { commit: {} }, commit(0)], pulls: [], reviewEvents: [], login: 'ada', repo: 'a/b', now: NOW });
  assert.equal(r.totalCommits, 1);
});

// ── getContributions against a stubbed GitHub ────────────────────────────────
const creds = { GITHUB_TOKEN: 'ghp_stub', GITHUB_OWNER: 'ada', GITHUB_REPO: 'devos,other' };

async function withStub(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const path = String(url).replace('https://api.github.com', '');
    calls.push(path);
    return handler(path);
  };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('it queries the SELECTED repo with the token\'s own login', async () => {
  await withStub(path => {
    if (path === '/user') return json({ login: 'ada-token-owner' });
    if (path.startsWith('/repos/ada/other/commits')) return json([commit(0)]);
    if (path.startsWith('/repos/ada/other/pulls')) return json([]);
    return json([]); // events
  }, async calls => {
    const r = await github.getContributions('other', creds);
    assert.equal(r.totalCommits, 1);
    assert.equal(r.author, 'ada-token-owner');
    assert.equal(r.repo, 'ada/other');
    assert.ok(calls.some(c => c.includes('author=ada-token-owner')), 'filters commits by the token\'s login');
    assert.ok(!calls.some(c => c.startsWith('/repos/ada/devos')), 'does not touch the other repo');
  });
});

test('a GitHub failure is reported, not turned into a screen of zeros', async () => {
  await withStub(() => json({ message: 'Bad credentials' }, 401), async () => {
    await assert.rejects(() => github.getContributions('devos', creds), /GitHub 401 for \/user/);
  });
  await withStub(path => (path === '/user' ? json({ login: 'ada' }) : json({}, 404)), async () => {
    await assert.rejects(() => github.getContributions('devos', creds), /GitHub 404/);
  });
});

test('a failing review-events call does not hide the commit numbers', async () => {
  await withStub(path => {
    if (path === '/user') return json({ login: 'ada' });
    if (path.startsWith('/repos/ada/devos/commits')) return json([commit(0), commit(1)]);
    if (path.startsWith('/repos/ada/devos/pulls')) return json([]);
    return json({ message: 'rate limited' }, 403); // events
  }, async () => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.totalCommits, 2);
    assert.equal(r.reviewsDone, 0);
  });
});

test('with no repos configured it returns null, as before', async () => {
  assert.equal(await github.getContributions('x', { GITHUB_TOKEN: 'ghp_stub' }), null);
});
