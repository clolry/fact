#!/bin/sh
# Applies the FACT branch-protection model to ANY repository.
#
#   sh scripts/setup-protection-template.sh <owner>/<repo> [collaborator]
#
# Example:
#   sh scripts/setup-protection-template.sh clolry/my-other-project 0zelKirkland
#
# Model applied:
#   main     - PR required, 1 approving review, stale approvals dismissed,
#              last push must be approved, conversation resolution required,
#              force-push and deletion blocked
#   sandbox  - direct pushes ALLOWED (no review), force-push and deletion
#              blocked. Created from main if it does not exist.
#
# Output is written to ./protection-<repo>-result.txt
#
# PREREQUISITES
#   - gh authenticated (gh auth login) with admin on the target repo
#   - The repo must be PUBLIC, or owned by an org, or on a paid plan.
#     Classic branch protection is not available on private repositories
#     under a FREE personal account. This script detects that and explains.
#
# Reversible:
#   gh api -X DELETE /repos/OWNER/REPO/branches/main/protection
#   gh api -X DELETE /repos/OWNER/REPO/branches/sandbox/protection

set -eu

if [ $# -lt 1 ]; then
  echo "usage: sh $0 <owner>/<repo> [collaborator-username]" >&2
  exit 2
fi

REPO="$1"
COLLAB="${2:-}"
SHORT=$(echo "$REPO" | tr '/' '-')
OUT="protection-${SHORT}-result.txt"

exec > "$OUT" 2>&1

echo "=== Branch protection setup for $REPO — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

# ----------------------------------------------------------------- preflight
echo "--- preflight: auth ---"
gh auth status 2>&1 || { echo "FAIL: run 'gh auth login' first."; exit 1; }
echo

echo "--- preflight: repo facts ---"
gh api "/repos/$REPO" --jq \
  '{private, visibility, owner_type:.owner.type, plan:(.owner.plan.name//"unknown"), admin:.permissions.admin, default_branch}'

ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
PRIVATE=$(gh api "/repos/$REPO" --jq '.private')
OWNERTYPE=$(gh api "/repos/$REPO" --jq '.owner.type')
PLAN=$(gh api "/repos/$REPO" --jq '.owner.plan.name // "unknown"')
echo

if [ "$ADMIN" != "true" ]; then
  echo "FAIL: you are not an admin on $REPO. Branch protection requires admin."
  exit 1
fi

# The eligibility trap that makes people think this is impossible.
if [ "$PRIVATE" = "true" ] && [ "$OWNERTYPE" = "User" ] && [ "$PLAN" = "free" ]; then
  echo "BLOCKED: $REPO is PRIVATE, owned by a personal FREE account."
  echo
  echo "Classic branch protection is not available in that combination."
  echo "The PUT calls below would return 403 'Upgrade to GitHub Pro'."
  echo
  echo "Options, cheapest first:"
  echo "  1. Make the repository public (only if it contains no sensitive"
  echo "     content, no secrets, and no real data — check git HISTORY, not"
  echo "     just the current tree)."
  echo "  2. Transfer it to a GitHub organization. Free orgs get branch"
  echo "     protection on private repos, plus real teams."
  echo "  3. Upgrade the account to GitHub Pro."
  echo "  4. Try repository RULESETS instead (Settings -> Rules -> Rulesets)."
  echo "     Availability on free private repos varies; test it in the UI."
  echo
  echo "No changes were made."
  exit 1
fi

echo "--- snapshot: existing protection (404 = none) ---"
for b in main sandbox; do
  echo "[$b]"
  gh api "/repos/$REPO/branches/$b/protection" 2>&1 || echo "  (none)"
done
echo

# ------------------------------------------------------- ensure sandbox exists
echo "--- ensure 'sandbox' branch exists ---"
if gh api "/repos/$REPO/branches/sandbox" >/dev/null 2>&1; then
  echo "sandbox: already exists"
else
  DEF=$(gh api "/repos/$REPO" --jq '.default_branch')
  SHA=$(gh api "/repos/$REPO/git/ref/heads/$DEF" --jq '.object.sha')
  echo "sandbox: creating from $DEF ($SHA)"
  gh api -X POST "/repos/$REPO/git/refs" \
    -f "ref=refs/heads/sandbox" -f "sha=$SHA" --jq '.ref'
fi
echo

# --------------------------------------------------------------- apply: main
echo "--- APPLY: main (review required) ---"
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
echo "main: applied"
echo

# ------------------------------------------------------------ apply: sandbox
echo "--- APPLY: sandbox (direct pushes allowed) ---"
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
echo "sandbox: applied"
echo

# ------------------------------------------------------------- collaborator
if [ -n "$COLLAB" ]; then
  echo "--- collaborator: $COLLAB at permission=push ---"
  gh api "/users/$COLLAB" --jq '{login, type}'
  gh api -X PUT "/repos/$REPO/collaborators/$COLLAB" -f permission=push
  echo "invite sent or already a collaborator"
  gh api "/repos/$REPO/invitations" --jq '.[] | {invitee:.invitee.login, permissions}' 2>&1 || true
  echo
fi

# ------------------------------------------------------------------- verify
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
echo
echo "NOTE: a collaborator must ACCEPT the invitation before they can approve."
echo "NOTE: you cannot approve your own PR. A second person is required to"
echo "      merge into main. That is the point of the model."
