#!/bin/sh
# Files PRIVATE draft security advisories for FACT security findings.
#
# Run from the repo root:   sh scripts/create-security-advisories.sh
# Output is written to scripts/advisories-result.txt for review.
#
# WHY DRAFT ADVISORIES AND NOT ISSUES (AGENTS.md §9.2):
# clolry/fact is a PUBLIC repository. Security findings must never be filed
# as public issues. Draft security advisories are visible only to users with
# admin/security access on the repository, so they provide durable tracking
# (§15.5) without disclosure.
#
# These drafts are NOT published and NOT submitted for a CVE. They are being
# used purely as a private tracker. Do not click "Publish" on any of them.
#
# Idempotency: re-running creates DUPLICATES. Run once.
#
# If the API call fails with 403, create these manually instead:
#   Repo -> Security -> Advisories -> New draft security advisory

set -eu

REPO="clolry/fact"
OUT="scripts/advisories-result.txt"

exec > "$OUT" 2>&1

echo "=== FACT draft security advisories — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo

echo "--- preflight: auth ---"
if ! gh auth status 2>&1; then
  echo "FAIL: gh is not authenticated."; exit 1
fi
echo

echo "--- preflight: admin permission ---"
ADMIN=$(gh api "/repos/$REPO" --jq '.permissions.admin')
echo "admin: $ADMIN"
if [ "$ADMIN" != "true" ]; then
  echo "FAIL: admin required to create security advisories."; exit 1
fi
echo

echo "--- existing advisories (before) ---"
gh api "/repos/$REPO/security-advisories" --jq '.[] | {ghsa_id, state, summary}' 2>&1 || echo "  (none, or endpoint unavailable)"
echo

file_advisory() {
  echo "----------------------------------------"
  echo "CREATING: $1"
  # The API requires a non-empty `vulnerabilities` array. FACT is a Google
  # Apps Script application, not a published package, so ecosystem "other"
  # is used and version-range fields are left null. These advisories are
  # being used as a PRIVATE TRACKER, not for CVE submission.
  jq -n --arg s "$1" --arg d "$3" --arg sev "$2" \
    '{summary:$s,
      description:$d,
      severity:$sev,
      vulnerabilities:[
        {package:{ecosystem:"other", name:"FACT (Google Apps Script)"},
         vulnerable_version_range:null,
         patched_versions:null,
         vulnerable_functions:null}
      ]}' \
  | gh api -X POST "/repos/$REPO/security-advisories" \
      -H "Accept: application/vnd.github+json" --input - \
      --jq '{ghsa_id, state, html_url}' 2>&1 \
    || echo "  ^^ FAILED — see error above. Remaining advisories will still be attempted."
  echo
}

# ---------------------------------------------------------------- 1
file_advisory \
"Production deployments to PMSC and FCA execute with no approval gate" \
"high" \
'## Finding
`.github/workflows/deploy.yml` (lines 34-48) triggers on every push to `main` and immediately runs `clasp push --force` followed by `clasp deploy` against BOTH PMSC Production and FCA Production. There is no GitHub Environment, no required reviewer, and no manual gate.

Because merging a pull request is itself a push to `main`, an approved PR deploys to both production environments with no separate deployment approval.

## Impact
Contradicts PROJECT_PLAN.md Key Requirement #6 (Production Human Approval). Any change that passes code review reaches both production environments automatically, including changes whose production risk was not the focus of the review.

Branch protection (applied 2026-10-01) mitigates this only partially: it guarantees "reviewed before deploy", not "approved to deploy".

## Related weaknesses in the same workflow
- **Secret handling**: `echo (dollar){{ secrets.CLASPRC_JSON }} > ~/.clasprc.json` interpolates the secret into a shell command line. No `umask`, and the credential file is never removed after the job.
- **No concurrency control**: concurrent pushes to `main` can run overlapping `clasp push --force` operations against the same script.
- **Sequential multi-environment deploy**: PMSC and FCA deploy as consecutive steps in one job. If PMSC succeeds and FCA fails, the two production environments silently diverge.
- **Unpinned tooling**: `npm install -g @google/clasp` resolves to whatever version is current at run time. clasp 3.x is a breaking major release. Tracked publicly as issue #11 (non-security framing).

