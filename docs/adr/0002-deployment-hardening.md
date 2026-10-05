---
title: "ADR-0002: Deployment hardening — environment approval gates"
description: "Gates production deploys behind GitHub Environments with required reviewers, moves deployment identifiers to per-environment secrets, splits PMSC and FCA into fail-closed jobs, and pins tooling"
status: accepted
tier: 2
last_updated: "2026-10-05"
nist_controls: ["CM-2", "CM-3", "CM-5", "AC-6", "AU-12", "SR-3", "SC-13", "SI-17"]
---

# ADR-0002: Deployment hardening — environment approval gates

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Chris Olry (Project Owner), Ozel Kirkland (Secondary Developer)
- **Amends:** [ADR-0001](./0001-deployment-architecture.md)

## Context and problem statement

ADR-0001 recorded the as-is deployment pipeline and named its largest gap
plainly: a merge to `main` deployed to both PMSC and FCA production
automatically, with no approval step. Branch protection delivered *reviewed
before deploy*, not *approved to deploy*. `PROJECT_PLAN.md` Key Requirement #6
asks for the latter.

The distinction is not pedantic. Reviewing a diff and authorizing a production
release are different decisions made with different information. A reviewer
approving a pull request on Tuesday may not intend an immediate release to two
live systems serving PMSC and FCA DAC. Under the old pipeline those were the
same event, and there was no moment at which anyone could say "not yet".

Four smaller weaknesses compounded it, all recorded in ADR-0001 and tracked as
issues #11, #12 and #13: `@google/clasp` was installed unpinned, so the tool
that writes to production could change version between runs; CI overwrote
`.clasp.json` with only `{scriptId, rootDir}`, discarding the extension and
push-order keys, so CI pushed under different rules than a local push; the
retired `dev` branch still triggered Sandbox deploys; and the three deployment
identifiers sat as literals in workflow source in a public repository.

This ADR records the decision to close those. It is the follow-up ADR-0001
named.

## Decision drivers

- `PROJECT_PLAN.md` Key Requirement #6: production deployment requires
  explicit human approval — the unmet requirement driving this work
- Key Requirement #1: preserve existing production behavior. The deployed
  application must not change as a side effect of hardening the pipeline
- Key Requirement #2: Sandbox-first validation
- Key Requirement #7: environment separation
- Universal contract §14.5: fail closed on ambiguity, no silent failures
- Apps Script offers no atomic multi-project deploy — partial-release windows
  can be narrowed and made recoverable, not eliminated

## Decision

FACT deploys through three GitHub Environments, with production gated on human
approval.

### Approval gates

`pmsc-production` and `fca-production` each carry a `required_reviewers`
protection rule naming both developers, with `prevent_self_review: true`. A
merge to `main` now *pauses* and waits. `sandbox` carries no rule, so
validation stays frictionless — that is the environment the model expects
changes to land in first.

`prevent_self_review: true` has a deliberate operational consequence: whoever
merges to `main` cannot approve the resulting deployment. A production release
requires a second person. This is the same property branch protection already
enforces for review, extended to the release decision.

`can_admins_bypass` remains `true` on both production environments, matching
the existing `enforce_admins: false` posture on `main`. An emergency path
exists, every use is recorded in the repository audit log, and routine use
would defeat the control.

### Identifiers in per-environment secrets

Script IDs and deployment IDs move out of workflow source into environment
secrets. `CLASPRC_JSON` is held once at **repository** level, not three times:
a single clasp credential authorizes all three Apps Script projects, so
duplicating it would create three things to rotate and three chances to miss
one. Environment-scoped jobs resolve repository secrets as a fallback, so this
works without special handling.

That fallback carries a hazard worth stating explicitly, because it fails
*silently*. If an environment were missing its own `SCRIPT_ID`, a
repository-level `SCRIPT_ID` would satisfy the workflow's non-empty guard, the
run would report green, and `clasp push --force` would write production code
to whatever project that single ID named. A failed deploy announces itself; a
deploy to the wrong project does not. `scripts/check-deploy-secrets.sh` exists
to detect precisely this condition, and distinguishes it from the merely-loud
"resolves nowhere" case. Verified absent on 2026-10-05: no `SCRIPT_ID` or
`DEPLOYMENT_ID` exists at repository level.

Moving the identifiers out of source does **not** make them secret in any
strong sense — they are already in public git history and cannot be retracted.
The gain is that the *current* target of each environment is no longer
world-readable, and changing a deploy target now requires repository admin
rather than a pull request. Web app exposure continues to rest on
`"access": "DOMAIN"` and the in-code email checks, not on identifier secrecy.

### PMSC and FCA as separate fail-closed jobs

The two production deploys become distinct jobs, with
`needs: deploy-pmsc-production` on FCA. If PMSC fails, FCA never runs and both
environments stay on the previous version. The reverse order — FCA succeeding
after PMSC failed — is the outcome this prevents.

The residual window is honest and unavoidable: if PMSC succeeds and FCA then
fails, the two production environments diverge. Apps Script has no
cross-project transaction. Separate jobs at least make FCA independently
re-runnable without re-pushing PMSC.

### Supporting changes

