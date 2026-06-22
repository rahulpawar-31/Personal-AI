# DevOS — Architecture & Full Flow Reference

## What Is DevOS?

A personal AI command centre. One dashboard that aggregates all your developer tools — tasks, email, calendar, GitHub, Slack, Notion — and lets you control everything through natural language via an AI chat interface.

---

## Full Workflow

```
You open DevOS
       ↓
Auth: JWT (username/pw) or Google OAuth
       ↓
Dashboard loads — parallel fetches to all connected services
       ↓
Morning digest runs (4 sub-agents in parallel):
  Comms     → Gmail triage (P1/P2/P3 + draft replies)
  Calendar  → upcoming events + conflict detection
  Tasks     → Notion + Todoist priorities + blockers
  Content   → LinkedIn post drafts
       ↓
Everything visible in one view
       ↓
You type a command in Chat:
  "move the Notion bug task to Done and block 2h focus time today"
       ↓
Server classifies intent → executes actions → streams reply
       ↓
Affected panels refresh automatically
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 19 + Vite 6 | Fast HMR, minimal boilerplate |
| Backend | Express 5 (Node, ESM) | Lightweight, easy SSE streaming |
| Database | Neon Postgres + JSON fallback | Neon = serverless on Railway; JSON = zero infra locally |
| Auth | JWT + Google OAuth2 | Stateless JWT; Google = SSO for devs already on Google Workspace |
| Encryption | AES-256-GCM (scrypt) | Per-user API keys stored encrypted — unreadable even with DB access |
| Primary LLM | Gemini 2.0 Flash | Free tier, 1M-token context, handles digest/changelog/content |
| Fast LLM | Groq Llama 3.1 8B | Sub-second latency for chat triage and classification |
| Agent framework | LangChain + LangGraph | Structured tool-calling loop, Zod-typed tools |
| Tracing | LangSmith | Debug LLM calls in production — prompts, latency, token counts |
| Deployment | Railway + Nixpacks | Zero-config deploy from git push, auto-restart on failure |

---

## Project Structure

```
devos/
├── client/                         # React frontend (Vite)
│   └── src/
│       ├── main.jsx                # React entry point — mounts <App />
│       ├── App.jsx                 # Root: auth state, nav, panel routing, auto-refresh
│       ├── AuthPage.jsx            # Login / signup / Google sign-in
│       ├── OnboardingWizard.jsx    # First-run setup flow (shown once after signup)
│       ├── SettingsPage.jsx        # Integration management (test + save keys)
│       ├── AdminPage.jsx           # User list, promote to admin (admin-only)
│       ├── api.js                  # apiFetch — attaches JWT, calls /api/auth/refresh on 401
│       ├── toast.jsx               # Toast notification system
│       ├── hooks/
│       │   └── useCache.js         # SWR-style cache hook used by panels
│       └── components/
│           ├── ChatPanel.jsx       # Conversational interface (SSE streaming)
│           ├── DigestPanel.jsx     # Morning digest (stats + top items)
│           ├── EmailPanel.jsx      # Gmail triage (P1/P2/P3)
│           ├── CalendarPanel.jsx   # Google Calendar + conflict detection
│           ├── TaskPanel.jsx       # Kanban board (Notion + Todoist + Trello)
│           ├── GitHubPanel.jsx     # PRs, issues, contributions, changelog
│           ├── SlackPanel.jsx      # Send DMs via bot token
│           ├── LinkedInPanel.jsx   # AI-drafted post variants + direct publish
│           ├── Sidebar.jsx         # Left nav — view switching, user info, Google connect
│           ├── TopBar.jsx          # Top bar
│           └── NotConnected.jsx    # Shown when a service is not connected
│
└── server/
    ├── index.js                    # Thin entry point (~160 lines): mounts routes, startup migrations
    ├── users.json                  # JSON fallback user store (local dev)
    ├── integrations.json           # JSON fallback key store (local dev, encrypted)
    ├── middleware/
    │   ├── auth.js                 # requireAuth + requireAdmin — extracted JWT middleware
    │   └── rateLimiter.js          # express-rate-limit per-user limiters (digest, chat, auth, creds)
    ├── lib/
    │   ├── actions.js              # executeAction(), preClassify(), intent sets, date helpers
    │   ├── creds.js                # getUserCreds(), notionReady() — shared credential helpers
    │   ├── digest.js               # runDigest(), setupCronJobs(), _digestCache
    │   └── email-cache.js          # getEmailCache/setEmailCache/invalidateEmailCache (DB + hot Map)
    ├── routes/
    │   ├── auth.js                 # /api/auth/* (login, signup, Google OAuth, refresh, logout)
    │   ├── account.js              # /api/users/me, /api/admin/*
    │   ├── credentials.js          # /api/integrations, /api/credentials/test/*
    │   ├── chat.js                 # /api/chat (SSE), /api/chat/agent (JSON)
    │   ├── tasks.js                # /api/tasks, /api/notes, /api/trello/*
    │   ├── comms.js                # /api/emails, /api/email/*, /api/calendar
    │   ├── github.js               # /api/prs, /api/github/*
    │   ├── digest.js               # /api/digest/run, /api/digest/latest
    │   ├── webhooks.js             # /api/webhook/github (HMAC verified)
    │   └── content.js              # /api/slack/send, /api/memory, /api/content/linkedin/*
    └── services/
        ├── tracing.js              # LangSmith setup — imported FIRST before any LangChain module
        ├── encryption.js           # AES-256-GCM encrypt/decrypt for stored keys
        ├── db.js                   # Neon Postgres pool + JSON fallback + schema (4 tables)
        ├── users.js                # bcrypt, JWT sign/verify, refresh token, user CRUD
        ├── auth.js                 # Google OAuth2 — per-user token file + DB backup
        ├── integrations.js         # Per-user encrypted key store (save/get/delete/list)
        ├── memory.js               # Per-user VIPs, voice profile, facts, log — Postgres + JSON fallback
        ├── llm.js                  # LangChain LLM router (Gemini ↔ Groq + fallback + streaming)
        ├── langchain-agent.js      # LangGraph tool-calling agent + rolling context window
        ├── gmail.js                # Gmail API: inbox triage, draft, send, archive
        ├── calendar.js             # Google Calendar: events, conflicts, focus blocks
        ├── notion.js               # Notion API: tasks DB + notes DB CRUD
        ├── slack.js                # Slack Web API: read channels, post messages
        ├── github.js               # GitHub REST: PRs, issues, changelog (multi-repo)
        ├── trello.js               # Trello API: board cards, move, stale detection
        ├── todoist.js              # Todoist REST API: tasks CRUD
        └── content.js              # LinkedIn post drafting + changelog/readme generation
