## Context

<!-- What problem does this solve, and why now? Link the issue if one exists. -->

Closes #

## Changes

<!-- What actually changed. Keep it factual; the diff shows the detail. -->

-

## Verification

<!-- REQUIRED. Record what you OBSERVED, not what you expected.
     A mocked or assumed pass proves nothing. -->

**Local check:**

```
$ sh scripts/check.sh
(paste the result line)
```

**Sandbox validation:**

<!-- For any change touching .js or .html, state what you exercised in the
     Sandbox web app. "Deployed successfully" is NOT validation — CI green
     only means clasp exited zero. See AGENTS.md §7.2. -->

- [ ] Deployed to Sandbox and the expected deploy step ran (not skipped)
- [ ] Web app loads
- [ ] Dashboard renders
- [ ] An existing record displays correctly
- [ ] Browser console shows no new errors
- [ ] Not applicable — this change cannot affect application behavior
      (explain why below)

Observed:

## Risk and rollback

<!-- How would someone undo this if it misbehaves in production? -->

**Rollback:**

## Security and compliance

- [ ] No secrets, tokens, credentials, or API keys added
- [ ] No real names, email addresses, task content, or other live data added
      (this repository is PUBLIC)
- [ ] No change to `appsscript.json`
- [ ] No change to OAuth scopes or advanced services
- [ ] No change to `.clasp.json`, `.claspignore`, or `.github/workflows/**`
- [ ] No change to script IDs or deployment IDs
- [ ] No change to Script Property names or expected values
- [ ] No new web app entry point, or authorization was audited for it
      (see AGENTS.md §8 — `USER_DEPLOYING` means a missed check is a data
      exposure)

If any box above is unchecked, explain here — those changes require extra
review per `PROJECT_PLAN.md` Key Requirement #9:

## Accessibility

<!-- Only for UI changes. Section 508 applies. -->

- [ ] Keyboard operable
- [ ] Visible focus state
- [ ] Sufficient contrast
- [ ] Controls have accessible labels
- [ ] Not a UI change

## AI assistance

<!-- Per the federal AI contribution policy, disclose at PR level. -->

- [ ] This change was developed with AI assistance (opencode)
- [ ] No AI assistance

A human has reviewed the full diff and takes ownership of this change.

---

### Reviewer notes

**This PR targets `main`?** Then merging it starts a **production release to
both PMSC and FCA** — but it does not complete one. Each production deploy
pauses in the **Actions** tab for reviewer approval ("Review deployments" →
select environment → **Approve and deploy**). PMSC and FCA are approved
separately, and FCA only runs if PMSC succeeded.

**Whoever merges cannot approve the deploy.** `prevent_self_review` is on, so
the *other* developer must approve each production environment. See
AGENTS.md §2.

**How to approve:** open the **Files changed** tab → **Review changes** →
**Approve** → **Submit review**. Do *not* click "Close pull request" — that
discards the PR without merging. See AGENTS.md §6.2.
