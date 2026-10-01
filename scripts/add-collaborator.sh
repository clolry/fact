#!/bin/sh
# Invites Ozel Kirkland as a collaborator on clolry/FACT with "push" (write)
# access, and verifies the result.
#
# Run from the repo root:   sh scripts/add-collaborator.sh
#
# Output is written to scripts/collaborator-result.txt for review.
#
# Why "push" and not "admin": least privilege (AGENTS.md §3.1). Write access
# lets Ozel create branches, push to sandbox, open PRs, and review/approve
# PRs into main. It does NOT let him change repository settings or remove
# branch protection. Chris remains sole admin.
#
# Reversible:
#   gh api -X DELETE /repos/clolry/FACT/collaborators/0zelKirkland

set -eu

REPO="clolry/FACT"
USER="0zelKirkland"   # NOTE: leading character is the DIGIT ZERO
OUT="scripts/collaborator-result.txt"

exec > "$OUT" 2>&1

echo "=== FACT collaborator invite — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated. Run 'gh auth login' and retry."
  exit 1
fi
echo

echo "--- preflight: confirm target account exists ---"
gh api "/users/$USER" --jq '{login, type, created_at}'
echo

echo "--- preflight: admin permission on $REPO ---"
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
echo "admin: $ADMIN"
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: admin required to add collaborators."
  exit 1
fi
echo

echo "--- current collaborators (before) ---"
gh api "/repos/$REPO/collaborators" --jq '.[] | {login, admin:.permissions.admin, push:.permissions.push}'
echo

echo "--- INVITE: $USER with permission=push ---"
gh api -X PUT "/repos/$REPO/collaborators/$USER" -f permission=push
echo "invite: PUT completed (HTTP 201 = invitation created, 204 = already a collaborator)"
echo

echo "--- VERIFY: pending invitations ---"
gh api "/repos/$REPO/invitations" --jq '.[] | {invitee:.invitee.login, permissions, created_at}'
echo

echo "=== done ==="
echo "Ozel must ACCEPT the emailed invitation before his access is active."
echo "Until accepted, CODEOWNERS auto-requests to @0zelKirkland will not resolve."
