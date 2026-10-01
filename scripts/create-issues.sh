#!/bin/sh
# Files tracked GitHub issues for deferred FACT work (AGENTS.md §15.5).
#
# Run from the repo root:   sh scripts/create-issues.sh
# Output is written to scripts/issues-result.txt for review.
#
# IMPORTANT — PUBLIC REPO SCOPE (AGENTS.md §9.2):
# clolry/FACT is a PUBLIC repository. This script files ONLY non-security,
# non-privacy items. Security-relevant findings (missing production approval
# gate, secret handling in CI, OAuth scope pinning, deployment-ID exposure,
# staff email exposure) are deliberately EXCLUDED and must be tracked
# privately instead — see docs/SECURITY-BACKLOG.md (gitignored) or GitHub
# draft security advisories.
#
# Idempotency: re-running creates DUPLICATE issues. Run once. If you need to
# re-run, close the previous set first.

set -eu

REPO="clolry/FACT"
OUT="scripts/issues-result.txt"

exec > "$OUT" 2>&1

echo "=== FACT issue filing — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated."; exit 1
fi
echo

echo "--- preflight: issues enabled + current open count ---"
gh api "/repos/$REPO" --jq '{has_issues, open_issues_count}'
echo

echo "--- ensure labels exist (ignore 'already exists' errors) ---"
gh label create "tech-debt"   --repo "$REPO" --color "d4c5f9" --description "Known debt, deferred" 2>&1 || true
gh label create "ci-cd"       --repo "$REPO" --color "0e8a16" --description "Pipeline and deployment workflow" 2>&1 || true
gh label create "governance"  --repo "$REPO" --color "1d76db" --description "Docs, process, compliance baseline" 2>&1 || true
gh label create "blocked"     --repo "$REPO" --color "b60205" --description "Waiting on a dependency" 2>&1 || true
echo

file_issue() {
  echo "----------------------------------------"
  echo "CREATING: $1"
  gh issue create --repo "$REPO" --title "$1" --label "$2" --body "$3" 2>&1
  echo
}

