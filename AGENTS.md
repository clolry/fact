---
title: "FACT — Project Agent Instructions"
description: "Project-specific behavioral rules, workflow guidance, and verification procedures for AI coding agents and developers working on the Federated Action & Coordination Tracker"
status: canonical
tier: 1
load_priority: always
audience: ["developers", "agents"]
last_updated: "2026-10-01"
---

# AGENTS.md — FACT Project Instructions

> **This file is the PROJECT layer.** It is additive to the universal federal
> agent behavioral contract and never overrides it. Where this file is silent,
> the universal contract governs. Where the universal contract is stricter,
> the stricter rule wins.
>
> **Canonical companion documents:**
> - `PROJECT_PLAN.md` — authoritative operating model, environments, guardrails
> - `docs/docs_technical.md` — architecture, data model, modules, CI/CD
>
> Agents MUST read `PROJECT_PLAN.md` before proposing code, architecture,
> OAuth scope, deployment, or workflow changes.

---

## 1. What FACT Is — and Why That Changes How You Work

FACT is an **existing, deployed, production** Google Apps Script application
used by the Portfolio Management Service Center, rolling out to FCA DAC. It is
container-bound to a Google Sheet. Three live environments share one codebase.

This is not a greenfield project. The default assumption for any change is
**"preserve existing behavior."** `PROJECT_PLAN.md` Key Requirement #1 takes
precedence over tidiness, modernization, consistency, and the agent's own
preferences about code quality.

Practical consequences:

