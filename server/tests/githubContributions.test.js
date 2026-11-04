import { test } from 'node:test';
import assert from 'node:assert/strict';
import github, { summariseContributions, getReviewsInWindow } from '../services/github.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
const commit = n => ({ commit: { author: { date: day(n) } } });

test('commits are counted per day for the last 30 days only', () => {
  const r = summariseContributions({
    commits: [commit(0), commit(0), commit(1), commit(29), commit(31), commit(90)],
    pulls: [], login: 'ada', repo: 'ada/devos', now: NOW,
  });
  assert.equal(r.totalCommits, 4, 'the 31- and 90-day-old commits are outside the window');
  assert.equal(r.dailyActivity.length, 30);
  assert.equal(r.dailyActivity.at(-1).count, 2, 'today');
  assert.equal(r.dailyActivity.at(-2).count, 1, 'yesterday');
  assert.equal(r.dailyActivity[0].count, 1, '29 days ago');
});

test('the streak counts consecutive active days back from today', () => {
  const base = { pulls: [], login: 'ada', repo: 'ada/devos', now: NOW };
  assert.equal(summariseContributions({ ...base, commits: [commit(0), commit(1), commit(2), commit(4)] }).streak, 3);
  assert.equal(summariseContributions({ ...base, commits: [commit(1), commit(2)] }).streak, 0, 'nothing today');
  assert.equal(summariseContributions({ ...base, commits: [] }).streak, 0);
});

test('only this account\'s recent pull requests count, and only its own submitted reviews in the window', () => {
  const r = summariseContributions({
    commits: [],
    pulls: [
      { user: { login: 'Ada' }, created_at: day(2) },
      { user: { login: 'ada' }, created_at: day(40) },
      { user: { login: 'someone-else' }, created_at: day(1) },
    ],
    reviews: [
      { user: { login: 'ada' },          state: 'COMMENTED', submitted_at: day(3) },
      { user: { login: 'Ada' },          state: 'APPROVED',  submitted_at: day(29) },
      { user: { login: 'ada' },          state: 'COMMENTED', submitted_at: day(40) },   // outside the window
      { user: { login: 'someone-else' }, state: 'APPROVED',  submitted_at: day(3) },    // not this account
      { user: { login: 'ada' },          state: 'PENDING',   submitted_at: null },      // never submitted
    ],
    login: 'ada', repo: 'ada/devos', now: NOW,
  });
  assert.equal(r.prsOpened, 1);
  assert.equal(r.reviewsDone, 2);
  assert.equal(r.author, 'ada');
  assert.equal(r.repo, 'ada/devos');
});

test('reviews that could not be read give null, not a count of zero', () => {
  const r = summariseContributions({ commits: [], pulls: [], reviews: null, login: 'ada', repo: 'ada/devos', now: NOW });
  assert.equal(r.reviewsDone, null);
  assert.equal(summariseContributions({ commits: [], pulls: [], reviews: [], login: 'ada', repo: 'ada/devos', now: NOW }).reviewsDone, 0, 'read fine, none found');
});

test('commits with no usable date are ignored instead of breaking the count', () => {
  const r = summariseContributions({ commits: [{}, { commit: {} }, commit(0)], pulls: [], login: 'ada', repo: 'a/b', now: NOW });
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

// Real "now", because getContributions uses it: dates here are relative to the actual clock.
const ago = n => new Date(Date.now() - n * 86400000).toISOString();
const pr = (number, { user = 'ada', created = 2, updated = 2 } = {}) => ({ number, user: { login: user }, created_at: ago(created), updated_at: ago(updated) });
const review = (user, daysAgo, state = 'COMMENTED') => ({ user: { login: user }, state, submitted_at: ago(daysAgo) });

function repoStub({ pulls = [], reviewsByPr = {}, failReviewsFor = null } = {}) {
  return path => {
    if (path === '/user') return json({ login: 'ada' });
    if (path.startsWith('/repos/ada/devos/commits')) return json([{ commit: { author: { date: ago(0) } } }, { commit: { author: { date: ago(1) } } }]);
    const m = /^\/repos\/ada\/devos\/pulls\/(\d+)\/reviews/.exec(path);
    if (m) return Number(m[1]) === failReviewsFor ? json({ message: 'rate limited' }, 403) : json(reviewsByPr[m[1]] ?? []);
    if (path.startsWith('/repos/ada/devos/pulls')) return json(pulls);
    return json({ message: `unexpected ${path}` }, 500);
  };
}

test('a review older than GitHub\'s 100 newest events is still counted (#410)', async () => {
  // PR 390 was updated 9 days ago and has this account's review from then: the case the event feed lost.
  await withStub(repoStub({ pulls: [pr(390, { created: 12, updated: 9 })], reviewsByPr: { 390: [review('ada', 9)] } }), async calls => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.reviewsDone, 1);
    assert.equal(r.reviewsError, null);
    assert.equal(r.reviewsPartial, false);
    assert.ok(!calls.some(c => c.startsWith('/users/')), 'no longer reads the event feed');
  });
});

