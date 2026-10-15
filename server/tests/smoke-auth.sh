#!/usr/bin/env bash
# server/tests/smoke-auth.sh
#
# Auth smoke test: proves the app's routes are actually guarded, and that one
# user cannot see or act on another user's data, instead of trusting a code read.
#
# It boots its own throwaway server instances (JSON-file store, no DATABASE_URL,
# fake JWT/ENCRYPTION secrets, no real third-party credentials), so it needs
# nothing but Node + the already-installed server/node_modules — safe for CI and
# for local use. Two phases, each against a fresh server:
#
#   Phase 1 — open signup (OWNER_USERNAME unset, as in development):
#     a. For ~60 routes (every panel, account, admin, action and content route):
#        no Authorization header -> 401; a real JWT (minted via POST /api/auth/signup,
#        not hand-crafted) -> the route's expected authed status. Admin routes
#        must answer 403 to a non-admin user.
#     b. Two-user isolation: user B cannot see user A's saved integrations,
#        pending agent actions or memory, and cannot approve or reject A's action.
#   Phase 2 — invite-only signup (OWNER_USERNAME set, as in production):
#     c. A different username is refused (400); the owner username is accepted.
#
# server/tests/routeGuards.test.js complements this statically: it fails if any
# route is added without requireAuth/requireAdmin and without being on its
# explicit public list.
#
# Exit code is non-zero if any assertion fails.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${SMOKE_TEST_PORT:-4173}"
BASE_URL="http://127.0.0.1:${PORT}"
RUN_ID="$$_${RANDOM}"
TEST_USER="smoketest_${RUN_ID}"
TEST_USER_B="smoketestb_${RUN_ID}"
OWNER_NAME="smokeowner_${RUN_ID}"
TEST_PASS="Sm0keTest!Password1"
# A variable, because "${body:-{}}" does not expand to a plain {} in bash.
EMPTY_JSON='{}'

FAILURES=0
SERVER_PID=""
LOG_FILE="$(mktemp -t devos-smoke-auth.XXXXXX)"

remove_data_files() {
  # The throwaway server keeps its state in these gitignored files inside
  # server/ (the paths are fixed in the code). Only called once
  # set_aside_data_files has run, so it can never delete someone's real data.
  # tokens.json and memory.json are the legacy single-file formats the server
  # still migrates from: a real one would be adopted by the throwaway server's
  # first user (id 1), so they are set aside and removed like the rest.
  rm -f "$SERVER_DIR/users.json" "$SERVER_DIR/integrations.json" "$SERVER_DIR/pending_actions.json"
  rm -f "$SERVER_DIR/tokens.json" "$SERVER_DIR/memory.json"
  rm -f "$SERVER_DIR"/memory_*.json
  rm -rf "$SERVER_DIR/tokens"
}

# A developer running this locally may have real accounts, saved (encrypted)
# keys, per-user memory and Google tokens in those same files. Move them to a
# temp directory before the test touches anything, and put them back on exit.
# A hard kill (SIGKILL) skips the restore, but the files are then still in the
# directory printed below, not deleted.
BACKUP_DIR=""
DATA_SET_ASIDE=0
set_aside_data_files() {
  local f
  for f in "$SERVER_DIR/users.json" "$SERVER_DIR/integrations.json" "$SERVER_DIR/pending_actions.json" \
           "$SERVER_DIR/tokens.json" "$SERVER_DIR/memory.json" \
           "$SERVER_DIR"/memory_*.json "$SERVER_DIR/tokens"; do
    [[ -e "$f" ]] || continue
    if [[ -z "$BACKUP_DIR" ]]; then
      BACKUP_DIR="$(mktemp -d -t devos-smoke-backup.XXXXXX)"
      echo "==> Existing local data found in server/: setting it aside in $BACKUP_DIR (restored on exit)"
    fi
    mv "$f" "$BACKUP_DIR/" || { echo "FAIL: could not move $f aside; refusing to continue"; exit 1; }
  done
  DATA_SET_ASIDE=1
}

