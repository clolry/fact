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
        ['LOCAL-1', 'Internal Workgroup Review', 'Project, Task', JSON.stringify([{stepNumber: 1, name: "Peer Review", type: "sequential", approvers: [{role: "Peer", resolveBy: "assigned"}], requiredToAdvance: "all"}]), 'Local']
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
        ['GLOBAL-1', 'Standard Data Call Review', 'Data Call', JSON.stringify([{stepNumber: 1, name: "Initial Review", type: "sequential", approvers: [{role: "SME", resolveBy: "assigned"}], requiredToAdvance: "all"}]), 'Global'],
        ['GLOBAL-2', 'Congressional Inquiry', 'Congressional Inquiry', JSON.stringify([{stepNumber: 1, name: "Branch Chief Review", type: "sequential", approvers: [{role: "Branch Chief", resolveBy: "org_lookup"}], requiredToAdvance: "all"}, {stepNumber: 2, name: "Final DAC Review", type: "sequential", approvers: [{role: "DAC", resolveBy: "org_lookup"}], requiredToAdvance: "all"}]), 'Global']
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
}

/**
 * Generates sample demo data for Executive Training in the Sandbox environment.
 * Run this function from the Sandbox Apps Script editor.
 */
function generateDemoData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tasksSheet = ss.getSheetByName('Tasks');
  
  if (!tasksSheet) {
    console.error("Tasks sheet not found!");
    return;
  }
  
  // Format: ['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Complexity', 'Urgency', 'WorkflowStep', 'ThreadID', 'DriveLink', 'FolderID', 'RecDate', 'IntDue', 'DataCallNo', 'Requestor', 'Rank', 'CompletedDate', 'Archived', 'StatusSummary', 'Assigned', 'NotificationSchedule', 'ApprovalType', 'PriorApprover', 'Background', 'OrgCode', 'Primary_Doc_ID']
  
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);
  
  // Demo Row 1: A task in progress
  const row1 = ['DEMO-001', 'Draft Quarterly Report', 'Task', '', 'Jane Doe', nextWeek.toISOString(), 'In Progress', 'Drafting the Q3 metrics report for the executive team.', 'Medium', 'Medium', '', '', '', '', today.toISOString(), nextWeek.toISOString(), '', 'Leadership', '1', '', '', 'On Track', 'Jane Doe', '', '', '', '', 'FCA', ''];
  
  // Demo Row 2: A task pending approval (requires executive action)
  const row2 = ['DEMO-002', 'Strategic Plan Realignment', 'Project', '', 'John Smith', tomorrow.toISOString(), 'Pending Review', 'Awaiting final approval from the Executive Officer.', 'High', 'High', 'Executive Approval', '', '', '', today.toISOString(), tomorrow.toISOString(), '', 'Planning Office', '2', '', '', 'Action Needed', 'Executive Officer', '', 'Document Approval', '', 'Pending final sign-off.', 'FCA', ''];
  
  // Demo Row 3: A standard task in the backlog
  const row3 = ['DEMO-003', 'Update Staff Roster', 'Task', '', 'Alice Admin', nextWeek.toISOString(), 'To Do', 'Ensure all new hires from September are included.', 'Low', 'Low', '', '', '', '', today.toISOString(), nextWeek.toISOString(), '', 'HR', '3', '', '', 'Not Started', 'Alice Admin', '', '', '', '', 'FCA', ''];
  
  tasksSheet.appendRow(row1);
  tasksSheet.appendRow(row2);
  tasksSheet.appendRow(row3);
  
  console.log("Demo data generated successfully! 3 tasks added to the Tasks sheet.");
}