test('only submitted reviews by this account count, and PRs not updated in the window are not even asked', async () => {
  const pulls = [pr(10, { updated: 1 }), pr(11, { updated: 5 }), pr(12, { created: 60, updated: 45 })];
  await withStub(repoStub({
    pulls,
    reviewsByPr: {
      10: [review('ada', 1), review('someone-else', 1, 'APPROVED')],
      11: [review('ada', 5, 'APPROVED'), { user: { login: 'ada' }, state: 'PENDING', submitted_at: null }],
      12: [review('ada', 45)],
    },
  }), async calls => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.reviewsDone, 2);
    assert.ok(!calls.some(c => c.includes('/pulls/12/reviews')), 'PR 12 was last updated 45 days ago');
  });
});

test('a failing review request does not hide the commit numbers, and says why instead of showing 0', async () => {
  await withStub(repoStub({ pulls: [pr(7), pr(8)], reviewsByPr: { 8: [review('ada', 2)] }, failReviewsFor: 7 }), async () => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.totalCommits, 2);
    assert.equal(r.reviewsDone, null);
    assert.match(r.reviewsError, /GitHub 403 for \/repos\/ada\/devos\/pulls\/7\/reviews/);
  });
});

test('once a review request fails the rest of the list is not requested', async () => {
  // 50 recent PRs, the very first review request fails (as a rate limit would). Only the
  // requests already in flight (10 at a time) may finish; the other ~40 must never be sent.
  const pulls = Array.from({ length: 50 }, (_, i) => pr(3000 + i));
  await withStub(repoStub({ pulls, failReviewsFor: 3000 }), async calls => {
    const r = await github.getContributions('devos', creds);
    const reviewCalls = calls.filter(c => /\/pulls\/\d+\/reviews/.test(c)).length;
    assert.equal(r.reviewsDone, null);
    assert.match(r.reviewsError, /GitHub 403/);
    assert.ok(reviewCalls <= 10, `expected at most one batch of 10 review requests, got ${reviewCalls}`);
  });
});

test('PRs opened are counted from the recently updated list too', async () => {
  await withStub(repoStub({ pulls: [pr(1, { created: 3, updated: 1 }), pr(2, { user: 'other', created: 3, updated: 1 }), pr(3, { created: 50, updated: 2 })] }), async () => {
    assert.equal((await github.getContributions('devos', creds)).prsOpened, 1);
  });
});

test('the PR list stops paging once a page reaches back past the window', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => pr(1000 + i, { updated: i < 60 ? 2 : 45 })); // page 1 ends 45 days ago
  const pageCalls = [];
  const stub = repoStub({ pulls: fullPage });
  await withStub(path => { if (/\/pulls\?/.test(path)) pageCalls.push(path); return stub(path); }, async () => {
    await github.getContributions('devos', creds);
    assert.equal(pageCalls.length, 1, 'one page was enough');
  });
});

test('the PR list keeps paging while the newest page is still inside the window', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => pr(2000 + i, { updated: 3 }));
  const pageCalls = [];
  const stub = repoStub({ pulls: fullPage });
  await withStub(path => { if (/\/pulls\?/.test(path)) pageCalls.push(path); return stub(path); }, async () => {
    await github.getContributions('devos', creds);
    assert.equal(pageCalls.length, 3, 'a full, all-recent page means more may follow, up to the 3-page limit');
  });
});

test('past the cap only the most recently updated PRs are checked, and the count says it may be more', async () => {
  const pulls = Array.from({ length: 5 }, (_, i) => pr(100 + i, { updated: i + 1 }));
  await withStub(repoStub({ pulls, reviewsByPr: { 100: [review('ada', 1)], 104: [review('ada', 5)] } }), async calls => {
    const out = await getReviewsInWindow('ada/devos', pulls, Date.now() - 30 * 86400000, { GITHUB_TOKEN: 'ghp_stub' }, { cap: 3 });
    assert.equal(out.partial, true);
    assert.equal(out.reviews.length, 1, 'only PRs 100-102 were checked');
    assert.ok(!calls.some(c => c.includes('/pulls/103/') || c.includes('/pulls/104/')));
  });
});

test('a PR whose reviews fill a whole page flags the count as possibly short; 99 does not', async () => {
  const many = n => Array.from({ length: n }, () => review('ada', 2));
  // 100 reviews is a full page: there may be more on a page that was not read.
  await withStub(repoStub({ pulls: [pr(1)], reviewsByPr: { 1: many(100) } }), async () => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.reviewsDone, 100);
    assert.equal(r.reviewsPartial, true);
  });
  await withStub(repoStub({ pulls: [pr(1)], reviewsByPr: { 1: many(99) } }), async () => {
    const r = await github.getContributions('devos', creds);
    assert.equal(r.reviewsDone, 99);
    assert.equal(r.reviewsPartial, false);
  });
});

test('with no repos configured it returns null, as before', async () => {
  assert.equal(await github.getContributions('x', { GITHUB_TOKEN: 'ghp_stub' }), null);
});
