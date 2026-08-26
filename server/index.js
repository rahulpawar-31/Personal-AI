import tracing from './services/tracing.js'; // FIRST — sets LangSmith env before any LangChain module loads
import express      from 'express';
import cors         from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import path    from 'path';
import fs      from 'fs';

import { initDB, getPool, dbFindByUsername, dbSetAdmin } from './services/db.js';
import * as integrations   from './services/integrations.js';
import { decrypt }         from './services/encryption.js';
import auth                from './services/auth.js';
import { setupCronJobs }   from './lib/digest.js';
import { publicOrigin, extraOrigins } from './lib/env.js';

import authRoutes        from './routes/auth.js';
import accountRoutes     from './routes/account.js';
import credentialsRoutes from './routes/credentials.js';
import chatRoutes        from './routes/chat.js';
import tasksRoutes       from './routes/tasks.js';
import commsRoutes       from './routes/comms.js';
import githubRoutes      from './routes/github.js';
import digestRoutes      from './routes/digest.js';
import webhooksRoutes    from './routes/webhooks.js';
import contentRoutes     from './routes/content.js';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// Render/Railway/Vercel all sit behind a single reverse-proxy hop — without
// this, req.ip resolves to the proxy's internal address for every request,
// which breaks per-client rate limiting (see server/middleware/rateLimiter.js).
app.set('trust proxy', 1);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3001',
  publicOrigin(),
  ...extraOrigins(),
].filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));
// Capture the raw request body alongside the parsed one — needed to verify the
// GitHub webhook HMAC signature, which is computed over the exact bytes GitHub
// sent (re-serializing the parsed JSON can produce different bytes and always
// fail verification).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use(authRoutes);
app.use(accountRoutes);
app.use(credentialsRoutes);
app.use(chatRoutes);
app.use(tasksRoutes);
app.use(commsRoutes);
app.use(githubRoutes);
app.use(digestRoutes);
app.use(webhooksRoutes);
app.use(contentRoutes);

// ─── Serve React build in production ─────────────────────────────────────────

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.join(__dirname, '..', 'client', 'dist');

app.use(express.static(clientBuild));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

// ─── Startup migrations ───────────────────────────────────────────────────────

