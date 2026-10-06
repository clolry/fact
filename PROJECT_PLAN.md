---
title: "FACT - Federated Action & Coordination Tracker - Project Plan"
description: "Architecture, workflow, environment configuration, governance baseline, and engineering roadmap for the Federated Action & Coordination Tracker Google Apps Script project"
status: canonical
tier: 3
load_priority: reference-only
audience: ["developers", "managers"]
---

# Project Plan: Federated Action & Coordination Tracker (FACT)

> **Instructions for humans and AI coding agents:**  
> This canonical project plan documents the operating model for the **Federated Action & Coordination Tracker (FACT)**. FACT is an existing production Google Apps Script application. All agents and developers must preserve existing behavior unless an approved change request explicitly authorizes a behavior change.  
>
> AI coding agents must review this file, `docs/docs_technical.md`, and relevant source diffs before making code, architecture, OAuth scope, deployment, or workflow changes.

---

## Project Identity

| Field | Value |
|---|---|
| **Project Name** | Federated Action & Coordination Tracker (FACT) |
| **Repository Name** | `FACT` |
| **GitHub Repository** | `https://github.com/clolry/FACT` |
| **Organization/Agency** | GSA / FAS / OMD / Portfolio Management Service Center (PMSC) |
| **Primary Program/User Group** | Portfolio Management Service Center |
| **Expansion / Rollout Group** | FCA DAC, OMD executive front office |
| **Project Owner** | Chris Olry, Project Manager, Portfolio Management Service Center |
| **Lead Developer** | Chris Olry |
| **Secondary Developer** | Ozel Kirkland |
| **Start Date** | Existing production application; active modernization and governance baseline in 2026 |
| **Target Completion** | December 31, 2026 |
| **Lifecycle Status** | Existing deployed production application with ongoing stabilization, governance, and FCA DAC rollout |

---

## Business Objective & Background

The **Federated Action & Coordination Tracker (FACT)** is a Google Workspace application used by workgroups to track tasks, coordinate action items, and route items through executive review and approval.

FACT helps replace fragmented spreadsheets, manual email routing, and informal status tracking with a centralized, auditable task and coordination platform. The Portfolio Management Service Center is responsible for FACT development and is the primary user group. The project is also being prepared for rollout to the **FCA DAC**, OMD’s executive front office.

FACT is different from greenfield projects because it is already deployed to production. Development must therefore emphasize:

1. preserving existing production behavior;
2. validating changes in Sandbox before production;
3. routing all code changes through GitHub pull requests;
4. deploying to Google Apps Script through GitHub Actions using `clasp`;
5. preventing environment drift caused by direct local `clasp push` operations.

---

## Key System & Repository Identifiers

| Asset / System | Identifier / URL | Notes |
| :--- | :--- | :--- |
| **GitHub Repository** | `https://github.com/clolry/FACT` | Primary repository for source control and pull requests. |
| **Local Repository Path** | `~/code/FACT/` | Developer workstation checkout location. |
| **Default Branch** | `main` | Production source branch. |
| **Sandbox Branch** | `sandbox` | Default validation branch and Sandbox deployment source. |
| **Development Branch** | `dev` | Legacy/development branch. May be retired after workflow hardening. Currently may deploy to Sandbox if workflow still allows it. |
| **Workflow File** | `.github/workflows/deploy.yml` | GitHub Actions workflow for Apps Script deployment. |
| **Apps Script Location** | Repository root | `appsscript.json`, `.clasp.json`, `.gs`, and `.html` files are currently at repo root. |
| **Apps Script Type** | Container-bound Google Apps Script | Bound to a Google Sheet. |
| **Database / Backend** | Google Sheets | FACT data is stored in Google Sheets tabs managed by Apps Script services. |
| **Sandbox Environment** | Google Apps Script project and deployment | Current script/deployment IDs are in the existing workflow. Target state: store in GitHub Environment secrets. |
| **PMSC Production Environment** | Google Apps Script project and deployment | Current script/deployment IDs are in the existing workflow. Target state: store in GitHub Environment secrets with required reviewers. |
| **FCA Production Environment** | Google Apps Script project and deployment | Current script/deployment IDs are in the existing workflow. Target state: store in GitHub Environment secrets with required reviewers. |
| **Clasp Auth Secret** | `CLASPRC_JSON` | GitHub secret containing clasp authentication JSON. |
| **cloud.gov** | Out of scope | FACT is a Google Apps Script / Google Workspace application. |

