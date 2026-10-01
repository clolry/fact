---
title: "ADR-NNNN: <short decision title>"
description: "<one-line summary of what was decided>"
status: proposed
tier: 2
last_updated: "YYYY-MM-DD"
nist_controls: []
---

# ADR-NNNN: <short decision title>

- **Status:** proposed | accepted | superseded by ADR-NNNN | rejected
- **Date:** YYYY-MM-DD
- **Deciders:** <names>

## Context and problem statement

<!-- What situation forces a decision? Two or three sentences. Why now?
     Write this so someone joining in a year understands the pressure that
     produced the decision, not just the outcome. -->

## Decision drivers

<!-- The constraints that actually narrow the options. For FACT these are
     usually PROJECT_PLAN.md Key Requirements, Apps Script platform limits,
     Section 508, or the fact that the app is already in production. -->

-

## Decision

<!-- What was decided, stated plainly in the present tense.
     "FACT deploys via X" — not "we should deploy via X". -->

## Consequences

### Positive

-

### Negative / accepted for now

<!-- Be honest here. An ADR that lists no downsides is not a decision record,
     it is advocacy. If a known gap is being accepted, say so and link the
     issue or advisory tracking it. -->

-

### Neutral

-

## Alternatives considered

<!-- At least one. For each: what it was, and the specific reason it lost.
     "Rejected: adds a failure mode without adding capability" is useful.
     "Rejected: not a good fit" is not. -->

**<Alternative>.** Rejected: <reason>.

## Follow-up

<!-- What this decision defers, and what should trigger revisiting it.
     File tracked issues for anything named here — a follow-up mentioned only
     in prose is not tracked (AGENTS.md §15.5 of the universal contract). -->

---

## When to write an ADR

Per the universal contract §15.1, create an ADR when a change:

- adds an external dependency or service
- changes an authentication or authorization flow
- introduces a new data store or changes data classification
- alters module boundaries or public API contracts
- changes deployment architecture or infrastructure topology
- selects or replaces a framework or major library

For FACT specifically, also write one when a change touches `appsscript.json`,
OAuth scopes, the deployment pipeline, or the `USER_DEPLOYING` authorization
model.

Naming: `NNNN-short-kebab-title.md`, sequential, never reused. Do not delete a
superseded ADR — mark it superseded and link forward.