```

---

## Full File-by-File Flow

### Server Startup (`server/index.js`)

The server boots in this order:

1. **`tracing.js`** imported first — sets LangSmith env vars before any LangChain module loads
2. **`initDB()`** — connects to Postgres or sets up JSON fallback; creates 4 tables: `users`, `user_integrations`, `user_memory`, `email_cache`
3. **`auth.restoreAllFromDB()`** — re-hydrates Google token files from DB (Railway wipes the filesystem on every restart)
4. **`migrateEnvCredentials()`** — imports any env var credentials into the DB for user ID 1 (idempotent)
5. **`migrateJsonIntegrations()`** — one-time migration of `users.json` + `integrations.json` → Postgres on first boot
6. **`setupCronJobs()`** — morning digest (9 AM) + calendar conflict check (7 AM)

---

### Auth Flow

```
User opens app
  → App.jsx checks localStorage for 'devos_token'
  → GET /api/users/me  (verifies JWT)
      users.js: jwt.verify(token, JWT_SECRET)
  → if valid:  show dashboard + fetch health
  → if 401:    clear token → show AuthPage
  → if 502/503 (server restarting): keep token, show Loading…

AuthPage — email/password path:
  POST /api/auth/signup
    users.js: validate → bcrypt.hash(password, 12) → db.createUser
    → jwt.sign(15m) as access token + jwt.sign(30d) as httpOnly refresh cookie
  POST /api/auth/login
    users.js: dbFindByUsername → bcrypt.compare
    → jwt.sign(15m) as access token + httpOnly refresh cookie set

Silent refresh (frontend):
  When apiFetch() gets a 401:
    → POST /api/auth/refresh  (browser sends refresh_token cookie automatically)
    → if valid: new 15m access token returned, cookie rotated
    → if invalid/expired: clear cookie → redirect to login