restore_data_files() {
  [[ -n "$BACKUP_DIR" ]] || return 0
  local f failed=0
  for f in "$BACKUP_DIR"/* "$BACKUP_DIR"/.[!.]*; do
    [[ -e "$f" ]] || continue
    mv "$f" "$SERVER_DIR/" || failed=1
  done
  if [[ "$failed" -eq 0 ]]; then
    rmdir "$BACKUP_DIR" 2>/dev/null
  else
    echo "WARNING: could not restore all local data files; they are still in $BACKUP_DIR"
  fi
}

stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 10); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""
}

cleanup() {
  stop_server
  # Test files are removed only after the real ones are safely aside; the
  # restore runs even if setting them aside stopped part-way.
  [[ "$DATA_SET_ASIDE" -eq 1 ]] && remove_data_files
  restore_data_files
  rm -f "$LOG_FILE"
}
trap cleanup EXIT
# Ctrl-C and a termination signal must still run the cleanup (and so the restore).
trap 'exit 130' INT TERM HUP

# Fail fast (rather than silently testing a stale, already-running server) if
# something is already bound to the port we're about to use.
if curl -s -o /dev/null --max-time 1 "$BASE_URL/api/webhook/info" 2>/dev/null; then
  echo "FAIL: something is already listening on ${BASE_URL} — refusing to run against it."
  echo "      Set SMOKE_TEST_PORT to a free port, or stop whatever is using ${PORT}."
  exit 1
fi

set_aside_data_files

# start_server <OWNER_USERNAME or empty>
start_server() {
  local owner="$1"
  remove_data_files
  # `exec` replaces the subshell's own process image with node's, so the PID
  # bash captures via $! below is node's real PID (not a wrapper we can't kill).
  (
    cd "$SERVER_DIR" && \
    exec env \
      PORT="$PORT" \
      NODE_ENV=test \
      JWT_SECRET="smoke-test-jwt-secret-do-not-use-in-prod" \
      ENCRYPTION_SECRET="smoke-test-encryption-secret-32-chars-min" \
      DATABASE_URL="" \
      OWNER_USERNAME="$owner" \
      node index.js >"$LOG_FILE" 2>&1
  ) &
  SERVER_PID=$!

  local ready=0
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "$BASE_URL/api/webhook/info"; then
      ready=1
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "FAIL: server process exited during startup. Log:"
      cat "$LOG_FILE"
      exit 1
    fi
    sleep 0.5
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "FAIL: server did not start within 15s. Log:"
    cat "$LOG_FILE"
    exit 1
  fi
  echo "    server is up (pid $SERVER_PID)"
}

fail() { echo "  [FAIL] $1"; FAILURES=$((FAILURES + 1)); }
pass() { echo "  [PASS] $1"; }

assert_status() { # label expected actual
  if [[ "$3" == "$2" ]]; then pass "$1 -> $3"; else fail "$1 -> expected $2, got $3"; fi
}
assert_contains() { # label haystack needle
  if [[ "$2" == *"$3"* ]]; then pass "$1"; else fail "$1 (expected to find '$3')"; fi
}
assert_not_contains() { # label haystack needle
  if [[ "$2" != *"$3"* ]]; then pass "$1"; else fail "$1 (must NOT contain '$3')"; fi
}

# json_field <json> <dot.path> — prints the value, or nothing if absent/unparseable.
json_field() {
  node -e "
try {
  let v = JSON.parse(process.argv[1]);
  for (const k of process.argv[2].split('.')) v = v?.[k];
  process.stdout.write(v === undefined || v === null ? '' : String(v));
} catch { process.stdout.write(''); }
" "$1" "$2"
}

# api <token> <METHOD> <path> [json-body] — prints the response body.
api() {
  local token="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -X "$method" "$BASE_URL$path")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  if [[ "$method" != "GET" ]]; then args+=(-H "Content-Type: application/json" -d "${body:-$EMPTY_JSON}"); fi
  curl "${args[@]}"
}

# status <token> <METHOD> <path> [json-body] — prints only the HTTP status code.
status() {
  local token="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  if [[ "$method" != "GET" ]]; then args+=(-H "Content-Type: application/json" -d "${body:-$EMPTY_JSON}"); fi
  curl "${args[@]}"
}

# signup <username> — prints the raw signup response.
signup() {
  curl -s -X POST "$BASE_URL/api/auth/signup" -H "Content-Type: application/json" \
    -d "{\"username\":\"$1\",\"password\":\"${TEST_PASS}\",\"email\":\"$1@example.com\"}"
}

# Each row: label|METHOD|path|json-body-or-empty|expected-status-with-valid-token
# `authed` means "got past authentication": anything except 401 or 403. It is
# used where the route then fails for an unrelated reason (a service that is
# deliberately not configured in this test), which is correct behaviour and
# not an auth result. Bodies are minimal-but-valid so a 400 for bad input is
# never mistaken for the 401 (no auth) / authed outcomes this test checks.
check() {
  local label="$1" method="$2" path="$3" body="$4" expect_authed="$5"
  local status_noauth status_auth

  status_noauth=$(status "" "$method" "$path" "$body")
  if [[ "$status_noauth" == "401" ]]; then
    pass "$label ($method $path) -> 401 with no Authorization header"
  else
    fail "$label ($method $path) -> expected 401 with no Authorization header, got $status_noauth"
  fi

  status_auth=$(status "$TOKEN" "$method" "$path" "$body")
  if [[ "$expect_authed" == "authed" ]]; then
    if [[ "$status_auth" != "401" && "$status_auth" != "403" ]]; then
      pass "$label ($method $path) -> $status_auth with a valid token (got past auth)"
    else
      fail "$label ($method $path) -> expected to get past auth with a valid token, got $status_auth"
    fi
  elif [[ "$status_auth" == "$expect_authed" ]]; then
    pass "$label ($method $path) -> $status_auth with a valid token"
  else
    fail "$label ($method $path) -> expected $expect_authed with a valid token, got $status_auth"
  fi
}

run_routes() {
  local entry label method path body expect
  for entry in "$@"; do
    IFS='|' read -r label method path body expect <<< "$entry"
    check "$label" "$method" "$path" "$body" "$expect"
  done
}

# ═══════════════════════════════════════════════════════════════════════════════
echo "==> PHASE 1 — open signup (OWNER_USERNAME unset). Starting a throwaway server on port ${PORT}"
start_server ""

echo "==> Minting real JWTs via POST /api/auth/signup (user A and user B)"
SIGNUP_A=$(signup "$TEST_USER")
TOKEN=$(json_field "$SIGNUP_A" token)
USER_A_ID=$(json_field "$SIGNUP_A" user.id)
SIGNUP_B=$(signup "$TEST_USER_B")
TOKEN_B=$(json_field "$SIGNUP_B" token)
if [[ -z "$TOKEN" || -z "$TOKEN_B" || -z "$USER_A_ID" ]]; then
  echo "FAIL: could not obtain JWTs from signup. A: $SIGNUP_A  B: $SIGNUP_B"
  exit 1
fi
echo "    signup ok: '${TEST_USER}' (id ${USER_A_ID}) and '${TEST_USER_B}'"

# Routes whose services are deliberately not configured here (no Notion, GitHub,
# Google, Trello, Todoist keys). Run BEFORE the fake Notion key below is saved,
# so none of them can reach out to a third-party API with it.
echo "==> Auth checks: account, admin, action, content, GitHub, task and email routes"
run_routes \
  "integrations (list)|GET|/api/integrations||200" \
  "health|GET|/api/health||200" \
  "auth status|GET|/api/auth/status||200" \
  "google email|GET|/api/auth/google/email||200" \
  "google init|GET|/api/auth/google/init||200" \
  "actions (pending list)|GET|/api/actions/pending||200" \
  "actions (approve)|POST|/api/actions/999999/approve||404" \
  "actions (reject)|POST|/api/actions/999999/reject||404" \
  "memory|GET|/api/memory||200" \
  "activity|GET|/api/activity||200" \
  "memory (add vip)|POST|/api/memory/vip|{\"email\":\"vip@example.com\",\"name\":\"Vip\"}|200" \
  "linkedin (history)|GET|/api/content/linkedin/history||200" \
  "linkedin (draft)|POST|/api/content/linkedin|{\"source\":\"smoke\"}|authed" \
  "content (approve)|POST|/api/content/approve|{\"original\":\"o\",\"edited\":\"e\"}|200" \
  "trello (cards)|GET|/api/cards||200" \
  "trello (move)|POST|/api/trello/move|{\"cardId\":\"x\",\"listId\":\"y\"}|authed" \
  "github (prs)|GET|/api/prs||200" \
  "github (issues list)|GET|/api/github/issues||200" \
  "github (issue create)|POST|/api/github/issues|{\"title\":\"smoke\"}|authed" \
  "github (merged)|GET|/api/github/merged||200" \
  "github (changelog)|GET|/api/github/changelog||200" \
  "github (contributions)|GET|/api/github/contributions||200" \
  "github (branches)|GET|/api/github/branches||200" \
  "github (draft body)|POST|/api/github/draft-body|{\"title\":\"smoke\"}|authed" \
  "tasks (create)|POST|/api/tasks|{\"title\":\"smoke\"}|authed" \
  "task (update)|POST|/api/task/update|{\"taskId\":\"1\",\"status\":\"done\"}|400" \
  "notes (create, no Notion)|POST|/api/notes|{\"title\":\"t\",\"content\":\"c\"}|400" \
  "notes (export, no Notion)|GET|/api/notes/export||400" \
  "calendar (create)|POST|/api/calendar|{\"title\":\"smoke\",\"date\":\"2030-01-01\"}|authed" \
  "email (send, invalid recipient)|POST|/api/email/send|{\"to\":\"nope\",\"body\":\"b\"}|400" \
  "email (approve-draft, empty)|POST|/api/email/approve-draft||400" \
  "email (archive)|POST|/api/email/archive|{\"id\":\"x\"}|authed" \
  "email (get one, no Google)|GET|/api/email/abc||403" \
  "account (update email)|PUT|/api/users/me/email|{\"email\":\"smoke@example.com\"}|200" \
  "admin (users) — non-admin refused|GET|/api/admin/users||403" \
  "admin (stats) — non-admin refused|GET|/api/admin/stats||403" \
  "admin (delete user) — non-admin refused|DELETE|/api/admin/users/999999||403" \
  "admin (set admin) — non-admin refused|PATCH|/api/admin/users/999999/admin|{\"isAdmin\":true}|403"

echo "==> Seeding a fake Notion integration for user A (POST /api/integrations) so GET /api/notes"
echo "    exercises its real 'fetch notes' code path instead of its 'not configured' 404 —"
echo "    that 404 is correct app behavior, not an auth failure, and would otherwise mask"
echo "    a real auth regression on this route."
curl -s -o /dev/null -X POST "$BASE_URL/api/integrations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service":"notion","keyName":"NOTION_API_KEY","keyValue":"ntn_smoketest_fake_key_not_real_0000000"}'
curl -s -o /dev/null -X POST "$BASE_URL/api/integrations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service":"notion","keyName":"NOTION_TASKS_DB_ID","keyValue":"00000000000000000000000000000000"}'

echo "==> Auth checks: the original panel routes (200 with a valid token)"
run_routes \
  "email (list)|GET|/api/emails||200" \
  "calendar (list)|GET|/api/calendar||200" \
  "tasks (list)|GET|/api/tasks||200" \
  "github (repos)|GET|/api/github/repos||200" \
  "slack (send)|POST|/api/slack/send|{\"text\":\"smoke test\"}|200" \
  "notion (notes)|GET|/api/notes||200" \
  "trello (board)|GET|/api/trello/board||200" \
  "digest (latest)|GET|/api/digest/latest||200" \
  "chat (agent/clear)|POST|/api/chat/agent/clear||200"

# ─── Two-user isolation ────────────────────────────────────────────────────────
echo "==> Two-user isolation: user B must not see or act on user A's data"

# 1. Saved integrations
A_INT=$(api "$TOKEN" GET /api/integrations)
B_INT=$(api "$TOKEN_B" GET /api/integrations)
assert_contains     "A sees their own saved Notion integration" "$A_INT" "NOTION_API_KEY"
assert_not_contains "B does not see A's saved integrations"     "$B_INT" "notion"

# 2. Memory (a VIP user A added in the table above)
A_MEM=$(api "$TOKEN" GET /api/memory)
B_MEM=$(api "$TOKEN_B" GET /api/memory)
assert_contains     "A sees their own VIP in memory"      "$A_MEM" "vip@example.com"
assert_not_contains "B does not see A's memory"           "$B_MEM" "vip@example.com"

# 3. Pending agent actions: seed one for user A directly (the real producer is the
#    LLM agent, which this test cannot drive), then try to touch it as user B.
ACTION_ID=$(cd "$SERVER_DIR" && DATABASE_URL="" node --input-type=module -e "
import { initDB, dbCreatePendingAction } from './services/db.js';
await initDB();
const row = await dbCreatePendingAction(Number(process.argv[1]), 'save_memory', { memKey: 'isolation', memValue: 'a-private-value' }, 'isolation smoke test');
process.stdout.write('\nACTION_ID=' + row.id);
" "$USER_A_ID" 2>/dev/null | sed -n 's/^ACTION_ID=//p')
if [[ -z "$ACTION_ID" ]]; then
  fail "could not seed a pending action for user A"
else
  A_PEND=$(api "$TOKEN" GET /api/actions/pending)
  B_PEND=$(api "$TOKEN_B" GET /api/actions/pending)
  assert_contains     "A sees their own pending action"          "$A_PEND" "a-private-value"
  assert_not_contains "B does not see A's pending actions"       "$B_PEND" "a-private-value"
  assert_status "B cannot approve A's pending action (id $ACTION_ID)" 404 "$(status "$TOKEN_B" POST "/api/actions/$ACTION_ID/approve")"
  assert_status "B cannot reject A's pending action (id $ACTION_ID)"  404 "$(status "$TOKEN_B" POST "/api/actions/$ACTION_ID/reject")"
  A_PEND_AFTER=$(api "$TOKEN" GET /api/actions/pending)
  assert_contains     "A's action is still pending after B's attempts" "$A_PEND_AFTER" "a-private-value"
  assert_status "A can reject their own pending action" 200 "$(status "$TOKEN" POST "/api/actions/$ACTION_ID/reject")"
fi

# 4. A deleted/foreign id on a user-scoped route must not leak the other user's data
assert_status "B cannot delete A's integration by guessing the route" 200 "$(status "$TOKEN_B" DELETE /api/integrations/notion)"
A_INT_AFTER=$(api "$TOKEN" GET /api/integrations)
assert_contains "A's Notion integration survives B's delete request" "$A_INT_AFTER" "NOTION_API_KEY"

stop_server

# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "==> PHASE 2 — invite-only signup (OWNER_USERNAME=${OWNER_NAME}). Fresh server on port ${PORT}"
start_server "$OWNER_NAME"

# mktemp, not a fixed /tmp name: curl -o would follow a symlink planted at a
# predictable path and overwrite whatever it points to.
STRANGER_FILE="$(mktemp -t devos-smoke-stranger.XXXXXX)"
STRANGER_STATUS=$(curl -s -o "$STRANGER_FILE" -w "%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"stranger_${RUN_ID}\",\"password\":\"${TEST_PASS}\"}")
STRANGER_BODY=$(cat "$STRANGER_FILE" 2>/dev/null); rm -f "$STRANGER_FILE"
assert_status   "signup with a username that is not the owner is refused" 400 "$STRANGER_STATUS"
assert_contains "the refusal says signups are invite-only" "$STRANGER_BODY" "invite-only"

OWNER_RESP=$(signup "$OWNER_NAME")
assert_contains "signup with the owner username is accepted and returns a token" "$OWNER_RESP" '"token"'

# The gate ignores letter case, matching how usernames are stored (lowercased).
CASE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$(echo "$OWNER_NAME" | tr '[:lower:]' '[:upper:]')\",\"password\":\"${TEST_PASS}\"}")
assert_status "the owner username in different case is not a way round the gate (taken, not a new account)" 400 "$CASE_STATUS"

stop_server

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "SMOKE TEST PASSED — routes reject requests with no token (401), admin routes refuse non-admins (403), users cannot see or act on each other's data, and signup is invite-only when OWNER_USERNAME is set."
  exit 0
else
  echo "SMOKE TEST FAILED — $FAILURES check(s) failed. Server log:"
  cat "$LOG_FILE"
  exit 1
fi
