import * as integrations from '../services/integrations.js';

export async function getUserCreds(userId) {
  return integrations.getUserCredentials(userId).catch(() => ({}));
}

export function notionReady(creds = {}) {
  const key = creds.NOTION_API_KEY;
  const db  = creds.NOTION_TASKS_DB_ID ?? creds.NOTION_NOTES_DB_ID;
  return !!(key && db && db !== 'your_tasks_database_id_here');
}