AuthPage — Google OAuth path:
  GET /api/auth/google/signin  (unauthenticated)
    auth.js: generateAuthUrl({ scope, access_type:'offline', prompt:'consent' })
  → Google consent screen
  → GET /api/auth/google/callback
    auth.js: exchange code → tokens → fetch Google profile
    db.js: find/create user by google_id or email → dbLinkGoogleId
    auth.js: saveTokens → tokens/{userId}.json + user_integrations table
    → redirect /?google_token=<jwt>
  App.jsx: store token → fetch /api/users/me → render dashboard
```

---

### Per-Request Credential Flow

Every protected route calls `requireAuth` middleware → then `getUserCreds(userId)`:

```
Request with Bearer token
  → requireAuth:  jwt.verify → req.user.userId
  → getUserCreds: integrations.getUserCredentials(userId)
      → SELECT all rows WHERE user_id = ? from user_integrations
      → decrypt each key_value with AES-256-GCM
      → return flat object: { NOTION_API_KEY, GITHUB_TOKEN, SLACK_BOT_TOKEN, ... }
  → service call receives injected creds
```

This means every user sees only their own data — credentials are always scoped to the authenticated `userId`.

---

### Chat Flow — Classic Mode (`/api/chat`)

```
User types in ChatPanel.jsx
  → POST /api/chat { message, history }
  → SSE headers set (Content-Type: text/event-stream)
  → getUserCreds(userId) → apiKeys extracted

Step 1 — Classify intent:
  preClassify(message)           ← fast deterministic regex patterns
  or llm.classify(message, schema, apiKeys)
    → LangChain: ChatGroq (Llama 3.1 8B) classify task
    → returns { actions: [{ intent, params }], reply }

Step 2 — Execute actions (parallel):
  Promise.allSettled(actions.map(a => executeAction(a.intent, a.params)))
    → routes to the right service: notion, gmail, calendar, github, etc.
  memory.logActivity(intent, params, status)

Step 3 — Stream reply:
  if action failed:  send error message directly (no second LLM call)
  if action write:   send classified.reply directly (no second LLM call)
  if query result:   llm.streamTokens(messages, { taskType:'chat' })
                       → LangChain .stream() → yield tokens → send SSE events
  send({ type:'done', reply, intents, affectedPanels })

App.jsx: affectedPanels → increment refreshKey for those panels → they re-fetch
```

---

### Chat Flow — Agent Mode (`/api/chat/agent`)

```
User types in ChatPanel.jsx (Agent toggle ON)
  → POST /api/chat/agent { message, history }
  → langchainAgent.runAgent({ message, history, creds, userId, executeAction })

Inside runAgent:
  1. modelCandidates(apiKeys)  → [Gemini factory, Groq factory]
  2. buildTools(...)           → 20+ LangChain Zod-typed tools
  3. SYSTEM_PROMPT             → includes today's date, connected tools, memory context
  4. buildContext(history)     → rolling summary if history > 6 turns
  5. createAgent({ model, tools, systemPrompt })
  6. agent.invoke({ messages })
       → LangGraph loop: pick tool → call tool → observe → pick next tool or reply
       → each tool delegates to executeAction() → same service layer as classic mode
  7. return { reply, toolsUsed }

res.json({ reply, intents: toolsUsed, affectedPanels })
App.jsx: same panel refresh logic as classic mode
```

---

### Data Storage — Two-tier

```
Production (Railway):
  Postgres (Neon)
  ├── users table            — id, username, email, bcrypt hash, google_id, is_admin
  ├── user_integrations      — user_id, service, key_name, key_value (AES encrypted)
  ├── user_memory            — user_id (PK), data JSONB — per-user VIPs/facts/voice profile/log
  └── email_cache            — user_id (PK), data JSONB, fetched_at — survives restarts (5 min TTL)

Local dev (no DATABASE_URL):
  server/users.json          — same user data as flat JSON
  server/integrations.json   — same keys as flat JSON (still AES encrypted)
  server/memory_{userId}.json — per-user memory fallback (written on every save)

Always on filesystem:
  server/tokens/{userId}.json  — Google OAuth tokens per user (fast read)
