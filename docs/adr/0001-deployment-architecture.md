---
title: "ADR-0001: Deployment architecture (as-is)"
description: "Records the existing GitHub Actions + clasp deployment pipeline for FACT, its three environments, and the known gaps at time of recording"
status: accepted
tier: 2
last_updated: "2026-10-01"
nist_controls: ["CM-2", "CM-3", "CM-5", "AC-6", "SR-3"]
---

# ADR-0001: Deployment architecture (as-is)

- **Status:** Accepted (documents existing state; gaps tracked separately)
- **Date:** 2026-10-01
- **Deciders:** Chris Olry (Project Owner), Ozel Kirkland (Secondary Developer)
- **Amended by:** [ADR-0002](./0002-deployment-hardening.md) (2026-10-05) —
  closes the approval-gate, identifier, pinning, and config-divergence gaps
  recorded below. This ADR is retained unchanged as the **baseline**: it
  describes the pipeline as it stood before hardening, which is what a future
  reader needs in order to understand what ADR-0002 changed and why.

## Context and problem statement

FACT is an existing, deployed production Google Apps Script application. Its
deployment pipeline was built incrementally and was never formally recorded.
Before changing it, the current design and its weaknesses need to be written
down — otherwise any future change is a modification to an undocumented
baseline, and there is nothing to compare against when something breaks.

This ADR records the **as-is** architecture. It does not propose a change.
It exists so that ADR-0002 (deployment hardening) has a baseline to amend.

## Decision drivers

- `PROJECT_PLAN.md` Key Requirement #1: preserve existing production behavior
- Key Requirement #2: Sandbox-first validation
- Key Requirement #5: GitHub Actions deployment only — no routine local
  `clasp push`
- Key Requirement #6: production deployment requires explicit human approval
- Key Requirement #7: environment separation
- Apps Script is the mandated platform; there is no build step and no bundler

## Decision

FACT deploys to Google Apps Script via GitHub Actions using `@google/clasp`.
The repository root *is* the deployed application: every `.js` and `.html`
file at the root is pushed verbatim.

### Environments

> **Historical.** The "not enforced" below describes the state on 2026-10-01.
> Production approval is enforced as of ADR-0002. See the Follow-up table.

| Environment | Source branch | Approval | Purpose |
|---|---|---|---|
| Sandbox | `sandbox` (and legacy `dev`) | none | Validation |
| PMSC Production | `main` | **not enforced** | Live PMSC system |
| FCA Production | `main` | **not enforced** | Live FCA DAC system |

Script IDs and deployment IDs are currently literal values in
`.github/workflows/deploy.yml`. The workflow rewrites `.clasp.json` per
environment, then runs `clasp push --force` followed by
`clasp deploy -i <deployment-id>`, which updates the existing deployment
rather than creating a new one.

### Flow

```
feature/*  ──PR──►  sandbox  ──Actions──►  Sandbox Apps Script
                       │
                 manual validation
                       │
                    ──PR (1 approval)──►  main
                                            │
                                   ──Actions──►  PMSC Production
                                                 FCA Production
```

### Controls applied 2026-10-01

Branch protection on `main`: pull request required, 1 approving review, stale
approvals dismissed, last push must be approved, conversation resolution
required, force-push and deletion blocked. `sandbox` is deliberately light —
direct pushes allowed, force-push and deletion blocked — so either developer
can validate independently without a second reviewer.

A `verify` workflow runs `scripts/check.sh` on pull requests. It holds no
secrets and cannot deploy.

## Consequences

### Positive

- Single source of truth: GitHub, not the Apps Script browser editor
- No local deployment path in normal use, so environments do not drift from
  developer workstations
- Deployment is reproducible and logged in the Actions history
- Code review is enforced before anything reaches production

### Negative / accepted for now

- **Production deploys are not gated.** A merge to `main` deploys to both
  production environments automatically. Branch protection delivers "reviewed
  before deploy", not "approved to deploy". This contradicts Key Requirement
  #6 and is the largest open gap. Tracked privately as a high-severity
  security advisory.
- **PMSC and FCA deploy sequentially in one job.** If PMSC succeeds and FCA
  fails, the two production environments silently diverge. Apps Script offers
  no atomic multi-project deploy, so the achievable mitigation is fail-closed
  ordering, not atomicity.
- **Identifiers live in workflow source.** The repository is public, so the
  three deployment IDs — and therefore the `/exec` URLs — are world-readable.
  Mitigated by `"access": "DOMAIN"` restricting the web app to authenticated
  `@gsa.gov` accounts.
- **Tooling is unpinned.** `npm install -g @google/clasp` resolves to whatever
  version is current at run time (issue #11).
- **CI and local clasp configs diverge.** The workflow overwrites
  `.clasp.json` with only `{scriptId, rootDir}`, discarding the extension and
  push-order keys, so CI pushes under different rules than a local push
  (issue #12).
- **No automated tests.** `scripts/check.sh` checks syntax and secret hygiene;
  it cannot validate Apps Script runtime behavior. Validation is manual.
- **Triggers do not survive project recreation.** Time-driven triggers must be
  re-initialized by hand.

### Neutral

- `dev` still deploys to Sandbox and should be retired (issue #13)
- No `.claspignore`, so `scripts/`, `docs/`, and `*.md` are pushed into the
  Apps Script projects as inert files. Harmless, but untidy.

## Alternatives considered

**Deploy from a local machine with clasp.** Rejected: causes environment drift,
bypasses review, and leaves no audit trail. Explicitly prohibited by Key
Requirement #5.

**Separate repository per environment.** Rejected: triples maintenance for
three deployments of identical code, and makes promoting a change a
cross-repository operation.

**A build or bundling step.** Rejected as unnecessary complexity. Apps Script
consumes the files directly; a bundler adds a failure mode without adding
capability.

**Edit in the Apps Script browser editor.** Rejected: `clasp push --force`
silently overwrites browser edits on the next deploy, and the change is
invisible to git.

## Follow-up

**Superseded by ADR-0002 (2026-10-05).** The items below were open when this
ADR was written. Current status:

| Gap recorded above | Status |
|---|---|
| Production deploys not gated | **Closed** — GitHub Environments with required reviewers, `prevent_self_review` |
| PMSC and FCA share one job | **Closed** — separate jobs, FCA `needs:` PMSC |
| Identifiers in workflow source | **Closed** — per-environment secrets (history remains public) |
| Tooling unpinned (#11) | **Closed** — `@google/clasp` pinned to 3.4.1 |
| CI/local clasp config divergence (#12) | **Closed** — `jq` patches only `.scriptId` |
| `dev` still deploys (#13) | **Closed** — trigger removed |
| No automated tests | **Open** — `check.sh` covers syntax and secrets only |
| Triggers lost on project recreation | **Open** — manual re-initialization |
| No `.claspignore` | **Open** — untidy, harmless |

ADR-0002 records the deployment-hardening decision: GitHub Environments with
required reviewers, identifiers moved to per-environment secrets, PMSC and FCA
split into separate fail-closed jobs, secrets passed via `env:` rather than
shell interpolation, concurrency groups, and pinned tooling.

Related: issues #11, #12, #13 (closed by ADR-0002), #14 (closed);
private security advisories covering the approval gate, `.clasp.json`
targeting production, OAuth scope pinning, and the `USER_DEPLOYING`
authorization model.
