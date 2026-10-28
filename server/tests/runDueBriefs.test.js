import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'run-due-briefs-test-secret-32-characters-long';

const { runDueBriefs } = await import('../lib/digest.js');
const { createInMemoryBriefStore } = await import('../services/stores/briefStore.js');

// Fake collaborators: a real in-memory store for settings and the claim guard,
// and a recording stand-in for the (slow, networked) digest run.
function setup({ users, prefs = {}, failFor = [] }) {
  const store = createInMemoryBriefStore();
  const ran = [];
  const ready = (async () => {
    for (const [id, patch] of Object.entries(prefs)) await store.savePrefs(Number(id), patch);
  })();
  const deps = {
    listUsers: async () => { await ready; return users; },
    listPrefs: async () => { await ready; return store.listPrefs(); },
    claim:     (id, date) => store.claimBrief(id, date),
    run: async (id, opts) => {
      if (failFor.includes(id)) throw new Error('boom');
      ran.push({ id, ...opts });
    },
  };
  return { deps, ran, store };
}

const NINE_FIFTEEN_UTC = new Date('2026-10-28T09:15:00Z');

test('each user is sent a brief at their own local time', async () => {
  const { deps, ran } = setup({
    users: [{ id: 1 }, { id: 2 }],
    prefs: { 1: { timezone: 'UTC' }, 2: { timezone: 'America/New_York' } }, // 09:15 and 05:15 local
  });
  const sent = await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
  assert.deepEqual(sent, [1]);
  assert.deepEqual(ran.map(r => r.id), [1]);
});

test('a user with no saved settings is included (defaults to 09:00 in the server timezone)', async () => {
  process.env.USER_TIMEZONE = 'UTC';
  try {
    const { deps, ran } = setup({ users: [{ id: 7 }] });
    await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
    assert.deepEqual(ran.map(r => r.id), [7], 'someone who never opened Settings still gets a brief');
  } finally {
    delete process.env.USER_TIMEZONE;
  }
});

test('the brief goes to Slack only for users whose channel is Slack', async () => {
  const { deps, ran } = setup({
    users: [{ id: 1 }, { id: 2 }],
    prefs: { 1: { timezone: 'UTC', channel: 'slack' }, 2: { timezone: 'UTC', channel: 'app' } },
  });
  await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
  assert.equal(ran.find(r => r.id === 1).sendToSlack, true);
  assert.equal(ran.find(r => r.id === 2).sendToSlack, false);
});

test('a user who turned the brief off, or an inactive account, gets nothing', async () => {
  const { deps, ran } = setup({
    users: [{ id: 1 }, { id: 2, isActive: false }],
    prefs: { 1: { timezone: 'UTC', enabled: false }, 2: { timezone: 'UTC' } },
  });
  const sent = await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
  assert.deepEqual(sent, []);
  assert.deepEqual(ran, []);
});

test('a second tick the same local day does not send again, even from a fresh run', async () => {
  const { deps, ran } = setup({ users: [{ id: 1 }], prefs: { 1: { timezone: 'UTC' } } });
  await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
  await runDueBriefs({ now: new Date('2026-10-28T09:20:00Z'), deps });
  await runDueBriefs({ now: new Date('2026-10-28T10:00:00Z'), deps });
  assert.equal(ran.length, 1);
  await runDueBriefs({ now: new Date('2026-10-29T09:05:00Z'), deps });
  assert.equal(ran.length, 2, 'the next day sends again');
});

test('two overlapping ticks send one brief, not two', async () => {
  const { deps, ran } = setup({ users: [{ id: 1 }], prefs: { 1: { timezone: 'UTC' } } });
  await Promise.all([
    runDueBriefs({ now: NINE_FIFTEEN_UTC, deps }),
    runDueBriefs({ now: NINE_FIFTEEN_UTC, deps }),
  ]);
  assert.equal(ran.length, 1);
});

test('one user\'s failure does not stop the others', async () => {
  const { deps, ran } = setup({
    users: [{ id: 1 }, { id: 2 }],
    prefs: { 1: { timezone: 'UTC' }, 2: { timezone: 'UTC' } },
    failFor: [1],
  });
  const sent = await runDueBriefs({ now: NINE_FIFTEEN_UTC, deps });
  assert.deepEqual(sent, [1, 2]);
  assert.deepEqual(ran.map(r => r.id), [2]);
});