### Current Environment Model

FACT has three active deployment environments:

1. **Sandbox**
   - Default validation environment.
   - Used to test changes before production rollout.
   - Should deploy from the `sandbox` branch.
   - Existing workflow may also deploy `dev` to Sandbox; retiring `dev` is a recommended governance cleanup.

2. **PMSC Production**
   - Existing production deployment for the Portfolio Management Service Center.
   - Deploys from `main`.
   - Production deployment requires explicit human approval.

3. **FCA Production**
   - Existing production or rollout deployment for FCA DAC.
   - Deploys from `main`.
   - Production deployment requires explicit human approval.
   - PMSC and FCA production should deploy together from `main` unless a future approved process separates them.

---

## Tech Stack

| Component | Choice | Rationale |
|---|---|---|
| **Language** | JavaScript, Google Apps Script V8 runtime | Native language/runtime for Google Apps Script and Google Workspace automation. |
| **Frontend** | Google Apps Script `HtmlService` with HTML, CSS, and client-side JavaScript | Supports the existing FACT web app interface without a separate hosting platform. |
| **Backend** | Google Apps Script server-side JavaScript | Integrates directly with Sheets, Drive, Gmail, Calendar, Groups, and Script Properties. |
| **Database** | Google Sheets | FACT is container-bound to a Google Sheet and uses Sheets as the application data store. |
| **Hosting** | Google Apps Script web app deployment | Required runtime/hosting platform for this application. |
| **Google Workspace Integrations** | Google Sheets, Google Drive, Gmail, Google Groups, Google Calendar | Supports task tracking, document coordination, notifications, permissions, and calendar-related workflows. |
| **CI/CD** | GitHub Actions + `@google/clasp` | GitHub Actions performs `clasp push` and `clasp deploy`; developers should not deploy directly from local machines. |
| **Local Development Tools** | Git, Node.js/npm, clasp, VS Code, opencode through `acq/msb` | Developers and opencode edit local files, review diffs, commit to branches, and route changes through GitHub. |
| **AI/API Integration** | USAi API through `acq/opencode` sandboxed workflow; possible Apps Script properties for USAi/Gemini integrations | AI-related credentials must remain in approved secret stores or Script Properties, never source code. |
| **Container Runtime** | None | Not applicable. FACT is serverless on Google Apps Script. |
| **cloud.gov** | Not used | Explicitly out of scope. |

---

## Compliance Level

> **Working assumption only. Final categorization must be confirmed through applicable agency policy, system owner review, privacy review, and security review.**

- [ ] **FIPS Low** — Public-facing informational content, no PII, no CUI
- [x] **FIPS Moderate, working assumption pending review** — Internal federal application containing employee information, work assignments, executive review comments, financial information, procurement/acquisition-sensitive information, and potentially sensitive pre-decisional information
- [ ] **FIPS High** — National security systems, critical infrastructure

FACT appears to use less PII than some personnel/travel systems, but it still handles internal operational data, names, email addresses, assignments, executive coordination records, financial information, and procurement/acquisition-sensitive content. Treat the system as at least moderate-sensitivity unless the agency determines otherwise.

---

## Data Classification

FACT may contain the following data types:

- [ ] Public data only
- [x] **Employee names**
- [x] **Employee email addresses**
- [x] **Workgroup/task assignments**
- [x] **Executive review comments**
- [x] **Approval status**
- [x] **Due dates**
- [x] **Sensitive internal deliberative or pre-decisional information**
- [x] **Financial data**
- [x] **Procurement/acquisition-sensitive information**
- [x] **Potential CUI** — pending agency determination
- [ ] PHI
- [ ] Authentication credentials/secrets in source code

### Data Handling Rule

No secrets, credentials, tokens, PII, CUI, procurement-sensitive content, financial-sensitive content, or other sensitive data may be placed in:

- source code,
- prompts,
- generated test data,
- logs,
- GitHub issues,
- pull request text,
- comments,
- documentation,

unless explicitly approved and handled according to applicable agency policy.

All information contained within USAi, if used in connection with this project, is subject to the agency’s artificial intelligence policy, privacy policy, and record retention policy.

---

## Key Requirements

1. **Preserve Existing Production Behavior**  
   FACT is already deployed. Changes must avoid regressions and should be narrowly scoped. AI agents and developers must not refactor broad areas of the codebase without explicit approval.

2. **Sandbox-First Validation**  
   Sandbox is the default validation environment. All meaningful functional changes should be tested in Sandbox before production deployment.

