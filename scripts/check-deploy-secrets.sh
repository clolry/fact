#!/bin/sh
# READ-ONLY probe of deployment secrets and environment gates for clolry/FACT.
#
# Run from the repo root:   sh scripts/check-deploy-secrets.sh
#
# Writes everything to scripts/deploy-secrets-result.txt so the agent can read
# observed output without anyone copying terminal text.
#
# WHY THIS EXISTS
# ---------------
# The hardened deploy.yml (merged to `sandbox`, not yet on `main`) stopped
# hardcoding script and deployment IDs in workflow YAML and now reads them from
# GitHub *Environment* secrets. Sandbox is proven — run #40 deployed green. The
# two production environments have NEVER executed the hardened workflow. If a
# production environment is missing a secret, the fail-closed guards in
# deploy.yml abort the job, which is the safe outcome but a bad way to discover
# it: mid-release, with PMSC possibly already pushed.
#
# There is also a quieter failure mode this checks for. A repository secret is
# a FALLBACK for an environment that does not define the same name. If
# `pmsc-production` has no SCRIPT_ID but a repository-level SCRIPT_ID exists,
# the guard sees a non-empty value, passes, and clasp pushes production code to
# WHATEVER that repo-level ID points at. A green run that deployed to the wrong
# Apps Script project is far worse than a failed one.
#
# CORRECTION (2026-10-05): the first version of this script reported
# CLASPRC_JSON as MISSING in all three environments because it queried only the
# environment endpoint. That was a defect in this script, not a finding.
# Repo-level secrets resolve in environment-scoped jobs as a fallback, and
# run #40 proved it live — Authenticate clasp succeeded on a Sandbox job using
# a CLASPRC_JSON held only at repository level. The check now evaluates both
# layers and distinguishes "resolves nowhere" from "resolves, but shared when
# it should be per-environment".

#
# SAFETY
# ------
# Every call is a GET. Nothing is created, modified, or deleted.
# The GitHub API does not expose secret VALUES through any endpoint — only
# names and timestamps. This script therefore cannot leak a credential even if
# its output is pasted somewhere careless. `gh auth status` masks the token.
#
# Requires: gh authenticated as a repo admin (secret listing needs admin).

set -eu

REPO="clolry/FACT"
OUT="scripts/deploy-secrets-result.txt"

exec > "$OUT" 2>&1

echo "=== FACT deployment secret probe (READ-ONLY) — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated. Run 'gh auth login' and retry."
  exit 1
fi
echo

echo "--- preflight: admin permission (required to list secret names) ---"
gh api "/repos/$REPO" --jq '{admin:.permissions.admin, visibility, default_branch}'
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: admin is required to list secret names. Stopping."
  exit 1
fi
echo

# ---------------------------------------------------------------------------
# Repository-level secrets. Names only.
#
# These are the FALLBACK layer. GitHub's `secrets` context resolves a
# repository secret when the job's environment does not define one of the same
# name; an environment secret OVERRIDES a repo secret, it is not required
# alongside it.
# ---------------------------------------------------------------------------
echo "--- repository-level secrets (names only) ---"
gh api "/repos/$REPO/actions/secrets" --jq '.secrets[].name' 2>&1 || echo "  (none or not readable)"
REPO_NAMES=$(gh api "/repos/$REPO/actions/secrets" --jq '.secrets[].name' 2>/dev/null || echo "")
echo

# ---------------------------------------------------------------------------
# Per-environment secrets, protection rules, and branch policy.
#
# deploy.yml requires these three names to RESOLVE in each deploying job:
#   CLASPRC_JSON   clasp OAuth credentials
#   SCRIPT_ID      target Apps Script project
#   DEPLOYMENT_ID  existing deployment to update
#
# RESOLUTION MODEL — this is what an earlier version of this script got wrong.
# It checked the environment endpoint alone and reported CLASPRC_JSON as
# "MISSING" in all three environments, because that secret is held at
# repository level. The conclusion was false: run #40 authenticated and
# deployed to Sandbox successfully using exactly that repo-level value. A job
# sees env-secret-or-repo-secret, so a name is satisfied if EITHER layer
# provides it.
#
# Two distinct conditions matter, and they are reported separately below:
#
#   UNRESOLVED  — the name exists in neither layer. deploy.yml's -z guard
#                 aborts the job. A real blocker.
#
#   SHADOWING   — a name required to be environment-SPECIFIC exists only at
#                 repository level. The guard passes, so the run goes green,
#                 but every environment gets the SAME value. For SCRIPT_ID and
#                 DEPLOYMENT_ID that means pushing production code to whatever
#                 single project that ID names. Worse than a failure, because
#                 it is silent. CLASPRC_JSON is deliberately exempt: one clasp
#                 credential authorizes all three projects, so holding it once
#                 at repo level is correct and means one thing to rotate.
# ---------------------------------------------------------------------------
# Names that MUST differ per environment, and so must be set at env level.
ENV_SPECIFIC="SCRIPT_ID DEPLOYMENT_ID"
# Names legitimately shared across all environments.
SHARED="CLASPRC_JSON"

