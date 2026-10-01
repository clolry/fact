#!/bin/sh
# One-command verification for FACT. Zero dependencies.
#
#   sh scripts/check.sh
#
# What this does:
#   1. Syntax-checks every .js file with Node's built-in parser
#   2. Scans tracked files for credential and real-data patterns
#   3. Validates appsscript.json is parseable JSON
#
# What this does NOT do:
#   It does not validate Apps Script RUNTIME behavior. Apps Script globals
#   (SpreadsheetApp, ScriptApp, Session, ...) do not exist in Node, so this
#   cannot catch "function not found" or quota errors. Only a real Sandbox
#   deploy plus manual validation proves the application works. See
#   AGENTS.md §7.2.
#
# Exit codes: 0 = all checks passed, 1 = at least one check failed.
#
# Deliberately NOT a package.json: adding a second .json file to the
# repository root would be picked up by clasp's jsonExtensions and pushed to
# every Apps Script environment. Avoiding that keeps deployment behavior
# untouched. See AGENTS.md §3.2.

FAILED=0

echo "=== FACT verification ==="
echo

# ---------------------------------------------------------------- 1. syntax
echo "--- 1. JavaScript syntax (node --check) ---"
if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is not installed; cannot syntax-check."
  FAILED=1
else
  for f in *.js; do
    [ -e "$f" ] || continue
    if node --check "$f" >/dev/null 2>&1; then
      echo "  ok    $f"
    else
      echo "  FAIL  $f"
      node --check "$f" 2>&1 | sed 's/^/        /'
      FAILED=1
    fi
  done
fi
echo

# ------------------------------------------------------- 2. secret tripwire
# Patterns that must never be committed. This is a tripwire, not a scanner:
# it catches the obvious cases. It is not a substitute for reading the diff.
echo "--- 2. Credential and sensitive-data tripwire ---"

scan() {
  # $1 = human-readable label, $2 = extended regex
  # Searches tracked files only, so local untracked scratch is ignored.
  hits=$(git ls-files -z \
    | xargs -0 grep -laE "$2" 2>/dev/null \
    | grep -v '^scripts/check.sh$' \
    | grep -v '^AGENTS.md$')
  if [ -n "$hits" ]; then
    echo "  FAIL  $1"
    printf '%s\n' "$hits" | sed 's/^/        /'
    FAILED=1
  else
    echo "  ok    no $1"
  fi
}

scan "GitHub tokens"        'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}'
scan "Google API keys"      'AIza[0-9A-Za-z_-]{30,}'
scan "OAuth access tokens"  'ya29\.[0-9A-Za-z_-]{20,}'
scan "private keys"         '-----BEGIN [A-Z ]*PRIVATE KEY-----'
scan "AWS access keys"      'AKIA[0-9A-Z]{16}'
scan "Slack tokens"         'xox[baprs]-[0-9A-Za-z-]{10,}'
scan "clasp credentials"    '"refresh_token"[[:space:]]*:[[:space:]]*"[0-9A-Za-z/_.-]{20,}'
scan "hardcoded Chat webhooks" 'https://chat\.googleapis\.com/v1/spaces/[A-Za-z0-9_-]+/messages\?key='
echo

# --------------------------------------------------------- 3. manifest JSON
echo "--- 3. appsscript.json is valid JSON ---"
if [ ! -f appsscript.json ]; then
  echo "  FAIL  appsscript.json is missing"
  FAILED=1
elif command -v node >/dev/null 2>&1 \
  && node -e 'JSON.parse(require("fs").readFileSync("appsscript.json","utf8"))' 2>/dev/null; then
  echo "  ok    parses"
else
  echo "  FAIL  appsscript.json is not valid JSON"
  FAILED=1
fi
echo

# ------------------------------------------------------------------ summary
echo "=== result ==="
if [ "$FAILED" -eq 0 ]; then
  echo "PASS — all checks succeeded."
  echo
  echo "Reminder: this proves syntax and secret hygiene only. Apps Script"
  echo "runtime behavior is NOT verified. Validate in Sandbox before main."
  exit 0
else
  echo "FAIL — at least one check failed. Do not open a pull request yet."
  exit 1
fi
