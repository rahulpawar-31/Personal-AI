// server/lib/webhookOwner.js
// Finds whose Slack should receive a GitHub webhook event.
//
// The candidates are the users who have saved GitHub credentials, not the users
// who connected Google: someone with GitHub and Slack but no Google account
// would otherwise never be notified. The lookups are independent, so they run
// together; the first user (lowest id) who owns the repo and has Slack wins.
import { getRepos } from '../services/github.js';

// listUserIds() -> number[] of users with GitHub credentials
// getCreds(userId) -> that user's decrypted credentials object
export async function findOwnerCreds(repoFullName, { listUserIds, getCreds }) {
  if (!repoFullName) return null;
  const target = repoFullName.toLowerCase();
  const userIds = await listUserIds();
  const credsList = await Promise.all(userIds.map(id => getCreds(Number(id))));
  return credsList.find(c =>
    c?.SLACK_BOT_TOKEN && c?.SLACK_USER_ID &&
    getRepos(c).some(r => r.toLowerCase() === target)
  ) ?? null;
}
