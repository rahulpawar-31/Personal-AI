// server/lib/alerts.js
// Alerts for the things that should not wait until the user opens the app: new
// mail from a VIP sender, and a GitHub review request.
//
// How it fits together:
//   detectors   pure functions that turn fetched mail / PRs into alert items
//   runner      for each user with a linked channel: fetch, drop what was already
//               alerted, stop at the per-user rate limit, deliver, record
//   linking     tie a Telegram chat to a user with a short-lived one-time code
//
// Rules the runner keeps:
//   - An item alerts once. Its key is claimed in the database before it is sent,
//     so a restart or two overlapping ticks cannot both send it. A failed send
//     gives the key back so a later check tries again.
//   - A user with no linked channel is not looked at: no API calls, no errors.
//   - At most ALERTS_PER_HOUR alerts per user per hour. What does not fit is not
//     claimed, so it goes out on a later check if it is still new enough.
//   - One detector (or one user) failing never stops the others.
//   - Mail received, or a review requested, before the user linked their channel
//     is not alerted, so connecting does not dump the backlog.
import crypto from 'node:crypto';
import auth from '../services/auth.js';
import gmail from '../services/gmail.js';
import github from '../services/github.js';
import { deliver } from '../services/notifier.js';
import { getMemory, matchesVIP, bareAddress } from '../services/memory.js';
import { getUserCreds } from './creds.js';
import {
  dbListUsers, dbListAlertUsers, dbClaimAlert, dbReleaseAlert, dbCountAlertsSince, dbPruneAlertsBefore,
  dbUnlinkTelegram, dbCreateAlertLinkToken, dbConsumeAlertLinkToken, dbLinkTelegram,
} from '../services/db.js';

export const ALERTS_PER_HOUR   = 6;
export const SENT_RETENTION_DAYS = 30;
export const LINK_CODE_MINUTES = 15;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// ─── Detectors (pure) ─────────────────────────────────────────────────────────

// "Bob Smith <bob@acme.com>" -> "Bob Smith"; a bare address stays as it is.
export function senderName(from) {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]*>\s*$/.exec(String(from ?? ''));
  return (m ? m[1] : bareAddress(from)) || 'a VIP';
}

// Unread mail from the user's VIPs that arrived at or after `sinceISO`. Gmail's
// `from:` search is a loose match, so the sender is compared exactly here.
export function vipAlerts(messages, vipContacts, sinceISO) {
  return (messages ?? [])
    .filter(m => m.receivedAt >= sinceISO && matchesVIP(vipContacts, m.from))
    .map(m => ({
      kind:  'vip',
      key:   `mail:${m.id}`,
      title: `VIP email from ${senderName(m.from)}`,
      body:  m.subject || '(no subject)',
      url:   `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
    }));
}

// Open PRs the user was asked to review, updated at or after `sinceISO`. Keyed by
// PR, so a PR alerts once however often it is pushed to afterwards.
export function reviewAlerts(prs, sinceISO) {
  return (prs ?? [])
    .filter(pr => pr.updatedAt >= sinceISO)
    .map(pr => ({
      kind:  'review',
      key:   `review:${pr.repo}#${pr.id}`,
      title: `Review requested: ${pr.repo}#${pr.id}`,
      body:  pr.author ? `${pr.title} (by ${pr.author})` : pr.title,
      url:   pr.url,
    }));
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const defaultUserDeps = {
  getVips:         async userId => (await getMemory(userId)).vipContacts ?? [],
  getCreds:        getUserCreds,
  googleReady:     userId => auth.isConnected(userId),
  fetchVipMail:    (userId, addresses) => gmail.getUnreadFrom(userId, addresses),
  fetchReviews:    creds => github.getReviewRequests(creds),
  githubReady:     creds => github.isConfigured(creds),
  claim:           dbClaimAlert,
  release:         dbReleaseAlert,
  countSince:      dbCountAlertsSince,
  unlink:          dbUnlinkTelegram,
  deliver,
};

// Checks one user and sends what is new. `prefs` is their alert row (switches and
// linked chat). Returns { sent, held } where `held` is how many items were left
// unchecked because the hourly limit was reached (it can include items that were
// alerted before; they are skipped when they come up again).
export async function runAlertsForUser(userId, prefs, { now = new Date(), deps = defaultUserDeps } = {}) {
  const linkedAt = prefs.telegramLinkedAt ?? new Date(0).toISOString();
  const items = [];

  if (prefs.vipEnabled) {
    try {
      const vips = await deps.getVips(userId);
      if (vips.length && await deps.googleReady(userId)) {
        const messages = await deps.fetchVipMail(userId, vips.map(v => bareAddress(v.email)).filter(Boolean));
        items.push(...vipAlerts(messages, vips, linkedAt));
      }
    } catch (err) {
      console.error(`[alerts] VIP mail check failed for user ${userId}:`, err.message);
    }
  }

  if (prefs.reviewEnabled) {
    try {
      const creds = await deps.getCreds(userId);
      if (deps.githubReady(creds)) items.push(...reviewAlerts(await deps.fetchReviews(creds), linkedAt));
    } catch (err) {
      console.error(`[alerts] review-request check failed for user ${userId}:`, err.message);
    }
  }

  let room = ALERTS_PER_HOUR - (items.length ? await deps.countSince(userId, new Date(now.getTime() - HOUR_MS).toISOString()) : 0);
  let sent = 0;
  let held = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (room <= 0) { held = items.length - i; break; } // not claimed, so tried again on a later check
    if (!(await deps.claim(userId, item.key, now.toISOString()))) continue; // already alerted
    const result = await deps.deliver(prefs, item);
    if (result.delivered) { sent += 1; room -= 1; continue; }
    await deps.release(userId, item.key); // try again on the next check
    if (result.gone) {
      await deps.unlink(userId);          // blocked the bot or deleted the chat: stop trying
      break;
    }
    if (result.reason === 'failed') console.error(`[alerts] could not deliver to user ${userId}: ${result.error}`);
  }
  return { sent, held };
}

