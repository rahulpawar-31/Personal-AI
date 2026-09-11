#!/usr/bin/env bash
# server/tests/smoke-auth.sh
#
# P3 auth smoke test: proves every panel-data route in this app is actually
# guarded by requireAuth, instead of trusting a code read.
#
# For each panel route (email, calendar, tasks, GitHub, Slack, Notion, Trello,
# digest, chat) this:
#   1. Sends a request with NO Authorization header  -> must be 401.
#   2. Sends a request with a real JWT (minted via a real POST /api/auth/signup
#      call, not hand-crafted)                        -> must succeed (200).
#
# It boots its own throwaway server instance (JSON-file store, no
# DATABASE_URL, fake JWT/ENCRYPTION secrets, no third-party integration
# credentials) so it needs nothing but Node + the already-installed
# server/node_modules to run — safe for CI and for local use.
#
# Exit code is non-zero if any assertion fails.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${SMOKE_TEST_PORT:-4173}"
BASE_URL="http://127.0.0.1:${PORT}"
RUN_ID="$$_${RANDOM}"
TEST_USER="smoketest_${RUN_ID}"
TEST_PASS="Sm0keTest!Password1"

FAILURES=0
SERVER_PID=""
LOG_FILE="$(mktemp -t devos-smoke-auth.XXXXXX)"

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 10); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  # These are gitignored, but this run may have created them fresh — leave no trace.
  rm -f "$SERVER_DIR/users.json" "$SERVER_DIR/integrations.json"
  rm -rf "$SERVER_DIR/tokens"
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

# Fail fast (rather than silently testing a stale, already-running server) if
# something is already bound to the port we're about to use.
if curl -s -o /dev/null --max-time 1 "$BASE_URL/api/webhook/info" 2>/dev/null; then
  echo "FAIL: something is already listening on ${BASE_URL} — refusing to run against it."
  echo "      Set SMOKE_TEST_PORT to a free port, or stop whatever is using ${PORT}."
  SERVER_PID=""
  exit 1
fi

echo "==> Starting a throwaway server on port ${PORT} (JSON-file store, no external integrations)"
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
    OWNER_USERNAME="" \
    node index.js >"$LOG_FILE" 2>&1
) &
SERVER_PID=$!

echo "==> Waiting for the server to come up..."
READY=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "$BASE_URL/api/webhook/info"; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL: server process exited during startup. Log:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 0.5
done
if [[ "$READY" -ne 1 ]]; then
  echo "FAIL: server did not start within 15s. Log:"
  cat "$LOG_FILE"
  exit 1
fi
echo "    server is up (pid $SERVER_PID)"

echo "==> Minting a real JWT via POST /api/auth/signup"
SIGNUP_RESP=$(curl -s -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_PASS}\",\"email\":\"${TEST_USER}@example.com\"}")

TOKEN=$(node -e "
try {
  const r = JSON.parse(process.argv[1]);
  process.stdout.write(r.token || '');
} catch {
  process.stdout.write('');
}
" "$SIGNUP_RESP")

if [[ -z "$TOKEN" ]]; then
  echo "FAIL: could not obtain a JWT from the signup response: $SIGNUP_RESP"
  exit 1
fi
echo "    signup ok, got JWT for user '${TEST_USER}'"

echo "==> Seeding a fake Notion integration (POST /api/integrations) so GET /api/notes"
echo "    exercises its real 'fetch notes' code path instead of its 'not configured' 404 —"
echo "    that 404 is correct app behavior, not an auth failure, and would otherwise mask"
echo "    a real auth regression on this route."
curl -s -o /dev/null -X POST "$BASE_URL/api/integrations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service":"notion","keyName":"NOTION_API_KEY","keyValue":"ntn_smoketest_fake_key_not_real_0000000"}'
curl -s -o /dev/null -X POST "$BASE_URL/api/integrations" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service":"notion","keyName":"NOTION_TASKS_DB_ID","keyValue":"00000000000000000000000000000000"}'

# Each row: label|METHOD|path|json-body-or-empty|expected-status-with-valid-token
# All bodies are minimal-but-valid for their route so a 400 (bad input) can never
# be mistaken for the 401 (no auth) / 200 (authed) outcomes this test checks.
ROUTES=(
  "email (list)|GET|/api/emails||200"
  "calendar (list)|GET|/api/calendar||200"
  "tasks (list)|GET|/api/tasks||200"
  "github (repos)|GET|/api/github/repos||200"
  "slack (send)|POST|/api/slack/send|{\"text\":\"smoke test\"}|200"
  "notion (notes)|GET|/api/notes||200"
  "trello (board)|GET|/api/trello/board||200"
  "digest (latest)|GET|/api/digest/latest||200"
  "chat (agent/clear)|POST|/api/chat/agent/clear||200"
)

check() {
  local label="$1" method="$2" path="$3" body="$4" expect_authed="$5"
  local status_noauth status_auth payload="$body"
  [[ -z "$payload" ]] && payload='{}'

  if [[ "$method" == "GET" ]]; then
    status_noauth=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL$path")
  else
    status_noauth=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Content-Type: application/json" -d "$payload")
  fi

  if [[ "$status_noauth" == "401" ]]; then
    echo "  [PASS] $label ($method $path) -> 401 with no Authorization header"
  else
    echo "  [FAIL] $label ($method $path) -> expected 401 with no Authorization header, got $status_noauth"
    FAILURES=$((FAILURES + 1))
  fi

  if [[ "$method" == "GET" ]]; then
    status_auth=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN")
  else
    status_auth=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload")
  fi

  if [[ "$status_auth" == "$expect_authed" ]]; then
    echo "  [PASS] $label ($method $path) -> $status_auth with a valid token"
  else
    echo "  [FAIL] $label ($method $path) -> expected $expect_authed with a valid token, got $status_auth"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "==> Running 401 (no token) / 200 (valid token) checks for every panel route"
for entry in "${ROUTES[@]}"; do
  IFS='|' read -r label method path body expect <<< "$entry"
  check "$label" "$method" "$path" "$body" "$expect"
done

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo "SMOKE TEST PASSED — every panel route rejects requests with no token (401) and accepts a valid token (200)."
  exit 0
else
  echo "SMOKE TEST FAILED — $FAILURES check(s) failed. Server log:"
  cat "$LOG_FILE"
  exit 1
fi
