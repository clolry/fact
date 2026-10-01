#!/bin/sh
# Applies Phase 1 branch protection to clolry/FACT (main + sandbox).
#
# Run from the repo root:   sh scripts/setup-branch-protection.sh
#
# Writes all results to scripts/protection-result.txt so they can be reviewed
# without copying text out of the terminal.
#
# Reversible:  gh api -X DELETE /repos/clolry/FACT/branches/main/protection
#              gh api -X DELETE /repos/clolry/FACT/branches/sandbox/protection

set -eu

REPO="clolry/FACT"
OUT="scripts/protection-result.txt"

exec > "$OUT" 2>&1

echo "=== FACT branch protection — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated. Run 'gh auth login' and retry."
  exit 1
fi
echo

echo "--- preflight: repo visibility + admin permission ---"
gh api "/repos/$REPO" --jq '{private, visibility, owner_type:.owner.type, admin:.permissions.admin}'
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: you do not hold admin on $REPO. Cannot set branch protection."
  exit 1
fi
echo

echo "--- snapshot: existing protection (404 = none, expected baseline) ---"
for b in main sandbox; do
  echo "[$b]"
  gh api "/repos/$REPO/branches/$b/protection" 2>&1 || echo "  (no existing protection)"
done
echo

echo "--- APPLY: main ---"
gh api -X PUT "/repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON
echo "main: PUT completed"
echo

echo "--- APPLY: sandbox (light — direct pushes allowed, no review required) ---"
gh api -X PUT "/repos/$REPO/branches/sandbox/protection" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "required_conversation_resolution": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}
JSON
echo "sandbox: PUT completed"
echo

echo "--- VERIFY: observed state ---"
for b in main sandbox; do
  echo "[$b]"
  gh api "/repos/$REPO/branches/$b/protection" --jq \
    '{admins:.enforce_admins.enabled,
      reviews:.required_pull_request_reviews.required_approving_review_count,
      stale:.required_pull_request_reviews.dismiss_stale_reviews,
      last_push:.required_pull_request_reviews.require_last_push_approval,
      force:.allow_force_pushes.enabled,
      del:.allow_deletions.enabled,
      convo:.required_conversation_resolution.enabled}'
done
echo

echo "=== done ==="
echo "Expected main:    admins:false reviews:1 stale:true last_push:true force:false del:false convo:true"
echo "Expected sandbox: reviews:null force:false del:false"