const defaultDueDeps = {
  listLinked: dbListAlertUsers,
  listUsers:  dbListUsers,
  prune:      dbPruneAlertsBefore,
  runUser:    runAlertsForUser,
};

// Runs the check for every user who linked a channel and has an alert switched
// on. Users come from the database. Returns the ids it checked.
export async function runDueAlerts({ now = new Date(), deps = defaultDueDeps } = {}) {
  const [linked, users] = await Promise.all([deps.listLinked(), deps.listUsers()]);
  const active = new Set(users.filter(u => u.isActive !== false).map(u => String(u.id)));
  const targets = linked.filter(p => active.has(String(p.userId)));

  await Promise.allSettled(targets.map(p =>
    deps.runUser(p.userId, p, { now }).catch(err => console.error(`[cron/alerts] user ${p.userId}:`, err.message))
  ));

  // Old sent records only matter for the hourly limit and the once-only check, and
  // GitHub / Gmail stop returning an item long before 30 days.
  await deps.prune(new Date(now.getTime() - SENT_RETENTION_DAYS * DAY_MS).toISOString())
    .catch(err => console.error('[cron/alerts] prune:', err.message));
  return targets.map(p => p.userId);
}

// ─── Linking a Telegram chat ──────────────────────────────────────────────────

const hashCode = code => crypto.createHash('sha256').update(code).digest('hex');

const defaultLinkDeps = {
  createToken:  dbCreateAlertLinkToken,
  consumeToken: dbConsumeAlertLinkToken,
  link:         dbLinkTelegram,
};

// A new one-time code for this user. Only its hash is stored, and it expires after
// LINK_CODE_MINUTES. Asking again replaces the previous code.
export async function startLink(userId, { now = new Date(), deps = defaultLinkDeps } = {}) {
  const code = crypto.randomBytes(32).toString('base64url'); // 43 characters, valid in a t.me start link
  await deps.createToken(userId, hashCode(code), new Date(now.getTime() + LINK_CODE_MINUTES * 60 * 1000).toISOString());
  return code;
}

// Called when Telegram reports "/start <code>". Returns the user id that was
// linked, or null when the code is unknown, used already, or expired.
export async function completeLink({ chatId, code }, { now = new Date(), deps = defaultLinkDeps } = {}) {
  const userId = await deps.consumeToken(hashCode(code), now.toISOString());
  if (userId === null || userId === undefined) return null;
  await deps.link(userId, chatId, now.toISOString());
  return userId;
}
