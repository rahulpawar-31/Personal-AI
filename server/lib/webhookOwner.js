// server/lib/webhookOwner.js
// Finds whose Slack should receive a GitHub webhook event.
//
// The candidates are the users who have saved GitHub credentials, not the users
// who connected Google: someone with GitHub and Slack but no Google account
// would otherwise never be notified. The lookups are independent, so they run
// together; the first user (lowest id) who owns the repo and has Slack wins.
// One user whose credentials cannot be loaded (e.g. an undecryptable row) is
// skipped and logged, so they cannot stop everyone else being notified.
import { getRepos } from '../services/github.js';

// listUserIds() -> number[] of users with GitHub credentials
// getCreds(userId) -> that user's decrypted credentials object
export async function findOwnerCreds(repoFullName, { listUserIds, getCreds }) {
  if (!repoFullName) return null;
  const target = repoFullName.toLowerCase();
  const userIds = (await listUserIds()).map(Number).sort((a, b) => a - b);
  const settled = await Promise.allSettled(userIds.map(id => getCreds(id)));
  const credsList = settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[webhook/github] could not load credentials for user ${userIds[i]}: ${r.reason?.message ?? r.reason}`);
    return null;
  });
  return credsList.find(c =>
    c?.SLACK_BOT_TOKEN && c?.SLACK_USER_ID &&
    getRepos(c).some(r => r.toLowerCase() === target)
  ) ?? null;
}
