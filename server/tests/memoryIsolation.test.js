import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankMemory, mergeWithDefaults } from '../services/memory.js';

// Regression test for a cross-user leak found by the two-user smoke test: the
// defaults were copied shallowly, so every user without saved memory shared the
// same arrays, and one user's VIPs / activity / drafts appeared for the others.

test('two blank memories share no arrays or objects', () => {
  const a = blankMemory();
  const b = blankMemory();
  a.vipContacts.push({ email: 'vip-of-a@example.com' });
  a.facts.push('a private fact');
  a.activityLog.push({ action: 'send_email', title: 'A confidential subject' });
  a.voiceProfile.approvedDrafts.push({ edited: 'A private draft' });
  a.voiceProfile.avoidPhrases.push('synergy');
  a.preferences.focusBlockMin = 15;

  assert.deepEqual(b.vipContacts, []);
  assert.deepEqual(b.facts, []);
  assert.deepEqual(b.activityLog, []);
  assert.deepEqual(b.voiceProfile.approvedDrafts, []);
  assert.deepEqual(b.voiceProfile.avoidPhrases, []);
  assert.equal(b.preferences.focusBlockMin, 90);
  assert.notEqual(a.vipContacts, b.vipContacts);
  assert.notEqual(a.voiceProfile, b.voiceProfile);
});

test('merging an empty stored record gives each user their own copy of the defaults', () => {
  const a = mergeWithDefaults({});
  const b = mergeWithDefaults({});
  a.vipContacts.push({ email: 'vip-of-a@example.com' });
  a.voiceProfile.approvedDrafts.push({ edited: 'A private draft' });
  a.activityLog.push({ action: 'x' });

  assert.deepEqual(b.vipContacts, []);
  assert.deepEqual(b.voiceProfile.approvedDrafts, []);
  assert.deepEqual(b.activityLog, []);
  assert.deepEqual(mergeWithDefaults({}).vipContacts, [], 'and a later load is unaffected too');
});

test('stored values still win, and missing nested defaults are still filled in', () => {
  const m = mergeWithDefaults({
    vipContacts: [{ email: 'kept@example.com' }],
    voiceProfile: { tone: 'casual' },
    preferences: { digestTime: '07:30' },
  });
  assert.equal(m.vipContacts[0].email, 'kept@example.com');
  assert.equal(m.voiceProfile.tone, 'casual');
  assert.deepEqual(m.voiceProfile.approvedDrafts, []);
  assert.equal(m.preferences.digestTime, '07:30');
  assert.equal(m.preferences.focusBlockMin, 90);
  assert.deepEqual(m.facts, []);
});
