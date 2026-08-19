# DevOS VPS Deploy — Git + GitHub Actions (Quick Reference)

Copy-paste commands, in order, with a plain-English note under each one. Run VPS commands after `ssh root@<IP>` — check your terminal prompt says `root@...#` before pasting anything there. Steps marked **(Mac)** run in a separate, plain Mac terminal instead.

Replace `<IP>` with the current server IP everywhere below (currently `65.20.66.12`, Vultr Mumbai). Repo: `rahulpawar-31/Personal-AI` (public — no deploy key needed to clone).

**Read this before Step 8 if you're migrating off Railway with existing users:** `ENCRYPTION_SECRET` and (ideally) `JWT_SECRET` must be copied **exactly** from Railway's current environment variables, not regenerated. `ENCRYPTION_SECRET` in particular decrypts every already-stored Google/GitHub/Slack/Notion/Trello/Todoist token in the database — generate a fresh one and all of it becomes permanently undecryptable. `JWT_SECRET` is lower-stakes (a fresh one just logs everyone out).

**Also read before deploying:** this box has no domain/HTTPS yet (IP-only). Google OAuth (Sign in with Google, Gmail, Calendar) may be rejected by Google over plain HTTP — the rest of the app works fine either way. Add a domain + Step 13 (HTTPS) when ready.

---

## Step 1 — SSH in
```bash
ssh root@<IP>
```

## Step 2 — Base install
```bash
apt update && apt upgrade -y
```
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v
```
Node 22 — matches this repo's CI (`.github/workflows/ci.yml`) and `nixpacks.toml`.
```bash
apt install -y nginx
npm install -g pm2
apt install -y certbot python3-certbot-nginx
```
Nginx (reverse proxy), PM2 (keeps the app running forever), Certbot (free HTTPS, later — Step 13). **No local Postgres** — this deploy keeps using the existing hosted Postgres (Neon) via `DATABASE_URL`, same as Railway does today.

## Step 3 — Firewall
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status verbose
```
Opens exactly 3 doors: SSH (22), HTTP (80), HTTPS (443, for later). **If the site is ever unreachable later, check this first.**

## Step 4 — App directory
```bash
mkdir -p /var/www
```
The app must live here, **not** in `/root` — Nginx runs as `www-data` and can never read files inside `/root`.

## Step 5 — Clone the repo
```bash
cd /var/www
git clone https://github.com/rahulpawar-31/Personal-AI.git personal-ai
cd personal-ai
ls
```
The repo is public, so no deploy key is needed for this direction (VPS → GitHub, read-only clone). You'll still need a key for the *other* direction — GitHub Actions logging *into* this VPS to deploy — that's Step 14.

**Deploy the branch with the security fixes:** until `security-hardening-and-phase2-fixes` is merged into `main`, check it out explicitly:
```bash
git checkout security-hardening-and-phase2-fixes
```
Once that PR is merged, future deploys (including the GitHub Actions workflow in Step 14) just track `main` as usual.

## Step 6 — `.env` (settings/secrets file)

Goes at the **repo root** (`/var/www/personal-ai/.env`), matching this repo's existing dev convention (`server/package.json`'s dev script loads `../.env` relative to `server/`).

```bash
cd /var/www/personal-ai

JWT_SECRET=$(openssl rand -hex 32)   # or paste Railway's current value — see note above

cat > .env << EOF
NODE_ENV=production
PUBLIC_URL=http://<IP>
PORT=3001

DATABASE_URL="<paste your existing Neon/Railway DATABASE_URL here>"
ENCRYPTION_SECRET="<paste EXACTLY from Railway — do not generate fresh, see note above>"
JWT_SECRET="${JWT_SECRET}"

GOOGLE_CLIENT_ID="<paste from Railway>"
GOOGLE_CLIENT_SECRET="<paste from Railway>"

OWNER_USERNAME="<your admin account's username, optional>"
GITHUB_WEBHOOK_SECRET="<paste from Railway, optional>"
EOF

chmod 600 .env
cat .env
```
`.env` is git-ignored — it lives only on the server and future `git pull`s will never touch it. Per-user integration keys (Gemini/Groq/Notion/GitHub/Slack/Trello/Todoist) live in the database already, not here — nothing to migrate for those.

