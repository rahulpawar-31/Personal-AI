import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOwnerCreds } from '../lib/webhookOwner.js';
import { createInMemoryIntegrationStore } from '../services/stores/integrationStore.js';
import { countSavedKeys } from '../services/integrations.js';

const slackCreds = { SLACK_BOT_TOKEN: 'xoxb-1', SLACK_USER_ID: 'U1' };
const ghCreds = (owner, repo) => ({ GITHUB_TOKEN: 'ghp_x', GITHUB_OWNER: owner, GITHUB_REPO: repo });

function deps(users) {
  return {
    listUserIds: async () => Object.keys(users).map(Number),
    getCreds: async id => users[id] ?? {},
  };
}

test('a user with GitHub and Slack but no Google is found (#348)', async () => {
  // Google is no longer consulted at all: only GitHub credentials decide who is a candidate.
  const creds = { ...ghCreds('ada', 'devos'), ...slackCreds };
  assert.equal(await findOwnerCreds('ada/devos', deps({ 4: creds })), creds);
});

test('the repo match ignores case, and a different repo does not match', async () => {
  const creds = { ...ghCreds('Ada', 'DevOS'), ...slackCreds };
  assert.equal(await findOwnerCreds('ada/devos', deps({ 1: creds })), creds);
  assert.equal(await findOwnerCreds('ada/other', deps({ 1: creds })), null);
});

test('an owner without Slack configured is skipped, and the next owner is used', async () => {
  const noSlack = ghCreds('ada', 'devos');
  const withSlack = { ...ghCreds('ada', 'devos'), ...slackCreds };
  assert.equal(await findOwnerCreds('ada/devos', deps({ 1: noSlack, 2: withSlack })), withSlack);
  assert.equal(await findOwnerCreds('ada/devos', deps({ 1: noSlack })), null);
});

test('when two users own the repo, the lowest user id wins', async () => {
  const a = { ...ghCreds('ada', 'devos'), ...slackCreds, SLACK_USER_ID: 'UA' };
  const b = { ...ghCreds('ada', 'devos'), ...slackCreds, SLACK_USER_ID: 'UB' };
  assert.equal((await findOwnerCreds('ada/devos', deps({ 2: b, 1: a }))).SLACK_USER_ID, 'UA');
});

test('the lowest user id wins even if the lookup returns ids out of order', async () => {
  const a = { ...ghCreds('ada', 'devos'), ...slackCreds, SLACK_USER_ID: 'UA' };
  const b = { ...ghCreds('ada', 'devos'), ...slackCreds, SLACK_USER_ID: 'UB' };
  const users = { 1: a, 2: b };
  const found = await findOwnerCreds('ada/devos', { listUserIds: async () => [2, 1], getCreds: async id => users[id] });
  assert.equal(found.SLACK_USER_ID, 'UA');
});

test('a user whose credentials fail to load is skipped, not fatal', async () => {
  const owner = { ...ghCreds('ada', 'devos'), ...slackCreds };
  const warn = console.warn;
  const warnings = [];
  console.warn = msg => warnings.push(msg);
  try {
    const found = await findOwnerCreds('ada/devos', {
      listUserIds: async () => [1, 2],
      getCreds: async id => { if (id === 1) throw new Error('cannot decrypt'); return owner; },
    });
    assert.equal(found, owner);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /user 1.*cannot decrypt/);
    const none = await findOwnerCreds('ada/devos', { listUserIds: async () => [1], getCreds: async () => { throw new Error('x'); } });
    assert.equal(none, null);
  } finally {
    console.warn = warn;
  }
});

test('a missing repo name or no candidates returns null without looking anyone up', async () => {
  let looked = false;
  const spy = { listUserIds: async () => { looked = true; return []; }, getCreds: async () => ({}) };
  assert.equal(await findOwnerCreds(undefined, spy), null);
  assert.equal(looked, false);
  assert.equal(await findOwnerCreds('ada/devos', spy), null);
});

test('the store lists the distinct users who have a service, in id order', async () => {
  const store = createInMemoryIntegrationStore();
  await store.set(7, 'github', 'GITHUB_TOKEN', 'a');
  await store.set(7, 'github', 'GITHUB_REPO', 'b');
  await store.set(3, 'github', 'GITHUB_TOKEN', 'c');
  await store.set(5, 'google', 'GOOGLE_OAUTH_TOKENS', 'd');
  assert.deepEqual(await store.listUserIdsForService('github'), [3, 7]);
  assert.deepEqual(await store.listUserIdsForService('nothing'), []);
});

test('countSavedKeys counts key names across services (#344)', () => {
  const meta = {
    github: { GITHUB_TOKEN: {}, GITHUB_OWNER: {}, GITHUB_REPO: {} },
    slack:  { SLACK_BOT_TOKEN: {}, SLACK_USER_ID: {} },
  };
  assert.equal(countSavedKeys(meta), 5);
  assert.equal(countSavedKeys({}), 0);
  assert.equal(countSavedKeys(undefined), 0);
});