## Remediation
Tracked as "Increment 2". Requires, in order:
1. Create GitHub Environments `sandbox`, `pmsc-production`, `fca-production`; add required reviewers to the two production environments.
2. Move script IDs and deployment IDs from workflow source into per-environment secrets.
3. Split PMSC and FCA into separate jobs, with FCA depending on PMSC success (fail-closed ordering).
4. Pass secrets via `env:` rather than shell interpolation; `umask 077`; remove `~/.clasprc.json` in an `if: always()` step.
5. Add `concurrency` groups per environment with `cancel-in-progress: false`.
6. Add `permissions: contents: read`.
7. Pin clasp and action SHAs.

## Controls
NIST SP 800-53: CM-3, CM-5, AC-6, SC-28, SR-3. AGENTS.md §14.2, §3.2.

## Status
Open. Approved in principle; blocked on creating the three GitHub Environments and establishing the clasp version pin.'

# ---------------------------------------------------------------- 2
file_advisory \
"Tracked .clasp.json targets PMSC Production, enabling accidental production push" \
"medium" \
'## Finding
The committed `.clasp.json` at the repository root contains the PMSC Production script ID (`1ltCzO...`).

## Impact
Any developer or agent who runs `clasp push` in a normal checkout pushes directly to PMSC Production, bypassing GitHub, pull request review, and CI entirely. This is precisely the environment drift PROJECT_PLAN.md Key Requirement #5 and Constraint "must not rely on routine local clasp push" exist to prevent. The default local state points at production.

## Contributing factor
`deploy.yml` overwrites `.clasp.json` wholesale with only `{scriptId, rootDir}`, discarding `scriptExtensions`, `htmlExtensions`, `jsonExtensions`, `filePushOrder`, and `skipSubdirectories`. CI therefore pushes under different rules than a local push, so local behavior does not predict CI behavior. Tracked publicly as issue #12 (non-security framing).

## Remediation
- Repoint the tracked `.clasp.json` away from production (Sandbox, or a placeholder that fails loudly).
- In CI, patch only the `scriptId` key (`jq --arg id "$SCRIPT_ID" ".scriptId = \$id"`) so all other keys survive.
- Consider whether `.clasp.json` should be tracked at all once IDs live in environment secrets.

## Controls
NIST SP 800-53: CM-2, CM-6, AC-6. AGENTS.md §12.1.

## Status
Open. Deferred to Increment 2 — changing deployment configuration requires explicit approval.'

# ---------------------------------------------------------------- 3
file_advisory \
"appsscript.json declares no explicit oauthScopes, allowing unreviewed scope drift" \
"medium" \
'## Finding
`appsscript.json` contains no `oauthScopes` array. Apps Script therefore infers the required scopes at deploy time from static analysis of the source.

## Impact
Adding a single API call can silently broaden the OAuth scopes granted in production, with no diff for a reviewer to examine. This defeats PROJECT_PLAN.md Key Requirement #9 (OAuth Scope Review), which assumes scope changes are reviewable artifacts.

FACT integrates Sheets, Drive, Gmail, Groups, Calendar, and the People advanced service, so the inferred scope set is broad and the blast radius of accidental widening is correspondingly large.

## Remediation
Enumerate the scopes currently granted (Apps Script project settings, or the OAuth consent screen), pin them explicitly in `appsscript.json`, and validate in Sandbox.

## Warning — this is a user-visible change
Pinning scopes forces every existing user to re-authorize the application on next use. This requires its own approval, its own ADR, and its own Sandbox validation cycle. It is deliberately NOT bundled with the Increment 2 workflow hardening.

## Controls
NIST SP 800-53: AC-6, CM-3, CM-6. AGENTS.md §3.1.

