// ==========================================
// SANDBOX HUB-AND-SPOKE SETUP UTILITY
// ==========================================

/**
 * Initializes the required Spoke tabs on the ACTIVE spreadsheet.
 * Run this from the Apps Script editor of a new Spoke project.
 */
function initializeSpokeTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log(`Initializing Spoke tabs for: ${ss.getName()}`);

  if (!ss.getSheetByName('Tasks')) {
    const tasksSheet = ss.insertSheet('Tasks');
    tasksSheet.appendRow(['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Complexity', 'Urgency', 'WorkflowStep', 'ThreadID', 'DriveLink', 'FolderID', 'RecDate', 'IntDue', 'DataCallNo', 'Requestor', 'Rank', 'CompletedDate', 'Archived', 'StatusSummary', 'Assigned', 'NotificationSchedule', 'ApprovalType', 'PriorApprover', 'Background', 'OrgCode', 'Primary_Doc_ID']);
  }

  if (!ss.getSheetByName('Intake_Queue')) {
    const intakeSheet = ss.insertSheet('Intake_Queue');
    intakeSheet.appendRow(['Timestamp', 'Requestor', 'Title', 'Final_Deliverable_Link', 'Type', 'DueDate', 'Description', 'Supporting_Links', 'Status', 'Required_Approver_Role']);
  }

  if (!ss.getSheetByName('Workflow_Templates')) {
    const wfTemplateSheet = ss.insertSheet('Workflow_Templates');
    wfTemplateSheet.appendRow(['Template_ID', 'Name', 'Applies_To', 'Steps_JSON', 'Scope']);
    const localTemplates = [
        ['LOCAL-1', 'Internal Workgroup Review', 'Project, Task', JSON.stringify([{step: 1, role: "Peer Review", type: "Sequential", approvers: [""], status: "Pending"}]), 'Local']
    ];
    wfTemplateSheet.getRange(2, 1, 1, 5).setValues(localTemplates);
  }

  if (!ss.getSheetByName('Approval_Tracking')) {
    const trackingSheet = ss.insertSheet('Approval_Tracking');
    trackingSheet.appendRow(['Task_ID', 'Step_Number', 'Step_Name', 'Action', 'Actor_Email', 'Timestamp', 'Comments', 'File_ID', 'Approval_ID']);
  }

  if (!ss.getSheetByName('Config')) {
    const configSheet = ss.insertSheet('Config');
    configSheet.appendRow(['Setting', 'Value', 'Types', 'Stages', 'Execs', 'Admins', 'Approver Roles', 'Reports Folder ID']);
    configSheet.appendRow(['System Title', 'FACT System', 'Project', 'Backlog', 'Director Review', 'christopher.olry@gsa.gov', 'AC', '']);
    configSheet.appendRow(['Workgroup Name', 'Workgroup', 'Task', 'To Do', 'Legal', 'ozel.kirkland@gsa.gov', 'DAC-A', '']);
    configSheet.appendRow(['Org Code', 'FC', 'Data Call', 'In Progress', 'Final Approval', '', 'Office Director', '']);
    configSheet.appendRow(['ID Prefix', 'ITEM', '', 'Blocked', '', '', 'Branch Chief', '']);
    configSheet.appendRow(['', '', '', 'Done', '', '', '', '']);
    configSheet.appendRow(['', '', '', 'Cancelled', '', '', '', '']);
  }

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);

  console.log("Spoke initialization complete!");
}

/**
 * Initializes the required Hub tabs on the ACTIVE spreadsheet.
 * Run this from the Apps Script editor of a new Hub project.
 */
function initializeHubTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  console.log(`Initializing Hub tabs for: ${ss.getName()}`);

  if (!ss.getSheetByName('Org_Registry')) {
    const registrySheet = ss.insertSheet('Org_Registry');
    registrySheet.appendRow(['OrgCode', 'OrgName', 'ParentOrg', 'Spoke_SS_ID']);
  }

  if (!ss.getSheetByName('Cross_Org_Items')) {
    const crossOrgSheet = ss.insertSheet('Cross_Org_Items');
    crossOrgSheet.appendRow(['Item_ID', 'Title', 'Spoke_ID', 'Status', 'WorkflowStep', 'Owner', 'OrgCode', 'Last_Sync']);
  }

  if (!ss.getSheetByName('Workflow_Templates')) {
    const wfTemplateSheetMaster = ss.insertSheet('Workflow_Templates');
    wfTemplateSheetMaster.appendRow(['Template_ID', 'Name', 'Applies_To', 'Steps_JSON', 'Scope']);
    const globalTemplates = [
        ['GLOBAL-1', 'Standard Data Call Review', 'Data Call', JSON.stringify([{step: 1, role: "Initial Review", type: "Sequential", approvers: [""], status: "Pending"}]), 'Global'],
        ['GLOBAL-2', 'Congressional Inquiry', 'Congressional Inquiry', JSON.stringify([{step: 1, role: "Branch Chief Review", type: "Sequential", approvers: [""], status: "Pending"}, {step: 2, role: "Final DAC Review", type: "Sequential", approvers: [""], status: "Future"}]), 'Global']
    ];
    wfTemplateSheetMaster.getRange(2, 1, 2, 5).setValues(globalTemplates);
  }

  if (!ss.getSheetByName('Approval_Tracking')) {
    const trackingSheetMaster = ss.insertSheet('Approval_Tracking');
    trackingSheetMaster.appendRow(['Task_ID', 'Step_Number', 'Step_Name', 'Action', 'Actor_Email', 'Timestamp', 'Comments']);
  }

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);

  // Output the Master ID so they can set it in the spokes
  console.log(`Hub initialization complete! Your MASTER_SS_ID is: ${ss.getId()}`);
}

/**
 * Installs time-driven triggers programmatically.
 * Can be called from a deployment script or admin UI.
 */
function setupTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  
  // 1. Process Workflow Deadlines (Hourly)
  let foundDeadlines = triggers.find(t => t.getHandlerFunction() === 'processWorkflowDeadlines');
  if (!foundDeadlines) {
    ScriptApp.newTrigger('processWorkflowDeadlines')
             .timeBased()
             .everyHours(1)
             .create();
    console.log("Trigger for processWorkflowDeadlines installed successfully.");
  }
  
  // 2. Daily Reminders (8:15 AM)
  let foundReminders = triggers.find(t => t.getHandlerFunction() === 'sendInternalDueReminders_');
  if (!foundReminders) {
    ScriptApp.newTrigger('sendInternalDueReminders_')
             .timeBased()
             .atHour(8)
             .nearMinute(15)
             .everyDays(1)
             .create();
    console.log("Trigger for sendInternalDueReminders_ installed successfully.");
  }

  // 3. Process Group Emails (Every 10 minutes)
  let foundEmails = triggers.find(t => t.getHandlerFunction() === 'processGroupEmails');
  if (!foundEmails) {
    ScriptApp.newTrigger('processGroupEmails')
             .timeBased()
             .everyMinutes(10)
             .create();
    console.log("Trigger for processGroupEmails installed successfully.");
  }
}