- **Do not refactor opportunistically.** Large files and duplicated logic are
  known and tracked (issue #16). Leave them alone unless a change request
  explicitly authorizes the refactor.
- **Narrow the diff.** A 10-line fix is reviewable; a 500-line "while I was in
  there" is not, and review is the only gate protecting production.
- **The repository root IS the deployed application.** Every `.js` and `.html`
  file at the root is pushed to Apps Script by CI. There is no build step and
  no bundler. A file added at the root is a file added to production.

---

## 2. Environments

| Environment | Branch | Approval | Role |
|---|---|---|---|
| **Sandbox** | `sandbox` | none | Default validation environment |
| **PMSC Production** | `main` | required | Live PMSC system |
| **FCA Production** | `main` | required | Live FCA DAC system |

Sandbox is the default target for all validation. Nothing reaches production
without passing through Sandbox first (`PROJECT_PLAN.md` Key Requirement #2).

**Production deploys are gated.** A merge to `main` does not release. The
`pmsc-production` and `fca-production` GitHub Environments each require
reviewer approval, so the workflow **pauses** and waits for a human. FCA
depends on PMSC succeeding, so a PMSC failure leaves both environments on the
previous version. See `docs/adr/0002-deployment-hardening.md`.

**You cannot approve your own deployment.** `prevent_self_review` is on, so
whoever merges to `main` must get the *other* developer to approve each
production deploy. Merging and then finding no approve button is the control
working, not a bug. Plan releases when both of you are available.

Approving a deployment: the paused run appears in the **Actions** tab with a
"Review deployments" prompt. Select the environment, then **Approve and
deploy**. Approval is per environment — PMSC and FCA are approved separately.

An admin bypass exists (`can_admins_bypass: true`), matching the
`enforce_admins: false` posture on `main`. Every use is recorded in the
repository audit log. Routine use defeats the control.

---

## 3. Agent Permissions

### 3.1 Allowed without asking

- Read any file in the repository
- Propose implementation plans and ADRs
- Edit files in the local working tree
- Write and update documentation
- Suggest tests and validation steps
- Interpret `git diff`, draft commit messages and PR descriptions
- Read GitHub state via unauthenticated API (public repository)

### 3.2 Requires explicit human approval

- Pushing to any branch, including `sandbox`
- Opening, merging, or closing pull requests
- Modifying `.github/workflows/**`
- Modifying `.clasp.json`, `.claspignore`, or any clasp behavior
- Modifying `appsscript.json`
- Adding, removing, or changing OAuth scopes
- Changing script IDs, deployment IDs, or environment configuration
- Changing Script Property names or expected values
- Broad refactors
- Changing user-visible production behavior
- Changing Drive, Gmail, Calendar, or Groups permission behavior

### 3.3 Prohibited without separate, specific approval

- Deploying to Apps Script by any means
- Running `clasp push` or `clasp deploy`
- Committing or exposing secrets, credentials, tokens, PII, or CUI
- Bypassing pull request review or production approval

### 3.4 Credential handling

The agent operates in a sandbox with no GitHub credential by default. This is
deliberate — the sandbox boundary is an enforcing control, not an obstacle.

**Never paste a token, key, or password into the chat prompt.** A credential
in a conversation transcript is disclosed: the transcript is transmitted to
the USAi API and is subject to agency AI, privacy, and records-retention
policy, and it cannot be retroactively purged. Revocation becomes the only
remedy. This has already happened once on this project and is recorded as a
security advisory.

If agent credential access is genuinely needed, the token MUST reach the agent
process environment out of band — `GH_TOKEN` injected as an environment
variable. Scope it to this repository only, grant only Contents, Pull requests,
and Issues, withhold Administration and Workflows, set a short expiry, and
revoke when done.

**Default posture: no agent credential.** The human runs authenticated
operations via reviewed scripts in `scripts/`, which write transcripts the
agent reads. This has worked well; prefer it.

---

## 4. Data Handling

FACT data lives in Google Sheets, not in this repository. That separation is
load-bearing and must be preserved.

- **Never** place real names, email addresses, task content, executive
  comments, financial data, or procurement-sensitive content in source code,
  test data, commit messages, issues, pull requests, or documentation.
- Environment-specific and sensitive configuration belongs in **Script
  Properties** (runtime) or **GitHub Environment secrets** (deployment) —
  never in source.
- This repository is **PUBLIC**. Anything committed is world-readable, and git
  history is permanent. Treat every commit as a publication decision.
- Existing Script Properties include `MASTER_SS_ID`, `CLO_GEMINI_KEY`,
  `GROUP_EMAIL`, `TEMPLATE_FOLDER_ID`, `DESTINATION_FOLDER_ID`,
  `CHAT_WEBHOOK_URL`, `LEAVE_CALENDAR_ID`, `BOARD_URL`, `GLOBAL_ID`,
  `SYSTEM_EMAIL_ALIAS`. Read them with `getProperty()`; never inline a value.

---

## 5. Security Findings

**Security findings are never filed as public issues** (universal contract
§9.2). This repository is public, so a security issue is a disclosure.

Use **private draft security advisories** instead:
`Security → Advisories → New draft security advisory`.

Non-security defects and technical debt go in regular issues, subject to the
filing gate: real, in scope, not already tracked, actionable.

Never publish a draft advisory. They are being used as a private tracker.

---

## 6. Workflow

```
feature/<desc>  or  fix/<desc>
      │ PR (no review required)
      ▼
   sandbox  ──► GitHub Actions ──► Sandbox Apps Script
      │                                   │
      │                          manual validation
      │ PR (1 approval REQUIRED)
      ▼
    main    ──► GitHub Actions ──► PMSC Prod + FCA Prod
```

Branch naming: `feature/`, `fix/`, `chore/`, `docs/` + short description.

### 6.1 Branch protection in effect

| | `main` | `sandbox` |
|---|---|---|
| PR required | yes | no |
| Approvals required | 1 | 0 |
| Stale approvals dismissed | yes | — |
| Last push must be approved | yes | — |
| Conversation resolution required | yes | no |
| Force push | blocked | blocked |
| Branch deletion | blocked | blocked |

**You cannot approve your own pull request.** A merge to `main` requires the
other reviewer. Reviewers are Chris Olry (`@clolry`) and Ozel Kirkland
(`@0zelKirkland` — note the leading character is the digit zero).

Admin enforcement is off, so an admin override exists for emergencies. Every
use is recorded in the repository audit log. Using it routinely defeats the
control.

### 6.2 Reviewing and approving a pull request

The approve control is not on the first tab. This is the step people miss.

1. Open the pull request
2. Click the **"Files changed"** tab — *not* Conversation
3. Click **"Review changes"** (upper right of that tab)
4. Select **"Approve"**
5. Click **"Submit review"**

Then, back on **Conversation**: **"Merge pull request"** → **"Confirm merge"**.

**Do not click "Close pull request."** That abandons the PR without merging —
it is the discard action, not the approve action. If it happens, reopen the PR
at the bottom of the page; nothing is lost.

### 6.3 What a reviewer should actually check

- The diff does only what the PR description says
- No secrets, credentials, tokens, real names, or real data
- No unintended change to `appsscript.json`, `.clasp.json`, or
  `.github/workflows/**`
- No OAuth scope change
- No script ID or deployment ID change
- Sandbox validation was performed and stated
- For UI changes: keyboard accessible, sufficient contrast, labeled controls
  (Section 508)
- For a `main` PR: this is a production release to two environments

### 6.4 Files that demand extra scrutiny

`CODEOWNERS` auto-requests review on these. Treat any diff here as
high-risk: `appsscript.json`, `.clasp.json`, `.claspignore`,
`.github/workflows/**`, `Code.js` routing/auth, `FACT_SandboxSetup.js`,
`FACT_FcaSetup.js`, `PROJECT_PLAN.md`, `AGENTS.md`.

---

## 7. Verification

### 7.1 Local check before any PR

```sh
sh scripts/check.sh   # node --check on every .js, secret tripwire, manifest JSON
git status            # confirm only intended files are staged
git diff              # read the actual diff
```

`scripts/check.sh` has zero dependencies — it uses only Node's built-in syntax
checker and grep. It catches syntax errors, obvious credential patterns, and a
malformed `appsscript.json`. It does **not** validate Apps Script runtime
behavior; nothing but a real Sandbox deploy does that.

The same script runs in CI as the `verify` job on every pull request
(`.github/workflows/verify.yml`). That workflow holds no secrets and cannot
deploy.

> **Why a shell script and not `package.json` + `npm run check`:**
> `.clasp.json` lists `.json` in `jsonExtensions` with `rootDir` at the
> repository root, so a `package.json` at the root would be pushed into all
> three Apps Script projects. A `.sh` file is not in any clasp extension list
> and is therefore ignored by `clasp push`. Using a script keeps deployment
> behavior untouched.

### 7.2 Confirming a deployment succeeded

A green checkmark on the commit is necessary but not sufficient. It means
`clasp push` and `clasp deploy` returned zero — not that the application
works.

**Step 1 — confirm the Actions run.** Repository → **Actions** tab. The top
entry is the most recent run. Confirm a green checkmark and the expected
branch. Click it to see the per-job results.

The hardened workflow uses one **job per environment**, not one job with
conditional steps. Expect this pattern:

| Job | `sandbox` push | `main` push |
|---|---|---|
| Deploy to Sandbox | success | **skipped** |
| Deploy to PMSC Production | **skipped** | success *(after approval)* |
| Deploy to FCA Production | **skipped** | success *(after approval)* |

On a `main` push the two production jobs sit at **"Waiting"** until a reviewer
approves each one. A run parked there has deployed nothing — that is the gate,
not a hang.

If the job that should have run was skipped, the branch condition did not match
and **nothing was deployed** despite a green run. If PMSC failed, FCA will show
as skipped by design (`needs:`) and both environments remain on the previous
version. If PMSC succeeded and FCA failed, the two production environments have
**diverged** — investigate before pushing anything else; FCA can be re-run
without re-pushing PMSC.

A job that failed at a `::error::` guard (`SCRIPT_ID is not set`, etc.) aborted
*before* touching Apps Script. Fix the secret, then re-run.

**Step 2 — confirm the application actually works.** Green CI does not prove
this. Open the web app for the environment and walk the Sandbox Validation
Checklist in `PROJECT_PLAN.md` §Testing and Validation. At minimum: the app
loads, the dashboard renders, an existing record displays, and the browser
console shows no new errors.

**Step 3 — check Apps Script execution logs** for the affected environment if
the change touched server-side code, triggers, or notifications.

Per the universal contract §8.3, a mocked or assumed pass proves nothing.
Record what was *observed*, not what was expected.

### 7.3 Never edit in the Apps Script browser editor

CI runs `clasp push --force`. The next deployment silently overwrites any
browser edit. Change code here, commit, and let Actions deploy it.

### 7.4 Triggers do not survive a fresh deployment

Time-driven triggers (`generateDailyDigest` at 7 AM, deadline reminders at
6 AM) must be re-initialized manually in the Apps Script editor if a project
is recreated or copied. See `docs/docs_technical.md` §4.

---

## 8. Known Constraints Worth Remembering

- **Shared Sandbox.** Both developers deploy to one Sandbox project. Pushing
  to `sandbox` while the other is testing overwrites their state. Coordinate
  verbally. Tracked as issue #15.
- **`USER_DEPLOYING` + `DOMAIN` access.** Any authenticated `@gsa.gov` user
  who reaches the web app URL executes with the *deploying account's*
  authority. All authorization rests on email checks in `Code.js`. A missed
  check is a data exposure, not just a bug. Audit authorization on every new
  entry point.
- **No automated tests.** Validation is code review plus manual Sandbox
  checks. `scripts/check.sh` is a syntax and secret tripwire, not a test suite.
- **Apps Script quotas** apply to email, Drive, and execution time. Batch
  operations and loops over large ranges deserve scrutiny.
- **Section 508** applies to all UI work: semantic markup, keyboard
  operability, contrast, visible focus, labeled controls.

---

## 9. Scripts

`scripts/` holds one-shot operational scripts the human runs. Each writes a
transcript to `scripts/<name>-result.txt` so the agent can read observed
output without the human copying terminal text.

| Script | Purpose |
|---|---|
| `check.sh` | One-command verification; also runs in CI as `verify` |
| `check-deploy-secrets.sh` | **Read-only** probe of deployment secrets and environment gates. Lists secret *names* only — values are not retrievable via the API. Run before a production release to confirm each environment resolves its own `SCRIPT_ID`/`DEPLOYMENT_ID` |
| `setup-branch-protection.sh` | Applied Phase 1 protection to `main` + `sandbox` |
| `add-collaborator.sh` | Granted `@0zelKirkland` push access |
| `create-issues.sh` | Filed non-security tracking issues |
| `create-security-advisories.sh` | Filed private draft security advisories |

`*-result.txt` files are gitignored — they contain `gh auth status` output and
are local operational records, not source.

These scripts are **not idempotent**. Re-running the issue and advisory
scripts creates duplicates. `check.sh` and `check-deploy-secrets.sh` are the
exceptions — both are read-only and safe to re-run.

---

## 10. When to Stop and Ask

Halt and escalate rather than guessing (universal contract §14.5):

- A change would alter production behavior and no approval exists
- A change touches OAuth scopes, deployment config, or environment identifiers
- A verification step fails and the cause is not understood
- A security weakness is discovered
- Required context is missing — which script ID, which environment, which
  Script Property
- A requested action conflicts with `PROJECT_PLAN.md`

Fail closed. "I stopped because X was ambiguous" is a correct outcome. A
plausible guess that reaches production is not.