## Status
Open. Needs separate approval and an ADR before work begins.'

# ---------------------------------------------------------------- 4
file_advisory \
"Repository visibility change exposed deployment identifiers and staff email addresses" \
"low" \
'## Finding
`clolry/fact` was changed from private to public on 2026-10-01 to obtain branch protection on the GitHub Free plan. A full scan of all 35 commits was performed before the change and found NO credentials, API keys, OAuth tokens, private keys, spreadsheet IDs, CUI, financial data, or procurement-sensitive content in any commit. Application data correctly lives in Google Sheets and is read via Script Properties (`getProperty()`), not embedded in source.

Two categories of information are nonetheless now world-readable.

### 1. Apps Script deployment identifiers
`deploy.yml` lines 32, 40, 48 contain the three deployment IDs, from which the `/exec` web app URLs are directly derivable. `docs/docs_technical.md` lines 60-62 and `.clasp.json` contain all three script IDs.

Mitigation in place: `appsscript.json` sets `"access": "DOMAIN"`, so only authenticated `@gsa.gov` accounts can load the web app. Publishing the URLs widens who can *find* the entry points inside the domain; it does not grant access outside it.

### 2. Named staff email addresses
`FACT_FcaSetup.js` lines 62-63 and `FACT_SandboxSetup.js` lines 40-41 hardcode `christopher.olry@gsa.gov` and `ozel.kirkland@gsa.gov` as seed configuration data. Low harm (published work addresses), but configuration embedded as source.

## Remediation
- Move deployment and script IDs to per-environment GitHub secrets (Increment 2) to remove them from the repository going forward. Note that git history retains them; rotating the deployments would be required to fully invalidate, which is likely disproportionate given the DOMAIN restriction.
- Move seed email addresses to Script Properties.
- Reassess visibility if the agency paid plan inquiry succeeds: moving to an organization provides branch protection on private repositories, after which the repository can be returned to private.

## Controls
NIST SP 800-53: SC-28, AC-3, SI-12. AGENTS.md §4.1.

## Status
Open. Accepted risk in the short term; the visibility tradeoff was a deliberate, informed decision to gain branch protection.'

# ---------------------------------------------------------------- 5
file_advisory \
"Web app authorization depends entirely on in-code email checks under USER_DEPLOYING" \
"medium" \
'## Finding
`appsscript.json` sets `"executeAs": "USER_DEPLOYING"` with `"access": "DOMAIN"`.

Consequence: any authenticated `@gsa.gov` user who reaches the web app URL executes the script with the *deploying account*'"'"'s authority — including that account'"'"'s access to the backing Google Sheet, Drive files, and Gmail send capability. Google Workspace authenticates the caller but grants them the deployer'"'"'s permissions.

All authorization therefore rests on application-level email comparisons in `Code.js` against admin/exec lists, as described in `docs/docs_technical.md` section 6.

## Impact
A single missed authorization check on any entry point, or any routing path that reaches data access before the email check, exposes data with the deployer'"'"'s full privileges to any domain user. There is no platform-level backstop. This is a pre-existing architectural property, not a regression — but it raises the severity of any authorization bug and of the entry-point disclosure described in the visibility advisory.

## Remediation
This is an architectural review item, not a quick fix.
1. Audit every entry point (`doGet`, `doPost`, and all functions reachable via `google.script.run`) and confirm each performs an authorization check before any data access.
2. Centralize the authorization check rather than repeating it per handler.
3. Evaluate whether `executeAs: USER_ACCESSING` is viable. It would make Google enforce per-user access to the Sheet, but would require every user to have direct Sheet access, which conflicts with the current "restrict or hide the raw Sheet" guidance. This is a genuine design tradeoff requiring an ADR.
4. Confirm the deploying account is a least-privilege service identity and not a personal admin account.

## Note on reviewability
`Index.html` (~427 KB) and `FACT_NotesLog.js` (~124 KB) are large enough that the audit in step 1 cannot be done reliably by reading a diff. Tracked publicly as issue #16 (non-security framing).

