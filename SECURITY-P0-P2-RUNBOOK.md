# P0–P2 Runbook — dashboard/provider actions (do these yourself)

These three phases from `PRD-security-hardening.md` require actions on
external dashboards (Vercel, Render, Google, Notion, GitHub, Trello, Slack)
that no coding agent can perform — there's no API access or browser session
available to act on your behalf. This is a precise checklist so each step is
copy-pasteable and verifiable. P3/P4/P5 (code) are being handled separately.

---

## P0 — Lock down public access (today)

**Confirmed live setup** (per `vercel.json` + your confirmation): Vercel
serves the frontend and proxies `/api/*` to `https://personal-ai-f2f9.onrender.com`.
That Render service is the real API — gating only Vercel is not enough if the
Render URL is directly reachable.

1. **Vercel** — Project → Settings → Deployment Protection → enable
   "Vercel Authentication" (password or account gate) for Production.
2. **Render** — the proxied API is a second public URL
   (`personal-ai-f2f9.onrender.com`) and Vercel's gate does **not** protect
   it if it's called directly. Options, in order of speed:
   - Render → service → Settings → check if IP allowlisting is available on
     your plan; restrict to your static IP if you have one.
   - Otherwise, add HTTP Basic Auth in front of it (quickest: a small
     Express middleware gate ahead of `requireAuth`, or Render's own access
     control if the plan supports it).
3. **Verify from outside your network** (phone on cellular data, or
   `curl` from a machine not on your LAN):
   ```
   curl -i https://personal-ai-blue.vercel.app/api/emails
   curl -i https://personal-ai-f2f9.onrender.com/api/emails
   ```
   Both must return 401/403/redirect — not panel data — before this is done.

**Note:** `nixpacks.toml` (Railway) is being removed as stale in the P5
pass. If a Railway deployment is *actually* still live independent of the
repo config, gate that too — check the Railway dashboard directly.

---

## P1 — Rotate and revoke every credential (this week)

**What I checked in git history already**, so you don't have to re-derive it:
- `git log --all --oneline -- .env` → empty. `.env` itself was **never**
  committed to this repo's history.
- `git log --all --diff-filter=A --name-only` for `.env|secret|credential|.pem|.key$|token` →
  only `.env.example` (a template, no real values) and `server/routes/credentials.js`
  (app code, not a secrets file).
- The commit titled "security: stop tracking committed secrets" (`0576edf`)
  is a squashed multi-feature merge; the actual diff touching `.gitignore`
  just adds `.env` to it — there's no evidence a real `.env` was ever
  tracked and then removed.

**This lowers the urgency of a git-history rewrite specifically** — you
likely don't need `git filter-repo`/BFG for `.env`. But re-verify yourself
(don't take this as final) and rotate regardless — a credential can be
compromised via a leaked server log, a dashboard screenshot, a shared
terminal, etc., independent of git:

```
git log --all -p -- .env .env.local .env.production 2>/dev/null | less
git log --all --oneline --all -- '*.pem' '*credential*' '*secret*' | cat
```

**Rotate/revoke these** (per PRD P1), regardless of the git-history finding:

| Credential | Where to rotate |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio → API keys |
| `GROQ_API_KEY` | console.groq.com → API keys |
| `NOTION_API_KEY` | notion.so/my-integrations |
| `GITHUB_TOKEN` | github.com/settings/tokens |
| `TRELLO_API_KEY` / `TRELLO_TOKEN` | trello.com/app-key |
| `SLACK_BOT_TOKEN` | api.slack.com/apps → your app → OAuth & Permissions |
| `GOOGLE_CLIENT_SECRET` **and** the OAuth grant | See below — do both |

**Google OAuth — do this, not just the client secret:**
1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   and revoke DevOS's access. This invalidates every previously-issued
   access/refresh token pair immediately.
2. In Google Cloud Console → APIs & Services → Credentials, rotate
   `GOOGLE_CLIENT_SECRET` for the OAuth client.
3. Reconnect Google from the app's Settings page afterward (the merge just
   committed added a Disconnect button in `GoogleRow.jsx` — use it, then
   reconnect, to force a fresh token).

**Update rotated values in every place they're stored:**
- Render env vars (the live API) — required.
- Vercel env vars, if any server-side values are duplicated there.
- Railway, if it's still an active target independent of `nixpacks.toml`
  (confirm in the Railway dashboard, not just the repo).
- Local `.env` for dev.

**Acceptance check:** after rotating, try the *old* value against each
provider's API directly and confirm it's rejected — don't just trust that
you pasted a new one into `.env`.

---

## P2 — Check whether this was already exploited (this week)

1. **Render logs** — Dashboard → your service → Logs. Filter/search the
   window from repo creation (2026-05-12) to now, looking for:
   - Requests to panel routes (`/api/email`, `/api/calendar`, `/api/tasks`,
     `/api/github/*`, etc.) with no prior page load from the same session.
   - Unfamiliar IPs or request volume/timing that doesn't match your own
     usage.
2. **Vercel logs** — Dashboard → project → Logs (real-time/runtime logs;
   note Vercel's free-tier log retention is short — if you're past the
   retention window, that's a legitimate "can't tell" answer, not a gap
   in your effort).
3. **Google Account activity** — myaccount.google.com/security →
   "Third-party apps with account access" (confirm only expected access),
   and "Recent security activity" for anything unrecognized involving
   Gmail/Calendar scopes.
4. **This app has no request-level access log of its own** (no
   morgan/winston/pino found in `server/`) — so provider-side logs above
   are the only source of truth. Worth adding basic request logging as a
   follow-up, but that's new scope beyond this PRD, not required to close P2.

**Acceptance criteria is a documented answer, not silence** — write down
what you found (or "logs don't go back far enough to tell") in this file or
wherever you track the PRD's completion, even if the answer is inconclusive.

---

## Status

- [ ] P0 — access gate live on both Vercel and Render, verified via outside curl
- [ ] P1 — every credential rotated/revoked, old values confirmed rejected
- [ ] P2 — documented answer on prior exploitation (or "inconclusive")