# ---------------------------------------------------------------- 1
file_issue \
"Repair truncated PROJECT_PLAN.md (Development Workflow section)" \
"governance" \
'## What was identified
`PROJECT_PLAN.md` ends mid-sentence at line 322, inside an unclosed ```bash fence. The "Standard Developer Workflow" numbered list is cut off after item 1.

## Why it matters
The file is the canonical operating model and is referenced by AGENTS.md. A truncated workflow section means the documented process is incomplete, and the unclosed code fence breaks Markdown rendering for everything that would follow.

## What would change
Restore the remainder of the Development Workflow section and close the fence. Confirm no other sections were lost in the same truncation.

## Trigger
Pick up with the Increment 1 governance bootstrap.'

# ---------------------------------------------------------------- 2
file_issue \
"Remove tracked junk file FACT_WorkflowEngine_backup.js" \
"tech-debt" \
'## What was identified
`FACT_WorkflowEngine_backup.js` is a tracked 1-byte file at the repository root.

## Why it matters
It matches `scriptExtensions` in `.clasp.json`, so `clasp push` sends it to every Apps Script environment including both productions. It is dead weight in the deployed project and implies a backup discipline that is not real (git history is the backup).

## What would change
`git rm FACT_WorkflowEngine_backup.js`, validate in Sandbox, then promote to main.

## Trigger
Safe to do any time; batch with other housekeeping.'

# ---------------------------------------------------------------- 3
file_issue \
"Pin @google/clasp to an exact version in deploy.yml" \
"ci-cd" \
'## What was identified
`.github/workflows/deploy.yml` runs `npm install -g @google/clasp` with no version constraint.

## Why it matters
Pipeline behavior depends on the date it runs. clasp 3.x is a breaking major release that changed auth-file handling and command flags, so an upstream publish can fail a production deploy — or half-complete one — with no change on our side. Violates AGENTS.md §5.2 (pin exact versions) and SR-3.

## What would change
Determine the version used by the last known-good run (check an Actions log), pin it via a `CLASP_VERSION` env var, and validate in Sandbox. Treat any move to 3.x as its own ADR.

## Trigger
Fold into the Increment 2 workflow hardening.'

# ---------------------------------------------------------------- 4
file_issue \
"CI and local clasp configs diverge (push rules differ)" \
"ci-cd" \
'## What was identified
The tracked `.clasp.json` declares `scriptExtensions`, `htmlExtensions`, `jsonExtensions`, `filePushOrder`, and `skipSubdirectories`. `deploy.yml` overwrites the file with only `{scriptId, rootDir}` (lines 30, 38, 46), discarding every other key and falling back to clasp defaults.

## Why it matters
CI pushes under different rules than a local push, so "it pushed correctly locally" does not predict CI behavior. Silent divergence in what gets deployed.

## What would change
Patch only `scriptId` (e.g. `jq --arg id "$SCRIPT_ID" ".scriptId = \$id"`) so all other keys survive. Gives CI/local parity.

## Trigger
Fold into the Increment 2 workflow hardening.'

# ---------------------------------------------------------------- 5
file_issue \
"Retire the dev branch and remove it from deploy triggers" \
"ci-cd" \
'## What was identified
`deploy.yml` triggers on `dev` and deploys it to Sandbox (lines 5, 27). `PROJECT_PLAN.md` already flags `dev` as legacy and recommends retiring it.

## Why it matters
Two branches deploying to one environment means either can silently overwrite the other peer'"'"'s Sandbox test state. Ambiguous source of truth for what Sandbox contains.

## What would change
Remove `dev` from the `on.push.branches` list; delete the branch once confirmed unused.

## Trigger
Fold into the Increment 2 workflow hardening.'

# ---------------------------------------------------------------- 6
file_issue \
"Promote the verify check to a required status check on main" \
"ci-cd" \
'## What was identified
Branch protection on `main` was applied with `required_status_checks: null`, because no status check existed yet.

## Why it matters
Until `verify` is required, a PR can be approved and merged while the syntax/secret check is failing — the check is advisory only.

## What would change
After `verify.yml` has merged and reported on at least one PR:

```
gh api -X PATCH /repos/clolry/FACT/branches/main/protection/required_status_checks \
  -H "Accept: application/vnd.github+json" --input - <<JSON
{"strict": true, "checks": [{"context": "verify"}]}
JSON
```

The `context` must match the job name exactly. Do NOT add it before the check has reported once, or every PR pins at "Expected — waiting for status to be reported" and nothing is mergeable.

## Blocked by
Increment 1 (adds `package.json` + `verify.yml`).' 

# ---------------------------------------------------------------- 7
file_issue \
"Shared Sandbox GAS environment allows developers to overwrite each other" \
"tech-debt" \
'## What was identified
Both developers push directly to `sandbox` (intentional — branch protection there is light), and every push redeploys the same Sandbox Apps Script project.

## Why it matters
Two people testing at once silently overwrite each other'"'"'s Sandbox state. Not a tooling bug; a consequence of one shared environment.

## What would change
Short term: coordinate verbally before pushing to `sandbox`.
Longer term options: a second Sandbox Apps Script project per developer, or a scheduled convention. Needs a decision, not just a fix.

## Trigger
Revisit if the collision actually causes lost test time.'

# ---------------------------------------------------------------- 8
file_issue \
"Index.html and FACT_NotesLog.js far exceed size/complexity limits" \
"tech-debt" \
'## What was identified
`Index.html` is ~427 KB and `FACT_NotesLog.js` ~124 KB. Both are well past the size and complexity guidance in the coding-practices baseline (§13.3). Several other modules exceed 30 KB.

## Why it matters
Files this large cannot be meaningfully code-reviewed, which weakens the PR review gate that now protects `main`. They also make regressions hard to isolate.

## What would change
Nothing yet. Any split is a BROAD REFACTOR of a deployed production application and requires explicit approval plus an ADR — `PROJECT_PLAN.md` Key Requirement #1 (preserve existing behavior) takes precedence over tidiness.

## Trigger
Only if/when a behavior change forces work in these files anyway. Filed so the debt is visible, not to schedule it.'

echo "=== done ==="
echo
echo "Review the created issue URLs above."
echo "NOTE: security/privacy findings were intentionally NOT filed here"
echo "(public repo, AGENTS.md §9.2). Track those privately."