## Controls
NIST SP 800-53: AC-3, AC-6, SI-10. AGENTS.md §3.1, §5.1.

## Status
Open. Needs an architectural review and an ADR. No code change proposed yet.'

# ---------------------------------------------------------------- 6
file_advisory \
"Resolved: GitHub PAT disclosed via agent chat interface and revoked" \
"low" \
'## Event
On 2026-10-01, during agentic-coding playbook bootstrap, a fine-grained GitHub
personal access token scoped to `clolry/fact` was pasted directly into the
opencode chat prompt in order to grant the AI agent push and pull-request
capability.

The agent refused to use the token, halted work, and escalated
(AGENTS.md §9.1). The human revoked the token immediately. No action was taken
with the credential.

## Token scope at time of disclosure
Fine-grained PAT, single repository (`clolry/fact`), 7-day expiry:
- Contents: read/write
- Pull requests: read/write
- Issues: read/write
- Administration: NOT granted
- Workflows: NOT granted
- Repository security advisories: NOT granted

Because Administration and Workflows were withheld, the token could not have
removed branch protection or modified `.github/workflows/deploy.yml`. Because
pushes to `main` require review, it could not have reached PMSC or FCA
production. It could have pushed to `sandbox`, which triggers a Sandbox Apps
Script deployment.

## Exposure assessment
The credential was persisted or transmitted in at least three places:
1. The conversation transcript, which is sent to the USAi API and is therefore
   subject to agency AI, privacy, and records-retention policy.
2. Local agent session storage (`~/.local/share/opencode/opencode.db-wal`)
   inside the agent sandbox.
3. The operator terminal scrollback.

Verified NOT exposed: the repository working tree and all git history were
scanned for PAT-pattern strings; both were clean. Nothing reached the public
repository.

## Impact
None realized. The token was revoked before use. Revocation is the only
effective remedy once a credential enters a chat transcript, since the
transcript cannot be retroactively purged.

## Contributing factors
- The operator could not copy text out of the opencode TUI, making the chat
  prompt the path of least resistance for passing a value to the agent.
- Agent guidance specified not to write the token into a repository file and
  named the target environment variable, but did not explicitly warn against
  pasting the credential into the conversation itself.

## Corrective actions
- [x] Token revoked by the human.
- [x] Incident recorded as a private advisory (not a public issue, per §9.2).
- [ ] If agent credential access is pursued again, the token MUST reach the
      agent process environment without passing through the conversation —
      preferred mechanism is `acq/msb` environment-variable injection setting
      `GH_TOKEN`. A file outside the repository (mode 0600) is a weaker
      fallback. Pasting into chat is prohibited.
- [ ] Consider documenting a "never paste secrets into the prompt" rule in
      `AGENTS.md` during the Increment 1 governance bootstrap.

## Current posture
Proceeding WITHOUT agent credential access. The human runs all authenticated
operations via reviewed scripts in `scripts/`, which write their output to
local transcript files for the agent to read. This preserves the sandbox
boundary as the enforcing control.

## Controls
NIST SP 800-53: IA-5 (Authenticator Management), IR-4 (Incident Handling),
IR-6 (Incident Reporting), AC-6 (Least Privilege), SA-15.
OWASP Agentic: Identity and Privilege Abuse.
AGENTS.md §4.1, §9.1, §2.1.

## Status
Resolved for the disclosed credential (revoked). Open item: establish a secure
delivery mechanism before any future grant of agent credential access.'

echo "--- VERIFY: advisories now present ---"
gh api "/repos/$REPO/security-advisories" --jq '.[] | {ghsa_id, state, severity, summary}' 2>&1 || echo "  (could not list)"
echo

echo "=== done ==="
echo
echo "These are DRAFTS and are private to repository admins."
echo "Do NOT publish them — they are being used as a private tracker."
echo "View at: https://github.com/clolry/fact/security/advisories"
