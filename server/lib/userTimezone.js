// server/lib/userTimezone.js
// The timezone to use for one user's calendar: the one they saved in Settings
// (stored with their morning brief settings, see briefSchedule.js), else
// USER_TIMEZONE, else the server's own. Never throws; a lookup failure falls
// back the same way, so calendar calls keep working.
import { dbGetBriefPrefs } from '../services/db.js';
import { resolveTimezone } from './briefSchedule.js';

export async function getUserTimezone(userId, getPrefs = dbGetBriefPrefs) {
  try {
    const row = await getPrefs(userId);
    return resolveTimezone(row?.timezone);
  } catch {
    return resolveTimezone(null);
  }
}
