// server/lib/outboundRequest.js
// Safe outbound POSTs to a URL a user supplied (the LinkedIn webhook).
//
// A user-chosen URL must not be able to make this server call its own network:
// loopback, private ranges, cloud metadata addresses (169.254.169.254) and so
// on. Three things enforce that:
//   1. validateWebhookUrl: https only, no embedded credentials, port 443, and
//      no local-looking host names or private IP literals.
//   2. guardedLookup: the address a name resolves to is checked at the moment
//      the socket connects. Checking once up front and then letting the HTTP
//      client resolve again would let a DNS answer change in between.
//   3. A hard timeout and no redirect following, so a slow or redirecting
//      endpoint can neither hang the request nor bounce it somewhere internal.
import dns from 'node:dns';
import net from 'node:net';
import https from 'node:https';

export class OutboundUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OutboundUrlError';
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Address classification ───────────────────────────────────────────────────

function ipv4Octets(ip) {
  return ip.split('.').map(Number);
}

function isPrivateIPv4(ip) {
  const [a, b, c] = ipv4Octets(ip);
  return (
    a === 0 ||                                  // "this" network
    a === 10 ||                                 // private
    (a === 100 && b >= 64 && b <= 127) ||       // carrier-grade NAT
    a === 127 ||                                // loopback
    (a === 169 && b === 254) ||                 // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||        // private
    (a === 192 && b === 0 && c === 0) ||        // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) ||        // documentation
    (a === 192 && b === 168) ||                 // private
    (a === 198 && (b === 18 || b === 19)) ||    // benchmarking
    (a === 198 && b === 51 && c === 100) ||     // documentation
    (a === 203 && b === 0 && c === 113) ||      // documentation
    a >= 224                                    // multicast and reserved, incl. 255.255.255.255
  );
}

// Expands an IPv6 literal into eight 16-bit groups. Handles "::" and a dotted
// IPv4 tail (::ffff:1.2.3.4). Returns null if it is not a valid address.
function ipv6Groups(ip) {
  let text = ip.split('%')[0].toLowerCase();
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!net.isIPv4(tail[1])) return null;
    const [a, b, c, d] = ipv4Octets(tail[1]);
    text = text.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map(g => parseInt(g, 16));
  return groups.length === 8 && groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function embeddedIPv4(hi, lo) {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateIPv6(ip) {
  const g = ipv6Groups(ip);
  if (!g) return true; // cannot parse: refuse rather than guess
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g;
  if (g.slice(0, 5).every(x => x === 0)) {
    // ::, ::1, ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
    if (g5 === 0xffff) return isPrivateIPv4(embeddedIPv4(g6, g7));
    if (g5 === 0) return true;
  }
  return (
    (g0 & 0xfe00) === 0xfc00 ||                       // fc00::/7 unique local
    (g0 & 0xffc0) === 0xfe80 ||                       // fe80::/10 link-local
    (g0 & 0xff00) === 0xff00 ||                       // ff00::/8 multicast
    (g0 === 0x2001 && g1 === 0x0db8) ||               // 2001:db8::/32 documentation
    (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && isPrivateIPv4(embeddedIPv4(g6, g7))) || // NAT64
    (g0 === 0x2002 && isPrivateIPv4(embeddedIPv4(g1, g2)))                                                                      // 6to4
  );
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // not an IP at all: never treat it as safe
}

// ─── Allowed hosts (optional) ─────────────────────────────────────────────────

// WEBHOOK_ALLOWED_HOSTS is a comma-separated list such as "hook.make.com,*.zapier.com".
// An exact name matches only itself; "*.example.com" matches any name under
// example.com but not example.com itself. Unset or blank means no restriction
// (any public https host). If it is set but holds no valid entry (a typo, or a
// bare "*"), nothing is allowed rather than everything, because a mistyped
// safety setting should stop the webhook, not silently open it.
const ALLOWED_ENTRY = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function parseAllowedHosts(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.split(',')
    .map(e => e.trim().toLowerCase().replace(/\.$/, ''))
    .filter(e => ALLOWED_ENTRY.test(e));
}

export function hostIsAllowed(host, allowed) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return allowed.some(e => (e.startsWith('*.') ? h.endsWith(e.slice(1)) : h === e));
}

// ─── URL validation ───────────────────────────────────────────────────────────

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa'];

// Throws OutboundUrlError, or returns the parsed URL. Checks the URL's shape
// only; the address a name resolves to is checked at connect time (guardedLookup).
export function validateWebhookUrl(raw, { allowedHosts = parseAllowedHosts(process.env.WEBHOOK_ALLOWED_HOSTS) } = {}) {
  let url;
  try { url = new URL(String(raw ?? '').trim()); }
  catch { throw new OutboundUrlError('Webhook URL is not a valid URL'); }

  if (url.protocol !== 'https:') throw new OutboundUrlError('Webhook URL must start with https://');
  if (url.username || url.password) throw new OutboundUrlError('Webhook URL must not contain a username or password');
  if (url.port && url.port !== '443') throw new OutboundUrlError('Webhook URL must use the standard HTTPS port');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new OutboundUrlError('Webhook URL has no host');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new OutboundUrlError('Webhook URL points at a private or internal address');
  } else if (!host.includes('.') || LOCAL_SUFFIXES.some(s => host.endsWith(s))) {
    throw new OutboundUrlError('Webhook URL points at a private or internal host name');
  }
  if (allowedHosts && !hostIsAllowed(host, allowedHosts)) {
    throw new OutboundUrlError('Webhook URL host is not on this server\'s allowed list');
  }
  return url;
}

// ─── Connect-time guard ───────────────────────────────────────────────────────

// Drop-in for the `lookup` option of http(s).request. `resolve` exists so tests
// can stand in for DNS.
export function guardedLookup(hostname, options, callback, resolve = dns.lookup) {
  resolve(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addresses = Array.isArray(address) ? address.map(a => a.address) : [address];
    if (addresses.some(isPrivateAddress)) {
      return callback(new OutboundUrlError('Webhook host resolves to a private or internal address'));
    }
    return callback(null, address, family);
  });
}

// ─── Request ──────────────────────────────────────────────────────────────────

// Sends the JSON body and resolves with { status, ok } — the response body is
// discarded. Rejects on timeout or any connection error. `transport` and
// `lookup` are parameters so tests can use a local server.
export function sendJson(url, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, lookup = guardedLookup, transport = https } = {}) {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      lookup,
      signal: AbortSignal.timeout(timeoutMs), // whole-request deadline, not just idle time
    }, res => {
      res.resume();
      const status = res.statusCode ?? 0;
      resolve({ status, ok: status >= 200 && status < 300 });
    });
    req.on('error', err => reject(err.name === 'TimeoutError' || err.code === 'ABORT_ERR' ? new Error('Request timed out') : err));
    req.end(data);
  });
}

// async so that a bad URL rejects the returned promise like every other failure
// here, instead of throwing synchronously at the call site.
export async function postJson(rawUrl, payload, options) {
  return sendJson(validateWebhookUrl(rawUrl), payload, options);
}