async function migrateEnvCredentials() {
  const ownerUsername = process.env.OWNER_USERNAME;
  if (!ownerUsername) {
    console.warn('[migration] OWNER_USERNAME not set — skipping env credential migration. Set OWNER_USERNAME to your account username to enable this.');
    return;
  }

  const adminUser = await dbFindByUsername(ownerUsername).catch(() => null);
  if (!adminUser) {
    console.warn(`[migration] No account found for OWNER_USERNAME "${ownerUsername}" yet — skipping env credential migration until it signs up.`);
    return;
  }

  await dbSetAdmin(adminUser.id, true);

  const candidates = [
    ['github',   'GITHUB_TOKEN',         process.env.GITHUB_TOKEN],
    ['github',   'GITHUB_OWNER',         process.env.GITHUB_OWNER],
    ['github',   'GITHUB_REPO',          process.env.GITHUB_REPO],
    ['github',   'GITHUB_REPOS',         process.env.GITHUB_REPOS],
    ['notion',   'NOTION_API_KEY',       process.env.NOTION_API_KEY],
    ['notion',   'NOTION_TASKS_DB_ID',   process.env.NOTION_TASKS_DB_ID],
    ['notion',   'NOTION_NOTES_DB_ID',   process.env.NOTION_NOTES_DB_ID],
    ['slack',    'SLACK_BOT_TOKEN',      process.env.SLACK_BOT_TOKEN],
    ['slack',    'SLACK_USER_ID',        process.env.SLACK_USER_ID],
    ['todoist',  'TODOIST_API_KEY',      process.env.TODOIST_API_KEY],
    ['trello',   'TRELLO_API_KEY',       process.env.TRELLO_API_KEY],
    ['trello',   'TRELLO_TOKEN',         process.env.TRELLO_TOKEN],
    ['trello',   'TRELLO_BOARD_ID',      process.env.TRELLO_BOARD_ID],
    ['gemini',   'GEMINI_API_KEY',       process.env.GEMINI_API_KEY],
    ['groq',     'GROQ_API_KEY',         process.env.GROQ_API_KEY],
    ['linkedin', 'LINKEDIN_WEBHOOK_URL', process.env.LINKEDIN_WEBHOOK_URL],
  ];

  let count = 0;
  for (const [service, keyName, value] of candidates) {
    if (!value) continue;
    // Strip legacy secret_ntn_ prefix that Notion's old API prepended
    const clean = (keyName === 'NOTION_API_KEY' && value.startsWith('secret_ntn_'))
      ? value.slice('secret_'.length)
      : value;
    const existing = await integrations.getKey(adminUser.id, service, keyName).catch(() => null);
    const needsFix = existing?.startsWith('secret_ntn_');
    if (!existing || needsFix) {
      await integrations.saveKey(adminUser.id, service, keyName, clean);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[migration] Imported ${count} env credential(s) → user "${adminUser.username}" (ID ${adminUser.id})`);
  }
}

async function migrateJsonIntegrations() {
  const pool = getPool();
  if (!pool) return;

  const usersFile = new URL('./users.json', import.meta.url);
  const integFile = new URL('./integrations.json', import.meta.url);
  if (!fs.existsSync(fileURLToPath(usersFile))) return;

  let oldUsers = [], oldInteg = [];
  try {
    oldUsers = JSON.parse(fs.readFileSync(fileURLToPath(usersFile), 'utf8'));
    if (fs.existsSync(fileURLToPath(integFile)))
      oldInteg = JSON.parse(fs.readFileSync(fileURLToPath(integFile), 'utf8'));
  } catch { return; }

  if (!oldUsers.length) return;

  let usersMigrated = 0, keysMigrated = 0;

  for (const oldUser of oldUsers) {
    let newId = null;

    const byUsername = await pool.query(
      'SELECT id FROM users WHERE username = $1', [oldUser.username]
    ).catch(() => null);
    if (byUsername?.rows[0]) {
      newId = byUsername.rows[0].id;
    } else if (oldUser.email) {
      const byEmail = await pool.query(
        'SELECT id FROM users WHERE email = $1', [oldUser.email]
      ).catch(() => null);
      if (byEmail?.rows[0]) newId = byEmail.rows[0].id;
    }

    if (!newId) {
      const ins = await pool.query(
        `INSERT INTO users (username, email, password_hash, google_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING
         RETURNING id`,
        [
          oldUser.username,
          oldUser.email ?? null,
          oldUser.passwordHash ?? oldUser.password_hash ?? 'UNKNOWN',
          oldUser.googleId ?? oldUser.google_id ?? null,
        ]
      ).catch(() => null);
      if (ins?.rows[0]) { newId = ins.rows[0].id; usersMigrated++; }
    }

    if (!newId) continue;

    const keys = oldInteg.filter(r => String(r.userId) === String(oldUser.id));
    for (const k of keys) {
      try {
        const plain = decrypt(k.keyValue);
        await integrations.saveKey(newId, k.service, k.keyName, plain);
        keysMigrated++;
      } catch {
        console.warn(`[migration] Could not decrypt "${k.keyName}" for user "${oldUser.username}" — skipping (ENCRYPTION_SECRET mismatch?)`);
      }
    }
  }

  if (usersMigrated > 0 || keysMigrated > 0)
    console.log(`[migration] JSON → Neon: ${usersMigrated} user(s), ${keysMigrated} key(s) imported`);
}

// ─── Start server ─────────────────────────────────────────────────────────────

await initDB();
await auth.restoreAllFromDB();
await migrateEnvCredentials();
await migrateJsonIntegrations();
setupCronJobs();

app.listen(PORT, () => {
  console.log(`\n DevOS Agent server running on http://localhost:${PORT}`);
  console.log(`   Gemini: ${process.env.GEMINI_API_KEY ? '✓' : '✗ missing'}`);
  console.log(`   Groq:   ${process.env.GROQ_API_KEY   ? '✓' : '✗ missing'}`);
  console.log(`   Notion: ${process.env.NOTION_API_KEY  ? '✓' : '✗ missing'}`);
  console.log(`   Google: ${auth.getConnectedUserIds().length} user(s) connected`);
  console.log(`   Slack:   ${process.env.SLACK_BOT_TOKEN  ? '✓' : '○ optional'}`);
  console.log(`   GitHub:  ${process.env.GITHUB_TOKEN     ? '✓' : '○ optional'}`);
  console.log(`   Trello:  ${process.env.TRELLO_API_KEY   ? '✓' : '○ optional'}`);
  console.log(`   Todoist: ${process.env.TODOIST_API_KEY  ? '✓' : '○ optional'}\n`);
});
