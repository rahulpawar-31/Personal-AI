// server/services/notifier.js
// Delivers an alert to a user over whichever channel they linked. The detectors
// (lib/alerts.js) only produce { title, body, url } and call deliver(); they do
// not know about Telegram. Adding a channel later (browser push, email) means
// adding one entry to `channels`, with no change to any detector.
//
// A channel is { name, linked(prefs), send(prefs, alert) }. send resolves to
// { ok: true } or { ok: false, gone, error }, where `gone` means the destination
// can no longer be reached and should be unlinked.
import telegram from './telegram.js';

const { escapeHtml } = telegram;

export const telegramChannel = {
  name: 'telegram',
  linked: prefs => Boolean(prefs?.telegramChatId) && telegram.isConfigured(),
  send(prefs, alert) {
    const lines = [`<b>${escapeHtml(alert.title)}</b>`];
    if (alert.body) lines.push(escapeHtml(alert.body));
    if (alert.url)  lines.push(escapeHtml(alert.url));
    return telegram.sendMessage(prefs.telegramChatId, lines.join('\n'));
  },
};

export const defaultChannels = [telegramChannel];

// Sends over the first linked channel. Returns:
//   { delivered: true,  channel }
//   { delivered: false, reason: 'no-channel' }          nothing linked: not an error
//   { delivered: false, reason: 'failed', gone, error }  the send itself failed
export async function deliver(prefs, alert, channels = defaultChannels) {
  const channel = channels.find(c => c.linked(prefs));
  if (!channel) return { delivered: false, reason: 'no-channel' };
  const result = await channel.send(prefs, alert);
  if (result.ok) return { delivered: true, channel: channel.name };
  return { delivered: false, reason: 'failed', gone: Boolean(result.gone), error: result.error };
}

export default { deliver, defaultChannels, telegramChannel };
