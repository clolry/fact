# FACT Application - Detailed User Guide

This guide is designed for Project Managers, Executive Officers, and daily users who need to fully leverage the FACT Application for managing operations, workflows, and team communications.

## 1. Deep Dive: Task & Project Management

### Creating New Tasks, Subtasks, and Projects
1. **From the UI:** Click the **"+ New Action Item"** or **"Intake Form"** button in the top navigation or sidebar.
2. Fill in the required fields such as Title, Description, Assignee, and Deadline.
3. Choose the type of item (Task, Subtask, or Project) depending on the scope of the work.

### Managing Statuses
- **Grid View:** This is the default view. To edit a task, click the link on the item's row to open the modal window. You cannot edit directly by double-clicking the grid row.
- **Kanban Board:** Drag and drop cards to update their status instantly.

### Using the Drive Picker for Approvals
FACT natively integrates with Google Drive. Documents intended for routing must be attached specifically via the Approval tab.
- Open the task or project details modal.
- Navigate to the **Approval** tab.
- Click the **"Attach File"** button. The Google Drive Picker will open, allowing you to select existing files from your My Drive or Shared Drives, or upload new files directly from your computer.

---

## 2. Dynamic Approval Workflows

FACT includes a robust engine for routing documents for approval across multiple stakeholders.

### Understanding Workflow Routing
When a document requires approval, a workflow is attached to it. A workflow consists of sequential steps (e.g., *Drafting -> Peer Review -> Division Director -> Executive Officer*).

### Workflow Initiation
1. A user submits a request via the Intake Form.
2. An administrator or designated reviewer reviews the pending intake in the system.
3. The reviewer initiates the workflow routing for that item.

### Acting as an Approver
When a task enters a step where you are assigned as an approver, you will receive an email notification.
- **Via Email:** You can click the **Approve** or **Decline** buttons directly in the email. This routes you to a secure confirmation page.
- **Via UI:** Open the **Approval Queue Page** from the navigation menu in the FACT app to review and approve or decline pending documents assigned to you. 

> [!WARNING]
> If you decline an approval, you *must* provide comments explaining why it is being returned. The task will be sent back to the original requester.

### Tracking Approval Progress
- Open any task and navigate to the **Approval** tab.
- You will see a timeline of who has approved it, when they approved it, and who is currently holding up the process.

---

## 3. Automated Reporting

FACT automates status reporting to keep stakeholders informed without manual data entry.

### Time-Driven Reports
- **Daily Digest (7 AM):** An automated summary of overdue tasks and pending approvals is compiled and emailed to the executive team every morning.
- **Deadline Reminders (6 AM):** Users with tasks due within the next 48 hours will receive automated reminder emails.

### Accessing the Report Builder (Admin/Exec Only)
1. Go to the **Reports** section via the sidebar.
2. The Report Builder allows you to generate custom views (e.g., "All tasks completed last week by User X").
3. You can export these reports directly to Google Docs or Google Sheets for further analysis or archiving.

---

## 4. System Settings & Administration

For those with Admin or Executive Coordinator access, FACT provides a robust settings panel to configure the system.

### Configuring User Permissions
1. Navigate to **System Settings**.
2. Go to the **Access Management** tab.
3. You can add or remove users by their `@gsa.gov` email address and assign them roles:
   - **Admin:** Full access to all data, settings, and workflows.
   - **Executive:** View-only access to all data and reports, plus approval rights.
   - **User/Guest:** Can only see their assigned tasks.

### Global System Settings
- **Default Workgroups:** Set the default name for your workspace (e.g., "PMSC" or "FCA").
- **Workflow Templates:** Build and modify default routing templates that can be applied to new intake forms automatically.
- **Email Configurations:** Update the default text or branding for automated email notifications.

> [!CAUTION]
> Changing workflow templates will not affect tasks currently in-flight, but will apply to all new tasks created moving forward. Ensure your team is aware of process changes before updating these settings.