```

---

### Encryption Flow

```
Store API key:
  encrypt(plaintext)
    iv  = crypto.randomBytes(12)
    key = scrypt(ENCRYPTION_SECRET, 'devos-aes-salt-v1', 32)
    → AES-256-GCM → iv:authTag:ciphertext (base64url)
    → stored in DB / integrations.json

Read API key:
  decrypt(ciphertext)
    → split iv:authTag:body
    → AES-256-GCM decipher → plain text
```

Keys are never stored or logged in plain text. Even with full DB access, keys are unreadable without `ENCRYPTION_SECRET`.

---

## LangChain — Full Breakdown

### Packages

```json
"langchain": "^1.4.2"               // createAgent, tool, HumanMessage, AIMessage
"@langchain/core": "^1.1.48"        // SystemMessage, HumanMessage, AIMessage base types
"@langchain/google-genai": "^2.1.31" // ChatGoogleGenerativeAI (Gemini 2.0 Flash)
"@langchain/groq": "^1.2.1"         // ChatGroq (Llama 3.1 8B + Llama 3.3 70B for agent)
```

---

### 1. `services/tracing.js` — LangSmith Setup

Imported as the **very first line** of `index.js` before any other LangChain import.

**Why**: LangSmith reads env vars at module load time. If you set them after importing LangChain, tracing doesn't attach.

**What it does**: Sets `LANGSMITH_TRACING=true`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT` from a single `LANGSMITH_API_KEY` you put in `.env`. After that, every `.invoke()` and `.stream()` call is automatically traced — zero extra code needed anywhere else.

---

### 2. `services/llm.js` — LangChain LLM Router

This is the core LangChain layer used by every non-agent feature.

#### Model Classes

```js
new ChatGoogleGenerativeAI({ model: 'gemini-2.0-flash', apiKey, maxOutputTokens, streaming })
new ChatGroq({ model: 'llama-3.1-8b-instant', apiKey, maxTokens, streaming })
```

#### Task-Based Routing

```
Task type         Primary model           Why
───────────────────────────────────────────────────────────
digest            Gemini 2.0 Flash        Large context window, quality output
brief             Gemini 2.0 Flash
content           Gemini 2.0 Flash
changelog         Gemini 2.0 Flash
readme            Gemini 2.0 Flash
research          Gemini 2.0 Flash
blocker           Gemini 2.0 Flash
chat              Groq Llama 3.1 8B       Sub-second latency
triage            Groq Llama 3.1 8B
classify          Groq Llama 3.1 8B
intent            Groq Llama 3.1 8B
alert             Groq Llama 3.1 8B
```

The other provider is always the automatic fallback — if the primary key is missing or the API is down, LangChain retries on the other.

#### `.withFallbacks()` — Automatic Failover

```js
primary.withFallbacks({ fallbacks: [secondary] })
```

LangChain handles the retry automatically. If Gemini returns a 429 or network error, the same call is retried on Groq — the calling code doesn't know it happened.

#### Message Types

```js
new SystemMessage(...)   // role: 'system'
new HumanMessage(...)    // role: 'user'
new AIMessage(...)       // role: 'assistant'
```

Used to convert your `{ role, content }` conversation history into LangChain's format before calling `.invoke()` or `.stream()`.

#### Public Functions in `llm.js`

| Function | LangChain used | What |
|---|---|---|
| `call(messages, opts)` | `.invoke()` | Core — one LLM call, returns string or parsed JSON |
| `chat(message, system)` | `.invoke()` | Simple one-shot helper |
| `classify(text, schema)` | `.invoke()` with JSON mode | Intent classification → returns `{ actions: [...] }` |
| `generate(prompt, context, taskType)` | `.invoke()` | Long-form content generation (digest, changelog) |
| `streamTokens(messages, opts)` | `.stream()` | Async generator → yields string tokens for SSE streaming |

---

### 3. `services/langchain-agent.js` — Tool-Calling Agent

Used only when Agent Mode is toggled ON in ChatPanel. Exposed via `POST /api/chat/agent`.

#### `createAgent()` — LangGraph-based Agent Loop

```js
import { createAgent, tool, HumanMessage, AIMessage } from 'langchain';

const agent = createAgent({ model, tools, systemPrompt });
const result = await agent.invoke({ messages });
```