3. **GitHub-Based Development Workflow**  
   Local development happens on branches in `~/code/FACT/`. Developers review changes locally, commit to branches, push to GitHub, open pull requests, and merge only after review.

4. **Pull Request Review Before Merge**  
   All changes must go through pull request review before merge. PRs may be reviewed by one or more reviewers. Chris Olry and Ozel Kirkland are both reviewers.

5. **GitHub Actions Deployment Only**  
   Deployment to Google Apps Script must happen through GitHub Actions using `clasp`. Developers must not run routine `clasp push` or `clasp deploy` directly from local machines.

6. **Production Human Approval**  
   Production deployments to PMSC and FCA require explicit human approval. GitHub Environments with required reviewers are the preferred enforcement mechanism.

7. **Environment Separation**  
   Sandbox, PMSC production, and FCA production must remain separate Apps Script environments with separate script IDs, deployment IDs, Script Properties, and environment-specific configuration.

8. **Secret and Identifier Protection**  
   Credentials, tokens, API keys, and environment-specific sensitive configuration must be stored in GitHub Secrets, GitHub Environments, or Google Apps Script Script Properties. They must not be hard-coded in source code.

9. **OAuth Scope Review**  
   Any change to `appsscript.json`, OAuth scopes, advanced services, Drive/Gmail/Calendar permissions, or deployment configuration requires extra human review.

10. **Section 508 Accessibility**  
    FACT should support Section 508 accessibility expectations, including semantic markup, keyboard accessibility, sufficient contrast, clear focus states, and accessible labels for controls.

11. **No cloud.gov Dependency**  
    cloud.gov is out of scope. FACT is hosted and deployed through Google Apps Script.

---

## Constraints

- [x] Must operate within Google Apps Script runtime limits and quotas.
- [x] Must use Google Workspace / Google Apps Script as the application platform.
- [x] Must support Section 508 accessibility expectations.
- [x] Must integrate with Google Sheets as the backing data store.
- [x] Must integrate with Google Drive, Gmail, Google Groups, and Google Calendar where required by existing functionality.
- [x] Must use GitHub as the system of record for source code.
- [x] Must deploy through GitHub Actions using `clasp`.
- [x] Must not rely on routine local `clasp push` / `clasp deploy`.
- [x] Must protect production through explicit human approval.
- [x] Must preserve existing production behavior unless behavior change is explicitly approved.
- [x] Must keep cloud.gov out of scope.

---

## Team

| Role | Person | Access Level / Responsibility |
|---|---|---|
| **Project Owner** | Chris Olry | Project ownership, prioritization, approval, review |
| **Lead Developer** | Chris Olry | Development, review, GitHub/GAS coordination |
| **Secondary Developer** | Ozel Kirkland | Development and review |
| **Pull Request Reviewers** | Chris Olry; Ozel Kirkland | Review code changes before merge |
| **Security / Privacy / Compliance** | TBD | Review as required by agency process |
| **Production Deployment Approvers** | TBD; initially project owner or designated reviewers | Approve production deployments through GitHub Environments or equivalent process |
| **Primary User Group** | PMSC | Operational use and feedback |
| **Rollout User Group** | FCA DAC | FCA production rollout and validation |

---

## Agent Environment

### Where AI Coding Agents Operate

- [x] **Local machine** — opencode edits files in the local repository at `~/code/FACT/` through `acq/msb`.
- [x] **Sandboxed workflow** — USAi API is used through the `acq/opencode` sandboxed workflow.
- [x] **CI/CD only for deployment** — GitHub Actions performs deployment to Google Apps Script.
- [ ] **GitHub Codespaces** — not the current workflow.
- [ ] **cloud.gov** — out of scope.

### Local Development Setup

| Tool / Location | Status |
|---|---|
| MacBook Pro | Primary local development workstation |
| Local code root | `~/code/` |
| FACT local repo | `~/code/FACT/` |
| Git | Installed |
| Node.js/npm | Installed |
| clasp | Installed, but not used for routine direct local deployment |
| opencode | Run through `acq/msb` |
| USAi API | Used through `acq/opencode` sandboxed workflow |
| VS Code | Used for reviewing and editing files |

---

## Agent Guardrails

AI coding agents, including opencode, must follow these guardrails.

### Allowed by Default

AI agents may:

1. read project files;
2. propose implementation plans;
3. edit local files in `~/code/FACT/`;
4. generate documentation updates;
5. suggest tests and validation steps;
6. help interpret `git diff`;
7. help prepare commit messages and PR descriptions.

