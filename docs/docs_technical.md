# FACT Application - System & Technical Documentation

This document serves as the technical reference for developers, IT administrators, and maintainers of the FACT application. It outlines the architecture, data structures, and deployment pipelines.

## 1. System Architecture Overview

FACT is built entirely within the Google Workspace ecosystem to ensure maximum security, native integration, and zero external hosting costs.

- **Frontend:** A Single Page Application (SPA) built with HTML, CSS, and Vanilla JavaScript, adhering to Material Design principles. It runs securely within an iframe via the GAS `HtmlService`.
- **Backend:** Google Apps Script (V8 Engine) acts as the serverless backend, handling API requests via `google.script.run`.
- **Database:** A standard Google Spreadsheet acts as the primary data store, using specific sheets as tables.
- **File Storage:** Native integration with Google Drive via the Drive API and Google Picker API.

---

## 2. Data Model (Google Sheets Schema)

The backend relies on a Google Spreadsheet bound to the script (or referenced by ID). The core sheets acting as tables include:

### `Tasks` / `Sub_Tasks` / `Projects`
- **Primary Key:** Unique ID (e.g., TSK-1001).
- **Core Columns:** Title, Description, Assignee, Status, Deadline.
- **Workflow Columns:** `WorkflowStep` (JSON string defining the active routing).

### `Settings` (Optional/Hidden)
- Stores JSON configurations for global variables (e.g., dropdown options, default branding).

---

## 3. Key Backend Modules

The codebase is modularized into several key `.js` files for maintainability:

- **`Code.js`**: The main entry point. Contains `doGet(e)` for routing the web app, handling URL parameters (like `?page=reports` or `?page=action`), and processing email approval callbacks.
- **`FACT_DataService.js`**: Abstraction layer for interacting with the Google Sheet. Handles reading, writing, and querying rows.
- **`FACT_WorkflowEngine.js`**: The core logic for the dynamic approval workflows. It parses the JSON workflow definitions, determines the active step, and triggers emails.
- **`FACT_DriveService.js`**: Handles authentication and backend processing for the Google Drive Picker and file attachments.
- **`FACT_NotificationService.js`**: Centralized module for formatting and sending HTML emails (e.g., approval requests, deadline reminders).

---

## 4. Background Triggers & Automation

FACT relies on Google Apps Script Time-Driven Triggers to handle background processing without user interaction.

- **Deadline Reminders:** `sendDueDateReminders()` (`FACT_NotesLog.js`) scans the `Tasks`, `Projects`, and `Sub_Tasks` sheets for approaching deadlines and dispatches reminders via `FACT_NotificationService.js`. Registered at 8 AM by `FACT_FcaSetup.js`. Two alias shims, `sendInternalDueReminders_` and `processWorkflowDeadlines`, forward to the same function so pre-existing triggers created under those names continue to work.
- **Scheduled Reports:** `runScheduledReports()` (`FACT_NotesLog.js`) checks each report template's `nextRun` date and generates any that are due.
- **Group Email Intake:** `processGroupEmails()` (`FACT_NotesLog.js`) polls the group mailbox every 10 minutes and converts messages into items.
- **Recurring Tasks:** `generateRecurringTasks()` (`FACT_Workflow.js`).
- **Auto-Archive:** `autoArchiveDoneItems()` (`FACT_IntakeUI.js`).

> [!NOTE]
> There is **no daily digest**. Earlier versions of this document and the user
> guide described a `generateDailyDigest()` running at 7 AM; no such function
> has ever existed in the codebase. The claim was removed rather than
> implemented — the approval dashboard already surfaces pending approvals per
> user (`renderApprovalQueue()` in `Index.html`), so a second notification
> channel was judged unnecessary. See issue #31.

> [!WARNING]
> If the script is redeployed or copied, these triggers must be manually re-initialized by an Admin running the setup function in the GAS editor.

---

## 5. CI/CD Pipeline & Environments

The codebase is version-controlled via GitHub (`clolry/fact`) and deployed using GitHub Actions combined with `clasp` (Command Line Apps Script Projects).