This runs the full **ReAct loop** automatically:
```
user message
  → model picks a tool and what params to pass
  → tool executes → result returned to model
  → model picks next tool OR decides to reply
  → final text reply returned
```
No manual classify-then-execute needed. The LLM decides which tools to call and in what order.

#### `tool()` — Zod-Typed Tool Definitions

Each action the agent can take is defined as a LangChain tool:

```js
tool(
  async (input) => {
    const result = await executeAction(intent, input, message, creds, userId);
    return JSON.stringify(result);
  },
  { name, description, schema: z.object({ ... }) }
)
```

The `schema` (Zod) is serialized to JSON Schema and sent to the model. The model must call the tool with valid JSON matching that schema — LangChain validates and retries automatically.

#### Full Tool List (20 tools)

| Tool | Intent | Service |
|---|---|---|
| `get_tasks` | List open tasks | Notion + Todoist |
| `add_task` | Create a task | Notion + Todoist |
| `update_task` | Mark done / rename | Notion + Todoist |
| `get_calendar` | Upcoming events | Google Calendar |
| `create_event` | Schedule an event | Google Calendar |
| `scan_conflicts` | Detect overlaps | Google Calendar |
| `get_emails` | Inbox triage | Gmail |
| `draft_email` | Write a draft | Gmail |
| `get_prs` | Open + stale PRs | GitHub |
| `get_issues` | Open issues | GitHub |
| `create_issue` | File an issue | GitHub |
| `get_trello` | Board cards | Trello |
| `get_notes` | Recent notes | Notion |
| `create_note` | Save a note | Notion |
| `run_digest` | Trigger daily digest | All services |
| `get_digest` | Fetch cached digest | memory.json |
| `draft_linkedin` | Write LinkedIn post | LLM (content.js) |
| `save_memory` | Remember a fact | memory.json |

Each tool delegates to `executeAction()` — the same function used in the classic `/api/chat` path. No logic is duplicated.

#### Rolling Context Window + Summarization

The agent keeps conversation history compact:

```
History ≤ 6 messages:
  → pass all messages verbatim

History > 6 messages:
  overflow = history[:-6]         ← older turns
  recent   = history[-6:]         ← last 6 kept verbatim

  model.invoke([ HumanMessage(`Summarise this conversation: ${overflow}`) ])
  → 2-3 sentence summary stored in rollingMemory Map (per userId, in-memory)

  Messages sent to agent:
    [ HumanMessage(summary), AIMessage("Understood..."), ...recent, HumanMessage(current) ]
```

Older context is compressed rather than dropped. Per-user summaries survive the session but reset on server restart.

#### Multi-Model Retry Strategy

```
candidates = [Gemini factory, Groq factory]  (only providers with keys included)

outer loop: for each model candidate
  inner loop: up to 3 attempts on same model
    if tool_use_failed or failed_generation → retry same model (Groq-specific flakiness)
    if quota / 429 / rate limit → skip to next candidate
    if success → return { reply, toolsUsed }

if all exhausted → throw friendly error message
```

#### Models Used in the Agent

- **Gemini 2.0 Flash** — `gemini-2.0-flash` — primary (reliable tool-call JSON)
- **Groq Llama 3.3 70B** — `llama-3.3-70b-versatile` — fallback (larger than 8B for better tool use)

Note: the agent uses 70B Llama (not 8B) because tool-calling reliability requires a stronger model.

---

### How Classic vs Agent Mode Compare

| | `/api/chat` (Classic) | `/api/chat/agent` (Agent) |
|---|---|---|
| **LangChain used for** | `llm.classify()` + `llm.streamTokens()` | `createAgent()` full tool loop |
| **Who decides what tool to call** | `llm.classify()` → structured JSON schema | The LLM inside the agent loop |
| **Response format** | SSE token stream | Single JSON reply |
| **History management** | Last 6 messages passed in from client | Rolling summary (server-side, per user) |
| **Retries** | `withFallbacks()` automatic | Manual candidate loop + 2× tool retry |
| **Multi-step actions** | Can run multiple intents in one message | Agent decides tool sequence dynamically |

---

## Frontend Panels

