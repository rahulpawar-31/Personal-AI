#!/bin/bash

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Narrowed from the stock git-guardrails-claude-code list: plain "git push"
# is intentionally NOT blocked here (this repo's workflow pushes feature
# branches to open PRs routinely) — only force-push variants are.
DANGEROUS_PATTERNS=(
  "git push.*--force"
  "git push.* -f"
  "git reset --hard"
  "reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this." >&2
    exit 2
  fi
done

exit 0