- `@google/clasp` pinned to `3.4.1`, set in workflow `env:` rather than as a
  variable or secret — a supply-chain pin earns its value by being visible in
  a reviewed diff (issue #11). The version was determined from evidence, not
  chosen: no release has been published since 2026-08-28, so every green run
  from 2026-09-18 onward, including production runs #37 and #39, already used
  3.4.1. Pinning records reality rather than introducing an untested version.
- `.clasp.json` is patched with `jq` touching **only** `.scriptId`, preserving
  `scriptExtensions`, `htmlExtensions`, `jsonExtensions`, `filePushOrder` and
  `skipSubdirectories`, so CI and local pushes finally follow identical rules
  (issue #12).
- `dev` removed from deploy triggers (issue #13).
- `CLASPRC_JSON` passed via `env:` and written with `printf` under `umask 077`,
  so the credential never appears on a shell command line or in a process
  listing. Removed in an `if: always()` step.
- Actions SHA-pinned rather than floating `v4` tags.
- `permissions: contents: read`.
- Concurrency groups per environment, with `cancel-in-progress: false` — never
  interrupt an in-flight production deploy.
- Every required secret guarded by a non-empty check that aborts loudly rather
  than deploying to an unintended target.

Verification lives in a separate `verify.yml` holding no secrets and incapable
of deploying, so a change to verification can never alter deployment behavior.

## Consequences

### Positive

- Key Requirement #6 is met: production deployment requires explicit human
  approval, enforced by the platform rather than by convention
- Release timing becomes a separate, deliberate decision from code review
- A PMSC failure can no longer leave FCA ahead of it
- CI and local pushes follow identical rules, removing a class of
  "works locally, differs in CI" defect
- The deploying tool version is fixed and changes only through review
- Closes issues #11, #12, #13

### Negative / accepted for now

- **A production release now needs two people available.** With
  `prevent_self_review: true`, a solo developer cannot ship to production.
  This is the intended trade-off, but it is a real constraint on a two-person
  team and will be felt during leave or absence. The admin bypass is the
  documented emergency path.
- **The PMSC-succeeds-then-FCA-fails window remains.** Narrowed and
  recoverable, not eliminated. No platform mechanism can close it.
- **`can_admins_bypass: true`** means the gate is procedural for an admin, not
  absolute. Accepted deliberately; audit-logged.
- **No deployment branch policy** on the production environments. The binding
  of production to `main` rests on `if: github.ref == 'refs/heads/main'` inside
  `deploy.yml` — a condition in a file any branch can modify. A branch policy
  would enforce the same constraint at the platform layer, out of reach of a
  workflow edit. Tracked as a follow-up issue.
- **Historical identifiers remain public.** Moving them to secrets does not
  retract them from git history.
- **Still no automated tests.** `scripts/check.sh` verifies syntax and secret
  hygiene; it cannot validate Apps Script runtime behavior. Validation remains
  manual, per the Sandbox checklist.
- **Approval fatigue is a plausible failure mode.** A gate clicked through
  without reading provides documentation, not assurance.

### Neutral

- Secret listing now requires repository admin, so a non-admin cannot audit
  deploy targets unaided
- Still no `.claspignore`, so `scripts/`, `docs/` and `*.md` are pushed into
  the Apps Script projects as inert files. Untidy, harmless
- Time-driven triggers still do not survive project recreation

## Alternatives considered

**Keep branch protection as the only gate.** Rejected: it enforces review of a
diff, not authorization of a release, and cannot distinguish "this code is
correct" from "deploy this to two live systems now". That conflation is the
specific problem this ADR exists to solve.

**One job deploying both production environments sequentially.** Rejected: a
mid-job failure leaves the environments divergent with no independent re-run
path, and a single `environment:` key cannot gate two targets separately.

**Deploy production manually with local `clasp push` after approval.**
Rejected: prohibited by Key Requirement #5, and it reintroduces the
workstation-drift and no-audit-trail problems ADR-0001 recorded.

**`workflow_dispatch` with a manual trigger instead of environment gates.**
Rejected: moves the decision outside the merge flow, loses the automatic link
between a reviewed commit and its deployment, and records approval less
legibly than the Environments activity log.

**Store identifiers as repository secrets rather than environment secrets.**
Rejected: it is exactly the shadowing hazard described above. Three
environments sharing one `SCRIPT_ID` would deploy all three to one project
while reporting success.

**Separate `CLASPRC_JSON` per environment.** Rejected: one credential already
authorizes all three projects, so three copies would triple rotation burden
with no isolation gain. Revisit if per-project service credentials are ever
issued.

## Follow-up

- Add a deployment branch policy restricting `pmsc-production` and
  `fca-production` to `main` — platform-layer defense in depth for the ref
  guard currently living in `deploy.yml`
- Re-validate the full pipeline per universal contract §8.3 after the first
  real production release through the gates, capturing observed per-job
  approval and deploy output
- Revisit `can_admins_bypass` if the team grows beyond two developers
- Pin `appsscript.json` `oauthScopes` explicitly — tracked privately; scope
  drift is a separate concern from deployment gating
- Automated tests beyond syntax checking remain unaddressed

Related: issues #11, #12, #13 (closed by this change), #15, #16; private
security advisories covering the approval gate, `.clasp.json` targeting
production, OAuth scope pinning, and the `USER_DEPLOYING` authorization model.
