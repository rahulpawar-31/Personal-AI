import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectedServices, describeKeys } from '../services/integrations.js';

test('connectedServices returns sorted service names only', () => {
  const meta = {
    slack:  { SLACK_BOT_TOKEN: { keyHint: 'xo••••12' }, SLACK_USER_ID: { keyHint: '••••••••' } },
    github: { GITHUB_TOKEN: { keyHint: 'gh••••ab' } },
  };
  assert.deepEqual(connectedServices(meta), ['github', 'slack']);
});

test('a service is connected only when its primary key is saved and readable, as in Settings', () => {
  const meta = {
    notion: { NOTION_API_KEY: { unreadable: true } },
    github: { GITHUB_TOKEN: { unreadable: true }, GITHUB_REPO: { keyHint: '••••••••' } },
    slack:  { SLACK_BOT_TOKEN: { keyHint: 'xo••••ab' }, SLACK_USER_ID: { unreadable: true } },
    trello: { TRELLO_BOARD_ID: { keyHint: '••••••••' } },
  };
  // github: token unreadable (a readable repo does not help); trello: no primary key saved at all.
  assert.deepEqual(connectedServices(meta), ['slack']);
});

test('a service the list does not know is connected if any of its keys is readable', () => {
  assert.deepEqual(connectedServices({ newthing: { A: { unreadable: true }, B: { keyHint: 'x' } } }), ['newthing']);
  assert.deepEqual(connectedServices({ newthing: { A: { unreadable: true } } }), []);
});

test('no keys, or odd input, gives an empty list', () => {
  assert.deepEqual(connectedServices({}), []);
  assert.deepEqual(connectedServices(undefined), []);
  assert.deepEqual(connectedServices(null), []);
});

test('the list never contains key names, hints or values', async () => {
  const secret = 'ghp_SUPERSECRETVALUE1234567890';
  const meta = { github: { GITHUB_TOKEN: { updatedAt: 'x', keyHint: 'ghp_••••7890' } } };
  const out = JSON.stringify(connectedServices(meta));
  assert.equal(out, '["github"]');
  assert.ok(!out.includes(secret) && !out.includes('GITHUB_TOKEN') && !out.includes('7890'));
});


test('describeKeys lists service and key name but never a hint or value', () => {
  const meta = {
    slack:  { SLACK_USER_ID: { updatedAt: '2026-06-22', keyHint: 'U1••••23' }, SLACK_BOT_TOKEN: { updatedAt: '2026-06-23', keyHint: 'xo••••ab' } },
    github: { GITHUB_TOKEN: { updatedAt: '2026-06-22', keyHint: 'gh••••90', unreadable: true } },
  };
  const rows = describeKeys(meta);
  assert.deepEqual(rows.map(r => `${r.service}/${r.keyName}`), ['github/GITHUB_TOKEN', 'slack/SLACK_BOT_TOKEN', 'slack/SLACK_USER_ID']);
  assert.equal(rows[0].unreadable, true);
  assert.equal(rows[1].unreadable, false);
  const out = JSON.stringify(rows);
  assert.ok(!out.includes('••••') && !out.includes('keyHint'));
  assert.deepEqual(describeKeys(undefined), []);
});

test('describeKeys marks each row with whether its service counts as connected', () => {
  const meta = {
    github: { GITHUB_TOKEN: { unreadable: true }, GITHUB_REPO: { keyHint: '••••••••' } },
    slack:  { SLACK_BOT_TOKEN: { keyHint: 'xo••••ab' } },
  };
  const rows = describeKeys(meta);
  assert.deepEqual(rows.map(r => `${r.service}/${r.keyName}:${r.serviceConnected}`),
    ['github/GITHUB_REPO:false', 'github/GITHUB_TOKEN:false', 'slack/SLACK_BOT_TOKEN:true']);
  // The dialog heading and the Connected column are driven by the same rule.
  const connected = new Set(connectedServices(meta));
  for (const r of rows) assert.equal(r.serviceConnected, connected.has(r.service));
});