### Environments
We maintain three active environments:
1. **PMSC Production:** Main operating environment for PMSC.
2. **FCA Production:** Main operating environment for FCA.
3. **Sandbox:** Staging environment for testing new features safely.

Each environment's Apps Script project ID and web app deployment ID are held as
GitHub **Environment Secrets** (`SCRIPT_ID`, `DEPLOYMENT_ID`) and are
deliberately not reproduced here — this repository is public. To read the
current target of an environment you need repository admin; run
`sh scripts/check-deploy-secrets.sh`, which reports secret *names* and
resolution only (values are not retrievable through the GitHub API).

> [!NOTE]
> These identifiers were previously published in this document and in workflow
> source, so they remain in public git history and cannot be retracted.
> Removing them here limits further exposure; it does not undo the prior
> disclosure. Access to the web apps rests on `"access": "DOMAIN"` plus the
> in-code email authorization checks in `Code.js` — never on identifier
> secrecy. See `docs/adr/0002-deployment-hardening.md`.

### Deployment Workflow
The `.github/workflows/deploy.yml` handles automated deployments. A separate
`verify.yml` runs `scripts/check.sh` on pull requests; it holds no secrets and
cannot deploy.

- **`sandbox` branch pushes:** Automatically deploy to the Sandbox environment.
  No approval required — this is the default validation target.
- **`main` branch pushes:** Deploy to PMSC Production and then FCA Production as
  **separate jobs, each gated on human approval.** The run pauses in the
  Actions tab until a reviewer approves that environment. FCA `needs:` PMSC, so
  a PMSC failure leaves both production environments on the previous version.

The `dev` branch no longer triggers any deployment (issue #13).

> [!IMPORTANT]
> `prevent_self_review` is enabled on both production environments, so whoever
> merges to `main` **cannot** approve the resulting deployment. A production
> release requires the other developer. Merging and finding no approve button is
> the control working, not a fault. See `AGENTS.md` §2 and §7.2 for the approval
> and post-deploy verification steps.

> [!CAUTION]
> Never edit the code directly in the GAS Editor in the browser. Always pull to your local machine, make edits, and push via git to trigger the CI/CD pipeline. Direct edits in the browser will be overwritten by the next GitHub Action deployment.

> [!CAUTION]
> A green Actions run means `clasp push` and `clasp deploy` exited zero — not
> that the application works. Walk the Sandbox Validation Checklist in
> `PROJECT_PLAN.md` before treating a deploy as verified.

---

## 6. Security & Access Levels

FACT implements a role-based access control (RBAC) system verified against the active Google session (`Session.getActiveUser().getEmail()`).

- **Authentication:** Handled natively by Google Workspace. Users must be logged into a valid `@gsa.gov` account.
- **Authorization:** `Code.js` checks the user's email against an Admin/Exec list before rendering specific pages or returning data.
- **Data Exposure:** The SPA only receives data from the backend that the user is authorized to view. The raw Google Sheet should be restricted to "View Only" or completely hidden from end-users to prevent direct data tampering.

### Document Access During Approval Routing

When an item with a `Primary_Doc_ID` is routed for approval,
`shareDocWithParticipants_` (`FACT_WorkflowEngine.js`) grants **editor
(`writer`)** access on that document to every participant in the chain — the
owner, the assigned user, each step's approvers, and **FYI / awareness
recipients**.

**FYI recipients receiving editor rather than commenter access is an
intentional decision, not an oversight.** All participants are already
authorized on the item, the access level matches the folder sharing already
applied at record save, and a uniform level avoids a second class of
permission to reason about. Anyone tempted to "tighten" FYI access to
commenter should treat that as a behavior change requiring its own decision,
not a cleanup.

Sharing is attempted at five points — workflow start, step activation,
delegation, delayed start, and admin reminder — because an approver can first
become relevant at any of them (a delegate, in particular, is unknown until an
admin reassigns). It runs **before** each email so an Approve button never
arrives ahead of access.

Sharing failure is **non-fatal by design**: the document may be owned outside
the organization or sit on a Shared Drive the deploying account cannot
administer, and that must not block an approval. On failure a note is written
to the item naming who still lacks access.

