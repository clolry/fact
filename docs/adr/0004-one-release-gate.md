---
title: "ADR-0004: One release gate, not four"
description: "Consolidates release authorization to a single required approval on the main pull request, removes the second production deploy gate and self-review prohibition, and automates the post-release branch sync"
status: accepted
tier: 2
last_updated: "2026-10-08"
nist_controls: ["AC-6", "AU-2", "AU-12", "CM-2", "CM-3", "CM-5", "SI-17", "SR-3"]
---

# ADR-0004: One release gate, not four

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Chris Olry (Project Owner)
- **Amends:** [ADR-0002](./0002-deployment-hardening.md)

## Context and problem statement

ADR-0002 hardened the deployment pipeline by adding GitHub Environment
approval gates to both production environments, with `prevent_self_review`
enabled so whoever merged to `main` could not approve the resulting deploy.
That was the right instinct: `PROJECT_PLAN.md` Key Requirement #6 asks for
*approved to deploy*, not merely *reviewed before deploy*.

In practice, shipping one change required four human gates:

| Gate | Who | Reviewing what |
|---|---|---|
| PR to `sandbox` | either dev | the actual diff |
| PR to `main` | the *other* dev (required) | the same diff |
| `pmsc-production` deploy | the *other* dev (required) | the same diff |
| `fca-production` deploy | the *other* dev (required) | the same diff |

Three of the four needed the second developer, and all four examined the same
change. The promotion PR in particular is byte-for-byte what was approved on
the sandbox PR, so reviewing it again adds no information.

On 2026-10-07 this was measured against reality. A set of small, low-risk
changes — a runner-image pin, dead-code removal, documentation corrections —
took most of a working day to reach production. The delay was not review time.
It was waiting for a second person to be available for three sequential
clicks, plus the mechanical failures the ceremony created along the way:

- A manual `main` → `sandbox` merge is required after every squash-merged
  promotion, or `main`'s "require branches to be up to date" rule blocks the
  next one. That step was missed, PR #36 was refused, and the fix for it
  dismissed an existing reviewer approval — which then collided with
  `require_last_push_approval` and deadlocked the PR entirely.