### Requires Human Review and Explicit Approval

AI agents may only do the following with explicit human review and approval:

1. push to GitHub, including `dev` or `sandbox`;
2. open pull requests;
3. modify GitHub Actions workflows;
4. modify `.clasp.json`, `.claspignore`, or clasp deployment behavior;
5. modify `appsscript.json`;
6. add, remove, or change OAuth scopes;
7. modify production identifiers;
8. modify environment configuration;
9. alter Script Property names or expected values;
10. make broad refactors;
11. change user-visible production behavior;
12. update permission, sharing, Drive, Gmail, Calendar, or Groups behavior.

### Prohibited Without Separate Explicit Approval

AI agents must not:

1. deploy to Google Apps Script;
2. run production deployment commands;
3. run `clasp push` or `clasp deploy` as part of normal development;
4. commit or expose secrets, credentials, API keys, tokens, PII, CUI, or sensitive data;
5. change production behavior without an approved request;
6. bypass pull request review;
7. bypass production approval.

### Human Review Requirement

All AI-generated diffs must be reviewed by a human before commit. The human reviewer should inspect:

- changed files,
- `git diff`,
- affected OAuth scopes,
- deployment files,
- any use of secrets or identifiers,
- potential impact to Sandbox, PMSC production, and FCA production.

---

## Development Workflow

### Standard Developer Workflow

