# P0–P2 Runbook — dashboard/provider actions (do these yourself)

These three phases from `PRD-security-hardening.md` require actions on
external dashboards (Vercel, Render, Google, Notion, GitHub, Trello, Slack)
that no coding agent can perform — there's no API access or browser session
available to act on your behalf. This is a precise checklist so each step is
copy-pasteable and verifiable. P3/P4/P5 (code) are being handled separately.

---

## P0 — Lock down public access (today)

**Verified 2026-09-11 via curl against the live app** — `requireAuth` is
already correctly blocking unauthenticated panel access on both
`personal-ai-blue.vercel.app` and `personal-ai-f2f9.onrender.com` directly
(`/api/emails`, `/api/calendar`, `/api/tasks`, `/api/github/repos` all
returned `401 {"error":"Not authenticated"}`), and per-user credential
scoping (`getUserCreds(uid)`, `auth.isConnected(uid)`) was confirmed in code
— so panel data itself is not exposed.

**But found and fixed a real gap the same pass:** `POST /api/auth/signup`
and the Google OAuth sign-in new-account path had zero restriction — anyone
could self-provision a live account (empty dashboard, not your data, but
still an open door on a zero-user tool). Fixed in `server/services/users.js`
and `server/routes/auth.js` — when `OWNER_USERNAME` is set, only that
account may exist; verified locally both the rejection and the
owner-succeeds case.

**Confirmed live setup** (per `vercel.json` + your confirmation): Vercel
serves the frontend and proxies `/api/*` to `https://personal-ai-f2f9.onrender.com`.
That Render service is the real API — gating only Vercel is not enough if the
Render URL is directly reachable. The remaining steps below are still
platform-level defense-in-depth on top of the app-layer fix above, not a
replacement for it.

0. **Confirm `OWNER_USERNAME` is actually set in Render's env vars** (Dashboard → service → Environment) — I can't check this myself. If it's unset, the signup-gate fix above is a no-op in production. Set it to your actual username, then redeploy, then verify:
   ```
   curl -s -X POST https://personal-ai-f2f9.onrender.com/api/auth/signup \
     -H "Content-Type: application/json" -d '{"username":"someoneelse","password":"testpassword123"}'
   ```
   Must return `{"error":"Signups are currently invite-only."}`, not a token.
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

## Rotating ENCRYPTION_SECRET

Saved keys (GitHub, Gemini, Slack and so on) are encrypted with `ENCRYPTION_SECRET`. If that secret simply changes, every saved key becomes unreadable and each user has to enter them again. To rotate it without that, hold the old and the new secret side by side, move the saved keys across, then drop the old one. The app stays up the whole time.

1. **Back up first.** Take a copy of the database (a Neon branch or export) and keep the old secret somewhere safe.
2. **Set both secrets and redeploy.** On the host, set `ENCRYPTION_SECRET` to the **new** value (`openssl rand -hex 32`) and `ENCRYPTION_SECRET_PREVIOUS` to the **old** value. Paste both exactly: the secret is used byte for byte, so a trailing space or newline from the paste makes the old values unreadable. After the deploy, everything saved under the old secret is still readable, and anything saved from now on uses the new one. The log shows a line saying the previous secret is set.
3. **Re-encrypt.** Sign in as an admin, open **Admin**, and in the **Encryption** card press **Re-encrypt**. It shows counts only, never the keys. It is safe to press again. Repeat until it says nothing is left to move.
4. **Check the counts.** "To move" must be 0. "Unreadable" counts values that open with neither secret (for example a key that was already broken before the rotation); those users need to save that key again, and rotating does not change that.
5. **Remove the old secret.** Delete `ENCRYPTION_SECRET_PREVIOUS` and redeploy. If anything looks wrong, put it back: nothing was deleted.

Do not skip step 3 before step 5: a value still on the old secret becomes unreadable the moment the old secret is removed. Cached email data is not moved; it is a five-minute cache and is simply fetched again.

## Checking the client address (rate limits)

The per-address rate limits use the address Express calls `req.ip`. Behind Vercel (which forwards `/api` to Render) and Render's own front door, that is only the visitor's real address if the server trusts the right number of proxies. Too few and every visitor shares one address (a proxy's); too many and a client can put a made-up address first in `X-Forwarded-For`. The default is 1; `TRUST_PROXY_HOPS` (0 to 5) changes it.

1. Sign in as an admin on the **Vercel address** you normally use, open **Admin**, and press **Check request path** in the **Request path** card.
2. Look up your own public address ("what is my IP"). The card lists the address each hop count would use. The right count is the one whose row shows **your** address.
3. If that is the row marked "now", nothing to do. Otherwise set `TRUST_PROXY_HOPS` to that count on Render and redeploy, then press the button again to confirm.
4. Be careful with higher counts: they are only safe if every request really passes through those proxies. A request sent straight to the Render address skips Vercel, so with a higher count it can carry a made-up first address. The per-account sign-in limit does not depend on the address, so password guessing stays limited either way.

## Status

- [x] P0 (partial) — app-layer auth verified live; open-signup gap found and fixed (needs `OWNER_USERNAME` confirmed set in Render + a redeploy to take effect)
- [ ] P0 (remaining) — platform-level access gate live on both Vercel and Render, verified via outside curl
- [ ] P1 — every credential rotated/revoked, old values confirmed rejected
- [ ] P2 — documented answer on prior exploitation (or "inconclusive")