## Step 7 — Install, build

```bash
cd /var/www/personal-ai
npm install
npm install --prefix server
npm install --include=dev --prefix client
```
`--include=dev` on the client matters — Vite (the build tool) is a devDependency.
```bash
npm run build
```
Builds the React client into `client/dist`, which the Express server serves as static files alongside the API.

## Step 8 — Run it with PM2
```bash
cd /var/www/personal-ai
pm2 start server/index.js --name devos-agent --node-args="--env-file=.env"
pm2 save
pm2 startup
```
If it prints one more command at the end, run that too. `--env-file` is Node's native flag (no `dotenv` package in this repo) — matches how `server/package.json`'s dev script already loads env vars, just pointed at the production `.env` instead.

Quick check before moving on:
```bash
pm2 status
curl -I http://localhost:3001
```
Should show `online` and `HTTP/1.1 200 OK` (or 304).

## Step 9 — Nginx
```bash
cat > /etc/nginx/sites-available/devos << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name <IP>;
    client_max_body_size 20M;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/devos /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
curl -I http://127.0.0.1/
```
**Removing `sites-enabled/default` matters** — a fresh Ubuntu install still has it enabled and can silently intercept requests, making it look like your config isn't working when it actually is.

At this point `http://<IP>` should load the app from a browser.

## Step 10 — Domain + HTTPS (later, once you have a domain)

Skip this until you have a domain pointed at `<IP>` via an `A` record. Then:
```bash
sed -i 's/server_name <IP>;/server_name yourdomain.com;/' /etc/nginx/sites-available/devos
nginx -t && systemctl reload nginx
certbot --nginx -d yourdomain.com
```
After this, set `PUBLIC_URL=https://yourdomain.com` in `.env` and restart (`pm2 restart devos-agent`) — cookies switch to `Secure` automatically once `PUBLIC_URL` starts with `https://` (see `server/lib/env.js`). Also update the Google Cloud Console OAuth client's authorized redirect URI to `https://yourdomain.com/api/auth/google/callback`.

## Step 11 — Wire up GitHub Actions (one-time)

The workflow file `.github/workflows/deploy-vps.yml` (added in this same change) SSHes in and runs `git pull && npm install (×3) && npm run build && pm2 reload`.

```bash
# on the VPS — generate a login key for GitHub Actions to use
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -N "" -C "github-actions@devos"
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys
```

Then, from a **Mac terminal**, set 3 GitHub Actions secrets on `rahulpawar-31/Personal-AI` (Settings → Secrets and variables → Actions, or via `gh secret set`):
- `VPS_HOST` — the current IP (`65.20.66.12`)
- `VPS_USER` — `root`
- `VPS_SSH_KEY` — the **private** half of the key just generated. Move it without ever displaying it:
  ```bash
  ssh root@<IP> "cat ~/.ssh/gha_deploy" | gh secret set VPS_SSH_KEY -R rahulpawar-31/Personal-AI
  ```

**Test it:** GitHub repo → **Actions** tab → **"Deploy to VPS"** → **"Run workflow"** → pick the branch → green **"Run workflow"** button. Watch it go green (~2-3 min). Then confirm `http://<IP>` still loads.

## How to verify the site is really running on your server
```bash
# on the VPS
tail -f /var/log/nginx/access.log
```
Reload the site in your browser — a new log line should appear instantly.

---

## Mistakes worth remembering
1. `/root` blocks Nginx from reading files there later — always use `/var/www/`.
2. `ENCRYPTION_SECRET` must be copied from Railway exactly, never regenerated, if you have existing stored user credentials — see the note at the top.
3. This app has no `dotenv` package — production env loading is Node's native `--env-file` flag, pointed at the repo-root `.env`.
4. Fresh Ubuntu's default Nginx site can silently swallow requests — remove it (Step 9).
5. Google OAuth needs HTTPS (except localhost) — expect it to be flaky or rejected until Step 10 is done.
6. Destroying/rebuilding the VPS does **not** automatically update DNS — once you have a domain, the A record needs a manual update too.