for ENV in sandbox pmsc-production fca-production; do
  echo "========================================================"
  echo "ENVIRONMENT: $ENV"
  echo "========================================================"

  echo "[secret names]"
  gh api "/repos/$REPO/environments/$ENV/secrets" --jq '.secrets[].name' 2>&1 \
    || echo "  (environment not found or has no secrets)"
  echo

  echo "[resolution check: environment layer, then repository fallback]"
  NAMES=$(gh api "/repos/$REPO/environments/$ENV/secrets" --jq '.secrets[].name' 2>/dev/null || echo "")
  for REQ in $SHARED $ENV_SPECIFIC; do
    IN_ENV=no
    IN_REPO=no
    echo "$NAMES"      | grep -qx "$REQ" && IN_ENV=yes
    echo "$REPO_NAMES" | grep -qx "$REQ" && IN_REPO=yes

    case "$IN_ENV/$IN_REPO" in
      yes/*)
        echo "  OK          $REQ   (environment secret; overrides repo if any)"
        ;;
      no/yes)
        # Resolves, but check whether sharing one value is acceptable here.
        if echo "$ENV_SPECIFIC" | grep -qw "$REQ"; then
          echo "  SHADOWING   $REQ   repo-level only — all environments would"
          echo "                        receive the SAME value. Run goes GREEN"
          echo "                        while deploying to the wrong project."
        else
          echo "  OK          $REQ   (repo-level fallback; shared by design)"
        fi
        ;;
      no/no)
        echo "  UNRESOLVED  $REQ   set in neither layer — deploy.yml guard"
        echo "                        will abort this job"
        ;;
    esac
  done
  echo

  echo "[protection rules]"
  gh api "/repos/$REPO/environments/$ENV" --jq \
    '{can_admins_bypass,
      rules: [.protection_rules[] | {type,
                                      prevent_self_review,
                                      reviewers: ([.reviewers[]?.reviewer.login])}]}' 2>&1 \
    || echo "  (not readable)"
  echo

  echo "[deployment branch policy]"
  # Without a policy, the ONLY thing binding production to main is the
  # `if: github.ref == 'refs/heads/main'` guard inside deploy.yml — and that
  # guard lives in a file any branch can edit. A policy enforces the same
  # constraint at the platform layer, where a workflow change cannot reach it.
  # A 404 from the second call means no explicit policy exists (not an error).
  gh api "/repos/$REPO/environments/$ENV" --jq '.deployment_branch_policy' 2>&1 \
    || echo "  (not readable)"
  gh api "/repos/$REPO/environments/$ENV/deployment-branch-policies" --jq \
    '.branch_policies[]?.name' 2>&1 || echo "  (no explicit branch policies / not applicable)"
  echo
done

echo "========================================================"
echo "=== done ==="
echo
echo "HOW TO READ THIS"
echo
echo "1. Every required name should read OK. The two failure labels differ:"
echo "     UNRESOLVED — set in neither layer. The job aborts. Loud, safe."
echo "     SHADOWING  — an environment-specific name (SCRIPT_ID,"
echo "                  DEPLOYMENT_ID) exists only at repository level, so"
echo "                  all three environments share one value. The run goes"
echo "                  GREEN while deploying to the wrong Apps Script"
echo "                  project. Silent, and the more dangerous of the two."
echo
echo "2. CLASPRC_JSON at repository level is CORRECT, not a finding. One clasp"
echo "   credential authorizes all three projects; holding it once means one"
echo "   thing to rotate. An environment-scoped job resolves repo-level"
echo "   secrets as a fallback."
echo
echo "3. pmsc-production and fca-production must each show a"
echo "   required_reviewers rule. Without it the approval gate does not exist"
echo "   and the Increment 2 objective is unmet. sandbox should show no rules."
echo
echo "4. prevent_self_review:true means whoever merges to main CANNOT approve"
echo "   the resulting production deployment. A second person is required."
echo "   That is the control working, not a misconfiguration."
echo
echo "5. If a deployment branch policy is set, it must permit the deploying"
echo "   branch (main for production, sandbox for sandbox). No policy means"
echo "   deploy.yml's ref guard is the only binding — see the note above."
echo
echo "This probe made GET requests only. Nothing was changed."
echo "Secret VALUES are not retrievable via the GitHub API and are not here."
