// server/lib/requestPath.js
// Explains how a request reached the server, so the right TRUST_PROXY_HOPS can
// be chosen from the real deployment instead of guessed. Express's req.ip is
// the first address, counting from the connection inwards, that is not one of
// the trusted proxies: with N hops it is the Nth entry of
// [connection address, X-Forwarded-For read right to left], or the last
// (leftmost) one if the chain is shorter.

function clean(value) {
  return String(value ?? '').trim().replace(/^::ffff:/i, '');
}

export function forwardedForEntries(header) {
  const raw = Array.isArray(header) ? header.join(',') : String(header ?? '');
  return raw.split(',').map(clean).filter(Boolean);
}

// The address each hop setting would treat as the client.
export function addressForHops(socketAddress, entries, hops) {
  const chain = [clean(socketAddress), ...[...entries].reverse()].filter(Boolean);
  if (chain.length === 0) return null;
  return chain[Math.min(hops, chain.length - 1)];
}

export function describeRequestPath(req, hops) {
  const entries = forwardedForEntries(req.headers?.['x-forwarded-for']);
  const socketAddress = clean(req.socket?.remoteAddress ?? req.connection?.remoteAddress);
  const maxHops = Math.min(entries.length + 1, 4);
  return {
    trustProxyHops: hops,
    clientAddressSeen: clean(req.ip) || null,
    connectionAddress: socketAddress || null,
    forwardedFor: entries,
    // What each setting would pick for this request. Compare with your own
    // public address: the right setting is the one that shows it.
    ifHopsWere: Array.from({ length: maxHops + 1 }, (_, h) => ({ hops: h, address: addressForHops(socketAddress, entries, h) })),
  };
}