### ChatPanel
- Two modes: **Classic** (SSE token streaming) and **LangChain Agent** (JSON)
- Stores last 100 messages in localStorage
- Pre-classified command suggestions per connected tool
- `POST /api/chat` — streaming  |  `POST /api/chat/agent` — JSON

### DigestPanel
- 4 stat cards: emails pending, conflicts, blockers, content drafts
- Top 3 items from each sub-agent's result
- `GET /api/digest/latest` — non-blocking cached read
- `POST /api/digest/run` — triggers full parallel execution

### EmailPanel
- Unread inbox triage with P1/P2/P3 scoring
- AI-drafted reply suggestions inline
- Approve / skip / archive / delete actions

### CalendarPanel
- Next N events + overlap conflict detection
- Focus block creator ("Deep work" event)
- Create / update / delete via chat or UI buttons

### TaskPanel
- Kanban board: To Do → In Progress → Done (+ On Hold)
- Drag-and-drop between columns (syncs status to Notion/Todoist)
- Priority colour on card left-border (P1=red, P2=amber, P3=blue)
- Notion Notes column: list existing pages + "New page" inline form
- Source badge: Notion / Todoist / Trello

### GitHubPanel
- Tabs: Overview (PRs + issues) | Contributions | Branches
- Stale PR detection (configurable day threshold)
- Multi-repo dropdown
- LLM-drafted issue body from one-line description
- Changelog generator from merged PRs

### SettingsPage
- Test & save credentials for every service
- Shows connection status dot + last synced timestamp
- Service-specific validation before saving (e.g., checks Notion DB access)

---

## Backend Routes

### Auth
| Method | Route | What |
|---|---|---|
| GET | `/api/auth/google/signin` | Unauthenticated Google sign-in entry |
| GET | `/api/auth/google/init` | Authenticated: get OAuth URL with userId in state |
| GET | `/api/auth/google/callback` | Exchange code, create/link user, redirect with JWT + set refresh cookie |
| POST | `/api/auth/login` | Username + password → 15m access token + httpOnly refresh cookie |
| POST | `/api/auth/signup` | Create account → 15m access token + httpOnly refresh cookie |
| POST | `/api/auth/refresh` | Exchange refresh cookie → new access token (cookie rotated) |
| POST | `/api/auth/logout` | Clear refresh cookie |
| GET | `/api/users/me` | Current user profile |

### Credentials
| Method | Route | What |
|---|---|---|
| POST | `/api/credentials/test/:service` | Validate key + save on success |
| GET | `/api/integrations` | List all configured services |
| DELETE | `/api/integrations/:service` | Disconnect service |

### Data
| Method | Route | What |
|---|---|---|
| GET | `/api/health` | Status of all connected services |
| GET/POST | `/api/tasks` | Fetch / create (syncs Notion + Todoist simultaneously) |
| GET/POST | `/api/notes` | Notion notes CRUD |
| GET | `/api/emails` | Cached Gmail triage |
| GET/POST | `/api/calendar` | Events fetch / create |
| GET | `/api/digest/latest` | Latest digest cache |
| POST | `/api/digest/run` | Execute full digest (4 sub-agents parallel) |
| GET | `/api/prs` | Open PRs + stale detection |
| GET/POST | `/api/github/issues` | Issues fetch / create |
| GET | `/api/trello/board` | Lists + cards |
| POST | `/api/trello/move` | Move card between lists |
| POST | `/api/chat` | SSE streaming chat (classic mode) |
| POST | `/api/chat/agent` | LangChain agent (JSON, agent mode) |
| POST | `/api/chat/agent/clear` | Clear rolling summary for user |

---

## Integrations

| Service | Auth | Key operations |
|---|---|---|
| **Notion** | Integration secret (`ntn_`) | getTasks, createTask, updateStatus, getNotes, createNote |
| **Gmail** | Google OAuth (gmail.modify scope) | getInbox, triageInbox (P1/P2/P3), createDraft, sendEmail, archiveEmail |
| **Calendar** | Google OAuth (calendar scope) | getUpcoming, createEvent, createRecurring, scanConflicts, blockFocusTime |
| **GitHub** | PAT (`ghp_` / `github_pat_`) | getOpenPRs, getIssues, createIssue, updateIssue, generateChangelog |
| **Slack** | Bot token (`xoxb-`) | sendDM, sendDigest (Block Kit) |
| **Trello** | API key + token | getLists, getCards, createCard, moveCard, scanStaleCards |
| **Todoist** | API token | getTasks, createTask, updateStatus, deleteTask |
| **LinkedIn** | Webhook URL | draftLinkedInPost (3 variants: storytelling, concise, technical) |

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...neon.tech/...     # Neon pooled connection
ENCRYPTION_SECRET=<32+ char random string>     # AES-256-GCM key derivation

