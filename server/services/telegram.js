// server/services/telegram.js
// Telegram Bot API, the first alert channel. One bot for the whole app (the
// operator's TELEGRAM_BOT_TOKEN); each user links their own chat to it.
//
// Setup, once per deployment:
//   1. Create a bot with @BotFather; set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME.
//   2. Set TELEGRAM_WEBHOOK_SECRET to a random string, then point Telegram at
//      POST <your server>/api/telegram/webhook:
//        curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
//          -d url=https://<server>/api/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET
//
// Linking a user: the app shows a link https://t.me/<bot>?start=<code>; opening
// it makes Telegram send "/start <code>" to the webhook, which ties that chat to
// the user who asked for the code (see startLink / completeLink in lib/alerts.js).
import crypto from 'node:crypto';

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export function isConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_WEBHOOK_SECRET);
}

export function deepLink(code) {
  return `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}`;
}

// Telegram sends the secret we registered in this header on every webhook call.
export function webhookSecretMatches(header) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A webhook update -> { chatId, code } when it is "/start <code>" sent in a
// private chat, else null. Groups and channels are ignored on purpose: alerts
// carry mail subjects and must only go to one person.
export function parseStartCommand(update) {
  const msg = update?.message;
  if (!msg || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return null;
  const m = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,64})\s*$/.exec(msg.text);
  return m ? { chatId: String(msg.chat.id), code: m[1] } : null;
}

// 403 means the user blocked the bot or it was removed; 400 "chat not found" means
// the chat no longer exists. Any other 400 (for example a message Telegram could
// not parse) is a problem with the message, not the chat, and must not unlink anyone.
export function isChatGone(status, description = '') {
  return status === 403 || (status === 400 && /chat not found/i.test(String(description)));
}

// Sends an HTML-formatted message. Returns { ok: true }, or { ok: false, gone }
// where `gone` means the chat can no longer be reached (the user blocked the bot
// or deleted the chat), so the caller should unlink it rather than keep retrying.
export async function sendMessage(chatId, html) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, gone: false, error: 'Telegram is not configured' };
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, gone: isChatGone(res.status, body?.description), error: `Telegram ${res.status}` };
  } catch (err) {
    // Never include the request URL: it contains the bot token.
    return { ok: false, gone: false, error: err.name === 'TimeoutError' ? 'Telegram timed out' : 'Telegram unreachable' };
  }
}

export default { isConfigured, deepLink, webhookSecretMatches, escapeHtml, parseStartCommand, isChatGone, sendMessage };
