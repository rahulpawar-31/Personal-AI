import { useState } from 'react';
import { apiFetch } from '../../api.js';
import { toast } from '../../toast.jsx';

// Shows how this very request reached the server and which address each proxy
// setting would treat as yours, so TRUST_PROXY_HOPS can be set from evidence.
// Admin only; it reports the caller's own request and nothing else.
export default function NetworkCard() {
  const [info, setInfo]       = useState(null);
  const [loading, setLoading] = useState(false);

  async function check() {
    setLoading(true);
    try {
      const r = await apiFetch('/api/admin/network');
      const body = await r.json();
      if (!r.ok) { toast(body.error || 'Could not check', 'error'); return; }
      setInfo(body);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const label = { fontSize: 11, color: 'var(--muted)', marginBottom: 2 };
  const mono  = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, overflowWrap: 'anywhere' };

  return (
    <section aria-label="Request path" style={{
      background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '12px 14px', marginBottom: 20,
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Request path</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Shows which address the server takes to be yours, which the per-address rate limits use.
      </div>
      <button onClick={check} disabled={loading} style={{ fontSize: 12, padding: '5px 14px', marginTop: 8 }}>
        {loading ? 'Checking…' : info ? 'Check again' : 'Check request path'}
      </button>

      {info && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div>
            <div style={label}>Treated as your address now (hops: {info.trustProxyHops})</div>
            <div style={mono}>{info.clientAddressSeen ?? 'unknown'}</div>
          </div>
          <div>
            <div style={label}>Forwarded-for chain (client first)</div>
            <div style={mono}>{info.forwardedFor.length ? info.forwardedFor.join('  →  ') : 'none (the server was reached directly)'}</div>
          </div>
          <div>
            <div style={label}>Connection address</div>
            <div style={mono}>{info.connectionAddress ?? 'unknown'}</div>
          </div>
          <div>
            <div style={label}>Address each hop count would use</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {info.ifHopsWere.map(h => (
                  <tr key={h.hops}>
                    <td style={{ padding: '2px 14px 2px 0', color: 'var(--muted)' }}>{h.hops} {h.hops === 1 ? 'hop' : 'hops'}{h.hops === info.trustProxyHops ? ' (now)' : ''}</td>
                    <td style={{ padding: '2px 0', ...mono }}>{h.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Look up your own public address (search "what is my IP"). If the row marked "now" is not it, set
            TRUST_PROXY_HOPS to the hop count whose row is. Only raise it if every request really passes through
            those proxies. If your address is IPv6 and no row matches, look up your IPv4 address too (or the other way
            round): the chain may carry the other kind.
          </div>
        </div>
      )}
    </section>
  );
}