1. Developer or opencode edits files locally in:

   ```bash
   ~/code/FACT/

2. Developer reviews changes locally in VS Code.

3. Developer reviews the diff:

git diff

4. Developer creates or uses a local branch.

5. Developer commits changes to a feature branch.

6. Developer pushes the branch to GitHub.

7. Developer opens a pull request.

8. PR is reviewed by one or more reviewers.

9. After approval, changes are merged into the appropriate branch.

10. GitHub Actions deploys to the appropriate Google Apps Script environment.

### Recommended Branching Model
FACT should use this branching model:

feature/<short-description>
        ↓ PR
sandbox
        ↓ GitHub Actions deploys to Sandbox
        ↓ Sandbox validation
        ↓ PR / approval
main
        ↓ GitHub Environment approval
        ↓ GitHub Actions deploys to PMSC Production and FCA Production

### Branch Roles
Branch	Purpose	Deployment
<code>main</code>	Production source of truth	Deploys to PMSC production and FCA production after human approval
<code>sandbox</code>	Default validation branch	Deploys to Sandbox
<code>dev</code>	Legacy development branch	May currently deploy to Sandbox, but should be retired or de-emphasized
<code>feature/*</code>, <code>bugfix/*</code>, <code>chore/*</code>	Local and remote development branches	No direct deployment unless merged to <code>sandbox</code> or <code>main</code>

### Recommended Branch Naming
Use clear branch names:
feature/<short-description>
bugfix/<short-description>
chore/<short-description>
docs/<short-description>

Examples:
feature/fca-dashboard-filters
bugfix/approval-status-regression
chore/move-deployment-ids-to-secrets
docs/update-sandbox-validation-checklist

### Pull Request Policy
Every code change should be reviewed through a pull request.

### PR Expectations
Each PR should include:

summary of the change;
reason for the change;
affected files/modules;
testing performed;
Sandbox validation status, if applicable;
screenshots for UI changes, if useful;
notes about OAuth scope, Script Property, deployment, or permission changes;
known risks or rollback notes.

### Required Extra Review
Extra review is required for changes to:

appsscript.json;
.github/workflows/deploy.yml;
.clasp.json;
.claspignore;
Code.js routing or authentication behavior;
OAuth scopes;
Apps Script advanced services;
Gmail, Drive, Calendar, or Groups permissions;
deployment IDs;
script IDs;
Script Properties;
environment configuration;
production-facing workflows;
executive approval routing;
notification dispatch.

## Deployment Workflow
### Deployment Principle
Developers should not run direct local deployments as part of normal development.

Use this rule:

Developers must not run clasp push or clasp deploy from local machines as part of normal development. Sandbox and production deployments are performed through GitHub Actions. Any exception requires explicit approval and must be documented.

### Current Workflow
The current GitHub Actions workflow is:
.github/workflows/deploy.yml

As of 2026-10-05 the Target Workflow below is IMPLEMENTED. See
docs/adr/0002-deployment-hardening.md. The workflow:

installs Node.js 20;
installs @google/clasp pinned to an exact version;
writes CLASPRC_JSON to ~/.clasprc.json via env: under umask 077, and removes it
  after the job;
patches only .scriptId in .clasp.json, preserving all other keys;
runs clasp push --force;
runs clasp deploy;
deploys sandbox to Sandbox (the dev trigger has been removed);
deploys main to PMSC production and then FCA production, each as a separate job
  gated on required-reviewer approval via GitHub Environments, with FCA
  dependent on PMSC succeeding;
reads SCRIPT_ID and DEPLOYMENT_ID from Environment Secrets rather than workflow
  source, and aborts loudly if any required secret is unset.

A separate verify.yml runs scripts/check.sh on pull requests. It holds no
secrets and cannot deploy. The verify check is required on main.

### Target Workflow
IMPLEMENTED as of 2026-10-05.
Source Branch	Environment	Deployment Behavior
<code>sandbox</code>	Sandbox	Automatic deployment after merge/push to <code>sandbox</code>
<code>main</code>	PMSC Production	Deploys only after explicit human approval (required reviewers)
<code>main</code>	FCA Production	Deploys only after explicit human approval; also requires PMSC to have succeeded

The <code>dev</code> branch has been removed from deployment triggers
(issue #13).

### Production Approval
Production deployments require explicit human approval. As built:

GitHub Environments in use:

sandbox (no protection rules — validation must stay frictionless)
pmsc-production (required reviewers)
fca-production (required reviewers)

Required reviewers on both production environments are Chris Olry and Ozel
Kirkland, with prevent_self_review enabled. Consequence worth planning around:
whoever merges to main cannot approve the resulting deployment, so a
production release needs both developers available.

can_admins_bypass is true on both production environments, matching the
enforce_admins:false posture on main. An emergency path exists and every use
is recorded in the repository audit log.

Environment-specific values are stored in GitHub Environment Secrets.

The verify check is required on main before merge.

PMSC and FCA deploy from main as separate jobs rather than together. FCA
depends on PMSC succeeding, so a PMSC failure leaves both environments on the
previous version. This satisfies the intent of deploying them "together" —
neither advances without the other — while making FCA independently
re-runnable if it alone fails. Apps Script provides no atomic multi-project
deploy, so the PMSC-succeeds-then-FCA-fails divergence window is narrowed and
recoverable, not eliminated.

## GitHub Secrets and Environment Configuration
### Current State
IMPLEMENTED as of 2026-10-05. Identifiers are no longer inline in workflow
YAML; each environment supplies its own via Environment Secrets.

As-built secret names (verified read-only on 2026-10-05 via
scripts/check-deploy-secrets.sh):
Environment	Secret Name	Purpose
Repository	<code>CLASPRC_JSON</code>	clasp authentication JSON, shared — one credential authorizes all three projects, so it is held once to keep rotation to a single action
<code>sandbox</code>	<code>SCRIPT_ID</code>	Sandbox Apps Script project ID
<code>sandbox</code>	<code>DEPLOYMENT_ID</code>	Sandbox web app deployment ID
<code>pmsc-production</code>	<code>SCRIPT_ID</code>	PMSC production Apps Script project ID
<code>pmsc-production</code>	<code>DEPLOYMENT_ID</code>	PMSC production web app deployment ID
<code>fca-production</code>	<code>SCRIPT_ID</code>	FCA production Apps Script project ID
<code>fca-production</code>	<code>DEPLOYMENT_ID</code>	FCA production web app deployment ID

Note: this plan originally recommended the names GAS_SCRIPT_ID and
GAS_DEPLOYMENT_ID. The implementation used SCRIPT_ID and DEPLOYMENT_ID. The
GAS_ prefix added no disambiguation — these secrets are already scoped to a
GitHub Environment within an Apps-Script-only repository — and renaming now
would require recreating six secrets in three environments for a cosmetic
gain. The as-built names are recorded here as authoritative.

Because SCRIPT_ID and DEPLOYMENT_ID are environment-SPECIFIC, they must never
be set at repository level. A repository secret acts as a fallback for any
environment lacking its own copy, so a repo-level SCRIPT_ID would silently
cause every environment to deploy to one project while reporting success.
scripts/check-deploy-secrets.sh checks for exactly this condition.

### .clasp.json Handling
As-built: the committed .clasp.json is preserved and only its scriptId is
patched in CI, using jq. The original recommendation was to regenerate the
file wholesale as {"scriptId": ..., "rootDir": "."}, which is what the old
workflow did — and that discarded scriptExtensions, htmlExtensions,
jsonExtensions, filePushOrder and skipSubdirectories, so CI pushed under
different rules than a local push (issue #12). Patching a single key keeps CI
and local behavior identical.

The committed .clasp.json still points at PMSC production, which means a local
clasp push would target production. Tracked privately as a security advisory;
it is mitigated by Key Requirement #5 (no routine local push) rather than by
the file's contents.

## Testing and Validation
### Current Automated Test Status
Automated tests are not currently known to exist for FACT.

Until automated tests are added, validation is primarily:

code review;
local inspection;
manual Sandbox validation;
production smoke checks after approved deployment.
Recommended Local Validation
Before opening a pull request:
cd ~/code/FACT
git status
git diff

Review:

changed files;
syntax risk;
Apps Script compatibility;
accidental credential exposure;
accidental production identifier changes;
changes to OAuth scopes;
changes to deployment files;
user-visible behavior changes.

### Recommended Sandbox Validation Checklist
After deployment to Sandbox, validate:

 FACT web app loads successfully.
 User authentication/session behavior works as expected.
 Main dashboard loads.
 Existing task/action item records display correctly.
 User can create an action item in Sandbox.
 User can edit an action item in Sandbox.
 Workgroup assignment behavior works.
 Due dates and status fields behave correctly.
 Executive review or approval workflow works for a test item.
 Notes/comments/audit history work as expected.
 Notifications behave correctly in Sandbox, if enabled.
 Drive file/folder behavior works with test data.
 Calendar-related behavior works, if affected by the change.
 Reports or dashboards load, if affected by the change.
 No production data is modified during Sandbox validation.
 No unexpected OAuth consent or permission changes occur.
 Browser console does not show unexpected errors.
 Apps Script execution logs do not show unexpected errors.
 Section 508-sensitive UI changes are keyboard-accessible and readable.

### Recommended Automated Smoke Tests
Add lightweight tests or checks over time:

manifest validation for appsscript.json;
static scan for forbidden secrets or IDs;
syntax checking where feasible;
basic Apps Script-compatible linting;
smoke checklist encoded in PR template;
optional test harness for pure JavaScript business logic.

### Security and Privacy Guardrails
No secrets in source code
API keys, clasp tokens, Chat webhooks, deployment credentials, and service credentials must never be committed.

Use approved configuration stores
Environment-specific configuration should live in:

Google Apps Script Script Properties;
GitHub Repository Secrets;
GitHub Environment Secrets.
Protect Chat webhooks
Chat webhook URLs are secrets and must not be committed, logged, or pasted into prompts.

Protect API keys
CLO_GEMINI_KEY, CLO_USAi_KEY, USAI_API_KEY, and similar values are secrets.

Protect production identifiers
Script IDs and deployment IDs should be treated as environment configuration and moved to GitHub Secrets or GitHub Environments where feasible.

Review OAuth scope changes
Any appsscript.json scope change must receive explicit review.

Use Sandbox for validation
Do not test risky behavior directly in production.

Avoid sensitive prompt content
Do not paste sensitive FACT data into AI prompts unless explicitly approved and handled under applicable policy.

Preserve auditability
Use GitHub history, PR review, and GitHub Actions logs as the source of truth for changes and deployments.

### Required Script Properties
FACT uses numerous Google Apps Script Script Properties. Some may be outdated or unused. They should be audited before deletion or renaming.

Do not place property values in source code or documentation unless explicitly approved.
This table lists property names and expected purpose only.
Key	Purpose / Notes
<code>CHAT_WEBHOOK</code>	Google Chat incoming webhook for notifications. Secret.
<code>CLO_GEMINI_KEY</code>	Gemini API key or related AI integration key. Secret.
<code>CLO_USAi_KEY</code>	USAi-related key. Secret.
<code>DESTINATION_FOLDER_ID</code>	Destination/root Drive folder for generated or copied FACT files.
<code>GLOBAL_ID</code>	Global ID or counter value used by FACT.
<code>GROUP_EMAIL</code>	Workgroup or system group email used for notifications/reply-to behavior.
<code>ID_COUNTER</code>	Counter for generated IDs.
<code>LEAVE_CALENDAR_ID</code>	Calendar ID used by related scheduling/availability features, if still active.
<code>NOTIFCATION_CHAT_WEBHOOK</code>	Chat webhook property with apparent spelling typo. Audit before changing because code may depend on exact name. Secret.
<code>REPORT_LOGO_FILE_ID</code>	Drive file ID for report logo or branding.
<code>SYSTEM_EMAIL_ALIAS</code>	Authorized sender alias for system-generated email, if used.
<code>TEMPLATE_FOLDER_ID</code>	Drive folder containing templates.
<code>TODAY_WHITEBOARD_JSON</code>	JSON/configuration for today/whiteboard behavior, if still active.
<code>USAI_API_KEY</code>	USAi API key. Secret.
<code>USAI_BASE_URL</code>	USAi API base URL.
<code>USAI_DEFAULT_MODEL</code>	Default USAi model name/configuration.
<code>adminUserList</code>	Admin user list. May contain emails; treat as sensitive internal config.
<code>intakeLastChecked</code>	Timestamp or marker for intake polling.
<code>sharedUserList</code>	Shared user list. May contain emails; treat as sensitive internal config.

### Script Property Audit Recommendation
Create a follow-up issue or task to classify each Script Property as:
Classification	Meaning
Active required	Used by current production code
Active optional	Used only when feature is enabled
Environment-specific	Must differ by Sandbox/PMSC/FCA
Secret	Must never be logged or committed
Deprecated	No longer used but retained temporarily
Unknown	Requires code search and runtime validation

### Repository File Structure & Architecture Map
Current repository structure is root-based:
FACT/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── .clasp.json
├── appsscript.json
├── Code.js
├── FACT_Bootstrap.js
├── FACT_DataService.js
├── FACT_DocSignature.js
├── FACT_DriveService.js
├── FACT_Export.js
├── FACT_FcaSetup.js
├── FACT_Federation.js
├── FACT_IntakeUI.js
├── FACT_NotesLog.js
├── FACT_NotificationService.js
├── FACT_SandboxSetup.js
├── FACT_Workflow.js
├── FACT_WorkflowEngine.js
├── FACT_WorkflowEngine_backup.js
├── GuestPortal.html
├── Index.html
├── IntakeForm.html
├── Lib_ApprovalWorkflowBuilder.html
├── Lib_Chart.html
├── Lib_FullCalendar.html
├── Lib_Sortable.html
├── Lib_WorkflowBuilder.html
├── ReportBuilder.html
├── PROJECT_PLAN.md
└── docs/
    ├── docs_getting_started.md
    ├── docs_technical.md
    └── docs_user_guide.md

### Module Map
File	Purpose
<code>Code.js</code>	Main Apps Script entry point, web app routing, server-side functions.
<code>FACT_Bootstrap.js</code>	Setup/bootstrap logic, initialization, triggers, or environment preparation.
<code>FACT_DataService.js</code>	Google Sheets data access and CRUD service layer.
<code>FACT_DocSignature.js</code>	Document signature, watermark, or approval-document support.
<code>FACT_DriveService.js</code>	Google Drive folder/file operations and permissions.
<code>FACT_Export.js</code>	Export/report generation support.
<code>FACT_FcaSetup.js</code>	FCA-specific setup/provisioning logic.
<code>FACT_Federation.js</code>	Federation or hub-and-spoke coordination logic.
<code>FACT_IntakeUI.js</code>	Intake workflow/user interface support.
<code>FACT_NotesLog.js</code>	Notes, logging, audit trail, or history support.
<code>FACT_NotificationService.js</code>	Email, Chat, and notification dispatch.
<code>FACT_SandboxSetup.js</code>	Sandbox setup/provisioning logic.
<code>FACT_Workflow.js</code>	High-level workflow orchestration.
<code>FACT_WorkflowEngine.js</code>	Workflow engine logic for approvals/review/routing.
<code>FACT_WorkflowEngine_backup.js</code>	Backup/legacy workflow engine file. Review before modifying or deleting.
<code>Index.html</code>	Main FACT web application UI.
<code>GuestPortal.html</code>	Guest or limited-access portal UI.
<code>IntakeForm.html</code>	Intake form UI.
<code>ReportBuilder.html</code>	Reporting UI.
<code>Lib_ApprovalWorkflowBuilder.html</code>	Approval workflow builder UI/library.
<code>Lib_WorkflowBuilder.html</code>	Workflow builder UI/library.
<code>Lib_Chart.html</code>	Chart library wrapper/bundled client asset.
<code>Lib_FullCalendar.html</code>	FullCalendar library wrapper/bundled client asset.
<code>Lib_Sortable.html</code>	SortableJS library wrapper/bundled client asset.
<code>docs/docs_getting_started.md</code>	User/developer getting started documentation.
<code>docs/docs_technical.md</code>	Technical documentation.
<code>docs/docs_user_guide.md</code>	User guide.

## Deployment Governance Recommendations
The existing workflow is functional, but FACT should adopt a stronger deployment governance model.

### Recommended Near-Term Changes
Move script IDs and deployment IDs to secrets

Use GitHub Environment Secrets for Sandbox, PMSC production, and FCA production.
Keep workflow logic generic.
Configure GitHub Environments

sandbox
pmsc-production
fca-production
Require reviewers for production environments

Require explicit approval before production deployment jobs run.
Retire or de-emphasize dev

Prefer feature branches and PRs into sandbox.
Remove dev from deployment triggers after transition, if no longer needed.
Add branch protection

Protect main.
Require PR review.
Require successful checks.
Consider protecting sandbox as the validation branch.
Add PR template

Include testing, Sandbox validation, OAuth scope review, and deployment impact fields.
Add smoke checks

Start with documentation/checklist-based validation.
Add automated checks where feasible.

## Recommended Release Process
### Sandbox Release
Create feature branch from sandbox or current agreed base.
Make local changes in ~/code/FACT/.
Review in VS Code.
Review git diff.
Commit changes.
Push feature branch.
Open PR into sandbox.
Obtain review.
Merge into sandbox.
GitHub Actions deploys to Sandbox.
Complete Sandbox validation checklist.
Record validation results in the PR or release notes.
### Production Release
Confirm Sandbox validation is complete.
Open PR from sandbox to main, or otherwise promote the approved commit to main.
Review production impact.
Confirm no unreviewed OAuth scope, deployment, or Script Property changes.
Approve PR.
Merge to main.
GitHub Actions starts production deployment.
Required reviewers approve GitHub production environments.
GitHub Actions deploys to PMSC production and FCA production.
Run production smoke checks.
Document deployment outcome.

### Production Smoke Check
After production deployment:

 PMSC production web app loads.
 FCA production web app loads.
 Main dashboard loads.
 Existing records display.
 No immediate Apps Script runtime errors.
 Notifications are not misdirected.
 No Sandbox configuration appears in production.
 No production configuration appears in Sandbox.
 Critical workflow path still works.

### Rollback Guidance
If a production deployment causes issues:

Stop additional deployments.
Identify the merged PR or commit that introduced the issue.
Assess whether a configuration rollback or code rollback is appropriate.
Preferred rollback options:
revert the PR and redeploy through GitHub Actions;
redeploy a previously known-good commit through the approved GitHub Actions process;
use Apps Script deployment/version history only if needed and approved.
Validate rollback in Sandbox if time permits.
Deploy rollback to production through approved GitHub Actions path.
Run production smoke checks.
Document the incident, rollback commit, and follow-up actions.
Direct local clasp push should not be used for rollback except under explicit emergency approval and with documentation.

## Immediate Engineering Roadmap
Stabilize Existing Production Behavior

Prioritize regression prevention.
Avoid broad refactors.
Document known production-sensitive workflows.
Establish GitHub Actions Deployment Governance

Add GitHub Environments.
Require production reviewers.
Require checks before production deploy.
Move Deployment Identifiers to Secrets

Move script IDs and deployment IDs from inline workflow YAML to GitHub Secrets or GitHub Environment Secrets.
Keep .clasp.json dynamically generated in CI/CD.
Retire or Reduce Use of dev

Confirm whether dev is still needed.
Prefer feature branches and PRs into sandbox.
Remove dev from automatic deployment triggers after approval.
Create Manual Sandbox Validation Checklist

Add checklist to documentation and/or PR template.
Require completion before production promotion.
Add Automated Smoke Tests

Start with static checks and manifest validation.
Add unit tests for pure JavaScript logic where feasible.
Add CI checks that can run without Apps Script credentials.
Support FCA DAC Rollout

Validate FCA production environment configuration.
Confirm FCA-specific Script Properties, notifications, Drive folders, templates, groups, and permissions.
Ensure PMSC and FCA production do not cross-contaminate data or configuration.
Improve Executive Review Workflow

Stabilize review/approval flows.
Improve routing clarity.
Improve auditability and error handling.
Improve Reporting and Dashboarding

Improve executive visibility.
Validate report generation.
Ensure dashboards work across PMSC and FCA contexts.
Audit Script Properties

Identify active, deprecated, environment-specific, and secret properties.
Remove or retire unused properties only after review.