# AI
GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...
LANGSMITH_API_KEY=lsv2_...                     # Optional — enables LangSmith tracing

# Google OAuth
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# Notion
NOTION_API_KEY=ntn_...
NOTION_TASKS_DB_ID=<32-char hex>
NOTION_NOTES_DB_ID=<32-char hex>

# GitHub
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=username
GITHUB_REPOS=owner/repo1,owner/repo2

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_USER_ID=U123ABC

# Trello
TRELLO_API_KEY=...
TRELLO_TOKEN=...
TRELLO_BOARD_ID=...

# Todoist
TODOIST_API_KEY=...

# LinkedIn
LINKEDIN_WEBHOOK_URL=https://...

# Deployment
RAILWAY_PUBLIC_DOMAIN=myapp.railway.app
PORT=3001
JWT_SECRET=<random string>
USER_TIMEZONE=America/New_York
```

---

## Improvements Implemented

### ✅ 1. Split `server/index.js`
The 2000-line monolith is now a 160-line thin entry point. All routes live in `server/routes/` (10 files), shared logic in `server/lib/` (4 files), middleware in `server/middleware/` (2 files).

### ✅ 2. Per-user memory
`memory.json` (global, bleeds across accounts) replaced by a `user_memory` table in Postgres. Every function in `memory.js` now takes `userId` as its first argument. JSON file fallback (`memory_{userId}.json`) for local dev. Old `memory.json` is migrated for user ID 1 on first load.

### ⏳ 3. Real job queue
`node-cron` is still used for digest scheduling. BullMQ + Redis would be more reliable (survives restarts, per-user scheduling, retries) but requires an external Redis instance. Flagged for when Railway Redis addon is added.

### ⏳ 4. Merge chat paths
`/api/chat` (classic SSE) and `/api/chat/agent` (LangChain JSON) still co-exist. Merging to one streaming LangGraph SSE path is the right long-term direction but requires frontend changes. Kept both paths for now.

### ✅ 5. JWT refresh
Access tokens are now **15 minutes** (down from 90 days). On login/signup/Google auth, a 30-day refresh token is set as an httpOnly `SameSite=Lax` cookie scoped to `/api/auth/refresh`. The client calls `POST /api/auth/refresh` on 401 to silently renew; on failure, it redirects to login.

### ✅ 6. Rate limiting
`express-rate-limit` wired up with per-user key generators:
- `/api/digest/run` — 10 calls / hour / user
- `/api/chat`, `/api/chat/agent` — 120 calls / minute / user
- `/api/auth/login`, `/api/auth/signup` — 20 calls / 15 min / IP
- `/api/credentials/test/*` — 30 calls / minute / user

### ✅ 7. Persist email cache
`_emailCache` Map is now backed by an `email_cache` Postgres table (user_id PK, data JSONB, fetched_at). On GET /api/emails: hot Map → DB → live fetch. Writes go to both. Invalidation deletes from both. 5-minute TTL survives server restarts.

### ✅ 8. LinkedIn posting
`POST /api/content/approve` with `postNow: true` fires a `LINKEDIN_WEBHOOK_URL` (stored as a per-user credential). The webhook can point to Zapier, Make, or n8n — any of which can post to LinkedIn, Buffer, or Typefully. Draft-only mode still works when no webhook is configured.

---

## One-Line Summary

DevOS is a modular personal AI command centre — encrypted per-user credentials, task-routed LangChain LLM calls with automatic failover, Zod-typed tool-calling agent, per-user Postgres memory, JWT refresh flow, rate limiting, persistent email cache, and a clean Kanban UI across 10 route modules. Remaining work: BullMQ job queue (needs Redis) and merging the two chat paths into one streaming LangGraph agent.