- The admin bypass was used **twice in one day**: once on `pmsc-production`
  during a GitHub 500-error incident (recorded on PR #32), and once considered
  for the #36 deadlock.

That last point is the decisive evidence. A control heavy enough to be routed
around is weaker than a lighter control that is actually followed. Four gates
with the same two people is not four times the assurance of one; it is the same
assurance, four times the latency, with pressure toward bypass.

## Decision drivers

- **NIST CM-3 and CM-5 require that a change be reviewed and authorized by
  someone other than its implementer, with an audit trail.** One well-placed
  gate satisfies this. Nothing in SP 800-53 requires the same change to be
  approved four times by the same people.
- **Two-person team.** With `@clolry` and `@0zelKirkland` as the only
  reviewers, every required gate is a hard dependency on one specific person's
  availability.
- **Observed bypass behavior.** Two admin overrides in a single day, both
  driven by gate friction rather than by any judgment that review was
  unnecessary.
- **`PROJECT_PLAN.md` Key Requirement #1 — preserve existing behavior.** The
  fail-closed property of the pipeline (a PMSC failure must not leave FCA
  deployed alone) must survive any change to the gates.
- **Secret resolution is name-based.** Both production jobs reference
  `${{ secrets.SCRIPT_ID }}` and `${{ secrets.DEPLOYMENT_ID }}` by identical
  names, resolved per declared environment. This constrains the solution
  space — see *Alternatives*.
- **FACT is in production** for PMSC and rolling out to FCA DAC. Faster
  release cadence is a safety property, not just convenience: it shortens the
  time a known defect stays live.

## Decision

**Release authorization consolidates to one required approval, on the `main`
pull request.** Everything downstream of that approval is executable by the
person performing the release.

### 1. Separation of duties is enforced at the pull-request gate

`main` keeps:

- require a pull request before merging
- require **1** approving review
- dismiss stale approvals on new pushes
- require conversation resolution
- no force push, no deletion

The author cannot approve their own pull request. **This is the CM-3/CM-5
control, and it is unchanged.**

### 2. `require_last_push_approval` is disabled on `main`

This setting demanded that the most recent push be approved by someone other
than the pusher. Combined with `dismiss_stale_reviews`, it produced a
deadlock: the PR author pushes a routine branch update, which dismisses the
approval, and the only other reviewer is excluded as "last pusher" from a
previous merge.

`dismiss_stale_reviews` already guarantees that any push invalidates prior
approval and forces a fresh review of the current head. The additional
constraint added a failure mode without adding assurance.

### 3. The deploy gate is reclassified as a timing control, held by one person

- `pmsc-production` — **required reviewers retained**, `prevent_self_review`
  **disabled**
- `fca-production` — **required reviewers removed**, gated by
  `needs: deploy-pmsc-production`
- `sandbox` — unchanged, no rules

The deploy gate answers a different question from code review: not "is this
change correct?" but "should it go live right now?" That is a scheduling
judgment about the production environment, and the person conducting the
release is the right person to make it. Requiring a *second* person serialized
every release on someone else's calendar while re-examining a diff that had
already been independently approved.

Removing FCA's gate does not weaken fail-closed behavior. `needs:` still means
FCA cannot run unless PMSC succeeded, so a PMSC failure leaves **both**
environments on the previous version. One approval authorizes the release;
`needs:` enforces the ordering.

### 4. Both production environments stay separate

Despite only one gating on a reviewer, `pmsc-production` and `fca-production`
remain distinct GitHub Environments. This is load-bearing — see the rejected
alternative below.

### 5. The post-release branch sync is automated

A new `sync-main-to-sandbox` job merges `main` back into `sandbox` immediately
after **both** production deploys succeed. It elevates to `contents: write`
for that job alone; the workflow default remains `contents: read`.

It is a no-op when `sandbox` already contains `main`, so re-running is safe. It
does not run if either production deploy failed — in that state the
environments differ and a human should look before any branch moves. On
conflict it fails loudly and points at `AGENTS.md` §7.5 rather than attempting
a resolution, because a careless `deploy.yml` resolution can silently reinstate
the retired `dev` trigger (#13) or the whole-file `.clasp.json` overwrite (#12).

### 6. Promotion pull requests are approve-on-sight

When a promotion PR's diff equals the diff already approved on the
corresponding `sandbox` PR, the reviewer confirms that equality and approves.
No second substantive review. If the diffs differ, it is not a promotion and
gets a full review.

### 7. Auto-merge and automatic branch deletion are enabled

`gh pr merge <n> --auto --merge` becomes standard, so a PR merges itself when
requirements are met instead of requiring someone to return and click. Merged
head branches delete automatically.

## Consequences

### Positive

- **One required approval from the second developer per change**, down from
  three. Measured effect on the first release under this model: PR merge to
  both environments live in roughly one hour, versus most of a day.
- **Bypass pressure removed.** The deadlock that prompted two override
  considerations cannot recur.
- **Fewer mechanical failure modes.** The manual sync step that caused the #36
  deadlock no longer exists.
- **Audit trail is unchanged.** Every merge still carries a named approver;
  every deploy still records an approval event with a user and timestamp
  (AU-2, AU-12).
- **Faster defect remediation.** The time a known production bug stays live is
  now bounded by one approval, not three.

### Negative / accepted for now

- **A single person can take a reviewed change to production.** Accepted
  deliberately. They cannot author *and* approve the change; they can only
  choose when an independently-approved change releases.
- **One approval is a single point of failure in the other direction.** If the
  sole reviewer approves carelessly, nothing downstream catches it. Previously
  three gates offered three chances to notice — though all three examined the
  same diff, so in practice this is closer to one chance either way.
- **The `sync-main-to-sandbox` job holds `contents: write`.** A compromised
  action in that job could push to `sandbox`. Mitigated by job-scoped
  permissions, a SHA-pinned checkout, and no secrets in that job. It cannot
  push to `main`.
- **`can_admins_bypass: true` remains enabled** on the environments. Not
  changed here; every use is recorded in the audit log, and `AGENTS.md` §2
  still states routine use defeats the control.
- **No automated tests still.** Validation remains review plus manual Sandbox
  checks. Reducing human gates raises the value of the test harness this
  repository does not yet have. This is the most significant accepted gap.

### Neutral

- `prevent_self_review` and the FCA reviewer rule are GitHub Environment
  settings, not repository files. They are recorded here and in
  `PROJECT_PLAN.md` as intended state, and verified by
  `scripts/check-deploy-secrets.sh`, which was updated in the same change —
  its guidance text previously asserted the old posture and would have told a
  reader the new configuration was broken.

## Alternatives considered

**A single `production` environment containing both deploy jobs.** This was the
author's first proposal and it is **unsafe**. Both jobs reference
`${{ secrets.SCRIPT_ID }}` and `${{ secrets.DEPLOYMENT_ID }}` by the same name,
resolving them from whichever environment the job declares. With one shared
environment, both would resolve the *same* values: PMSC's code pushed to one
Apps Script project twice, FCA never updated, and the run reporting green.
That is precisely the silent-divergence failure ADR-0002 and
`scripts/check-deploy-secrets.sh` exist to prevent
(`PROJECT_PLAN.md` §Deployment Secrets). Rejected on discovery; recorded here
so it is not re-proposed. Keeping separate environments and removing only
FCA's reviewer achieves the identical one-approval outcome with no change to
secret resolution.

**Remove the production deploy gate entirely.** Rejected: it would collapse
*reviewed* and *released* back into a single event, which is the exact gap
ADR-0001 identified and ADR-0002 was written to close. A reviewer approving a
diff on Tuesday is not necessarily authorizing an immediate release to two
live systems. The timing decision must remain explicit.

**Reduce required approvals on `main` to zero and rely on the deploy gate.**
Rejected: it inverts the controls. Code review is where a change is actually
examined and where author-cannot-approve separation has meaning. Trading the
substantive gate for the scheduling gate would weaken CM-3/CM-5 rather than
streamline it.

**Keep all four gates and accept the latency.** Rejected on evidence. The
posture produced two admin bypasses in one day. A control that is routinely
overridden provides less assurance than a lighter control that is consistently
followed, and it corrodes the credibility of the remaining controls.

## Follow-up

Each needs a tracked issue (§15.5):

1. **Validate `sync-main-to-sandbox` on a real release.** It has never
   executed. Until it does, the manual §7.5 merge remains the fallback, and
   the first release under this ADR should be watched for it.
2. **Add automated tests.** Explicitly raised in priority by this decision —
   fewer human gates means less chance to catch a defect by eye. The
   field-projection logic in ADR-0003 and the notification filtering in #30
   are the strongest first candidates.
3. **Revisit `can_admins_bypass`** now that gate friction is reduced. The
   justification for leaving it enabled was partly that gates could deadlock.
   They no longer can.
4. **Review this ADR after ten releases** against the actual outcome: did
   defect escape rate change, and did release latency actually fall?

## Note on provenance

Developed with AI assistance (opencode) on 2026-10-08, at the project owner's
direction after the release-latency problem was raised. The single-environment
alternative was proposed by the assistant and withdrawn by the assistant on
discovering the secret-collision defect before any code was written; the
decision to streamline, and the specific settings applied, are the project
owner's.

The settings described in sections 2 and 3 were applied by the project owner in
the GitHub UI and independently verified by
`scripts/check-deploy-secrets.sh` on 2026-10-08:

```
pmsc-production  required_reviewers=[0zelKirkland, clolry]  prevent_self_review=false
fca-production   rules=[]
sandbox          rules=[]
SCRIPT_ID / DEPLOYMENT_ID environment-scoped in all three
```

First release under this model: run #54, commit `2e74c26`, one approval
(`clolry`, `pmsc-production`), both production environments reaching
`2e74c26` successfully with FCA running unattended behind `needs:`.
