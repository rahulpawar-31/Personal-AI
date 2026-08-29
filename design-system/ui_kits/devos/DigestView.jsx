/* global React */
// Digest panel — stats + categorized cards. Mirrors DigestPanel.jsx structure.

const SAMPLE_DIGEST = {
  generatedAt: new Date().toISOString(),
  comms: {
    pending: [
      { id: "e1", from: "Jane Park <jane@acme.com>",   subject: "Q3 roadmap review",       intent: "needs decision by Thursday" },
      { id: "e2", from: "Sam Liu <sam@vendor.io>",     subject: "Renewal contract draft",  intent: "30-day reply window" },
      { id: "e3", from: "ceo@company.com",             subject: "Urgent — Q3 numbers",     intent: "VIP — auto-flagged P1" },
    ],
  },
  calendar: {
    conflicts: [
      { id: "conflict1", eventA: { title: "Sprint planning" }, eventB: { title: "1:1 w/ Alex" }, type: "overlap", overlapMin: 25 },
    ],
  },
  tasks: {
    blockers: [
      { id: "b1", source: "GitHub PR #847", title: "Auth refresh tokens — waiting on review (3d)" },
      { id: "b2", source: "Notion",         title: "Q3 OKR draft — blocked on Jane's review" },
    ],
  },
  content: {
    drafts: [{}, {}, {}],
  },
};

function DigestView() {
  const [digest, setDigest] = React.useState(SAMPLE_DIGEST);
  const [loading, setLoading] = React.useState(false);

  function runDigest() {
    setLoading(true);
    setTimeout(() => {
      setDigest({ ...SAMPLE_DIGEST, generatedAt: new Date().toISOString() });
      setLoading(false);
    }, 900);
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  let buttonLabel = "Run digest";
  if (loading) buttonLabel = "Running…";
  else if (digest) buttonLabel = "Refresh digest";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 500 }}>Today's digest</h2>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>{today}</p>
        </div>
        <Button variant="primary" onClick={runDigest} disabled={loading}>
          {buttonLabel}
        </Button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--muted)" }}>
          Running 4 sub-agents in parallel…
        </div>
      )}

      {digest && !loading && (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,1fr)",
              gap: 8,
              marginBottom: 16,
            }}
          >
            <StatTile label="Emails pending" value={digest.comms.pending.length}   color="var(--success)" />
            <StatTile label="Conflicts"       value={digest.calendar.conflicts.length} color="var(--warning)" />
            <StatTile label="Blockers"        value={digest.tasks.blockers.length}    color="var(--danger)" />
            <StatTile label="Content drafts"  value={digest.content.drafts.length}    color="var(--info)" />
          </div>

          {/* Comms */}
          <Eyebrow>Comms</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {digest.comms.pending.map(e => (
              <Card key={e.id} accent="var(--border)">
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{e.from}</div>
                <div style={{ fontWeight: 500 }}>{e.subject}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{e.intent}</div>
              </Card>
            ))}
          </div>

          {/* Conflicts */}
          <Eyebrow>Calendar conflicts</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {digest.calendar.conflicts.map(c => (
              <Card key={c.id} accent="var(--danger)">
                <div style={{ fontWeight: 500 }}>
                  {c.eventA.title} ↔ {c.eventB.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {Math.round(c.overlapMin)}min overlap
                </div>
              </Card>
            ))}
          </div>

          {/* Blockers */}
          <Eyebrow>Blockers</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {digest.tasks.blockers.map(b => (
              <Card key={b.id} accent="var(--danger)">
                <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <Tag variant="danger">Blocked</Tag>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{b.source}</span>
                </div>
                <div style={{ fontWeight: 500 }}>{b.title}</div>
              </Card>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "var(--hint)", textAlign: "right" }}>
            Generated {new Date(digest.generatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

window.DigestView = DigestView;
