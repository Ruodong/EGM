#!/bin/bash
# run-affected-tests.sh — Claude Code PostToolUse hook
# Reads hook JSON from stdin, extracts file_path, looks up affected tests
# from scripts/test-map.json, and runs them.
# Can also be called directly: ./scripts/run-affected-tests.sh <file-path>

set -uo pipefail
cd "$(dirname "$0")/.."

MAP_FILE="scripts/test-map.json"

# Get file path: from $1 (manual mode) or stdin JSON (hook mode)
if [ -n "${1:-}" ]; then
  FILE="$1"
else
  INPUT=$(cat)
  FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
fi

if [ -z "$FILE" ]; then
  exit 0
fi

# Normalize to relative path
FILE="${FILE#$PWD/}"

# Skip non-source files
case "$FILE" in
  *.py|*.ts|*.tsx) ;;
  *) exit 0 ;;
esac

# Skip test files themselves (don't trigger re-run when editing tests)
case "$FILE" in
  api-tests/*|e2e-tests/*) exit 0 ;;
esac

# Look up tests from test-map.json
# Strategy: exact match → prefix match (key ends with /) → wildcards
# Uses three separate jq calls to avoid cross-expression error propagation
lookup_tests() {
  local file="$1"
  local kind="$2"  # "api" or "e2e"

  {
    # 1. Exact match in mappings
    jq -r --arg f "$file" --arg k "$kind" \
      '(.mappings[$f] // null) | if . then .[$k][] else empty end' "$MAP_FILE" 2>/dev/null

    # 2. Prefix match: keys ending with "/" where file starts with key
    jq -r --arg f "$file" --arg k "$kind" \
      '[.mappings | to_entries[] | select(.key | endswith("/"))] | .[] | select(.key as $k | $f | startswith($k)) | .value[$k][]' "$MAP_FILE" 2>/dev/null

    # 3. Exact match in wildcards
    jq -r --arg f "$file" --arg k "$kind" \
      '(.wildcards[$f] // null) | if . then .[$k][] else empty end' "$MAP_FILE" 2>/dev/null
  } | sort -u
}

# macOS bash 3.2 compatible: read into arrays using while loop
API_TESTS=()
while IFS= read -r line; do
  [ -n "$line" ] && API_TESTS+=("$line")
done < <(lookup_tests "$FILE" "api")

E2E_TESTS=()
while IFS= read -r line; do
  [ -n "$line" ] && E2E_TESTS+=("$line")
done < <(lookup_tests "$FILE" "e2e")

# Nothing to run
if [ ${#API_TESTS[@]} -eq 0 ] && [ ${#E2E_TESTS[@]} -eq 0 ]; then
  exit 0
fi

FAILED=0
RESULTS=""

# Run API tests
if [ ${#API_TESTS[@]} -gt 0 ]; then
  API_OUTPUT=$(python3 -m pytest "${API_TESTS[@]}" -v --tb=short 2>&1) || FAILED=1
  PASSED=$(echo "$API_OUTPUT" | grep -oE '[0-9]+ passed' | head -1)
  FAIL_COUNT=$(echo "$API_OUTPUT" | grep -oE '[0-9]+ failed' | head -1)
  RESULTS="API: ${PASSED:-0 passed}${FAIL_COUNT:+ $FAIL_COUNT}"
fi

# Run E2E tests
if [ ${#E2E_TESTS[@]} -gt 0 ]; then
  E2E_OUTPUT=$(npx playwright test "${E2E_TESTS[@]}" --reporter=list 2>&1) || FAILED=1
  E2E_PASSED=$(echo "$E2E_OUTPUT" | grep -oE '[0-9]+ passed' | head -1)
  E2E_FAIL=$(echo "$E2E_OUTPUT" | grep -oE '[0-9]+ failed' | head -1)
  [ -n "$RESULTS" ] && RESULTS="$RESULTS | "
  RESULTS="${RESULTS}E2E: ${E2E_PASSED:-0 passed}${E2E_FAIL:+ $E2E_FAIL}"
fi

# Output for Claude Code hook (JSON to stdout)
if [ $FAILED -eq 0 ]; then
  echo "{\"decision\": \"approve\", \"reason\": \"Tests passed ($RESULTS) for $FILE\"}"
else
  # Exit 2 to show stderr to Claude
  echo "Tests FAILED ($RESULTS) after editing $FILE" >&2
  if [ ${#API_TESTS[@]} -gt 0 ]; then
    echo "$API_OUTPUT" | grep -E "FAILED|ERROR|assert" >&2
  fi
  if [ ${#E2E_TESTS[@]} -gt 0 ]; then
    echo "$E2E_OUTPUT" | grep -E "failed|Error|✘" >&2
  fi
  exit 2
fi
