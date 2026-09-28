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