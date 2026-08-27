/**
 * One-Click Setup Script for FCA Environment
 * Run `initializeFcaSheet()` from the Apps Script editor to provision all required tabs.
 */
function initializeFcaSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const createSheet = (name, headers) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (headers && headers.length > 0) {
        sheet.appendRow(headers);
        // Freeze header row and make it bold
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f3f3");
      }
    }
  };

  createSheet('Projects', ['ID', 'Title', 'Type', 'Owner', 'StartDate', 'DueDate', 'Status', 'Description', 'ExecStatus', 'Complexity', 'Urgency', 'ThreadID', 'DriveLink', 'FolderID', 'Col15', 'Col16', 'Col17', 'Col18', 'Col19', 'Col20', 'Col21', 'Col22', 'Col23', 'Col24', 'Col25', 'Col26', 'Col27', 'Col28', 'Col29', 'Archived', 'Rank', 'CompletedDate', 'StatusSummary', 'Assigned', 'NotificationSchedule']);
  
  createSheet('Tasks', ['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Complexity', 'Urgency', 'ExecStatus', 'ThreadID', 'DriveLink', 'FolderID', 'RecDate', 'IntDue', 'DataCallNo', 'Requestor', 'Rank', 'CompletedDate', 'Archived', 'StatusSummary', 'Assigned', 'NotificationSchedule', 'WorkflowStep', 'ApprovalType', 'PriorApprover', 'Background', 'FCA_Approval', 'FCA_Notes', 'FCB_Approval', 'FCB_Notes', 'FCC_Approval', 'FCC_Notes', 'AC_Approval', 'AC_Notes', 'Primary_Doc_ID']);
  
  createSheet('Sub_Tasks', ['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Rank', 'Assigned']);
  
  createSheet('Notes', ['Note ID', 'Project ID', 'Timestamp', 'Author', 'Note Text']);
  
  createSheet('Intake_Queue', ['Timestamp', 'Requestor', 'Title', 'Final_Deliverable_Link', 'Type', 'DueDate', 'Description', 'Supporting_Links', 'Status', 'Required_Approver_Role']);
  
  createSheet('Workflow_Templates', ['Template_ID', 'Name', 'Applies_To', 'Steps_JSON', 'Scope']);
  
  createSheet('Approval_Tracking', ['Task_ID', 'Step_Number', 'Step_Name', 'Action', 'Actor_Email', 'Timestamp', 'Comments', 'File_ID', 'Approval_ID']);
  
  createSheet('Stakeholders', ['Email', 'Name', 'Role', 'Org', 'Registered_Date']);
  
  createSheet('Drive_Config', ['Type', 'Base_Folder_ID', 'Template_Folder_ID']);
  
  createSheet('Team_Log', ['Timestamp', 'Email', 'LocalTime', 'Status', 'Yesterday', 'Today', 'Blocker']);
  
  createSheet('Recurring_Templates', ['Template_ID', 'Title', 'Type', 'Cron_Schedule', 'Status']);
  
  createSheet('Type_Templates', ['Template_ID', 'Type_Name', 'Default_Complexity', 'Default_Urgency']);
  
  createSheet('Report_Templates', ['ID', 'Name', 'Config_JSON', 'Schedule', 'Recipients']);

  createSheet('Activity_Log', ['Timestamp', 'User', 'Action', 'Item_ID', 'Details']);

  createSheet('Icebreakers', ['Question', 'Date_Used']);
  
  createSheet('Daily_Brief', ['Date', 'Tip', 'Strategy', 'Fact', 'History', 'Chuckle']);

  createSheet('Projects_Archive', ['ID', 'Title', 'Type', 'Owner', 'StartDate', 'DueDate', 'Status', 'Description', 'ExecStatus', 'Complexity', 'Urgency', 'ThreadID', 'DriveLink', 'FolderID', 'Col15', 'Col16', 'Col17', 'Col18', 'Col19', 'Col20', 'Col21', 'Col22', 'Col23', 'Col24', 'Col25', 'Col26', 'Col27', 'Col28', 'Col29', 'Archived', 'Rank', 'CompletedDate', 'StatusSummary', 'Assigned', 'NotificationSchedule']);
  
  createSheet('Tasks_Archive', ['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Complexity', 'Urgency', 'ExecStatus', 'ThreadID', 'DriveLink', 'FolderID', 'RecDate', 'IntDue', 'DataCallNo', 'Requestor', 'Rank', 'CompletedDate', 'Archived', 'StatusSummary', 'Assigned', 'NotificationSchedule', 'WorkflowStep', 'ApprovalType', 'PriorApprover', 'Background', 'FCA_Approval', 'FCA_Notes', 'FCB_Approval', 'FCB_Notes', 'FCC_Approval', 'FCC_Notes', 'AC_Approval', 'AC_Notes', 'Primary_Doc_ID']);
  
  createSheet('Sub_Tasks_Archive', ['ID', 'Title', 'Type', 'ParentID', 'Owner', 'DueDate', 'Status', 'Description', 'Rank', 'Assigned']);

  createSheet('Config', ['Setting', 'Value', 'Types', 'Stages', 'Execs', 'Admins', 'Approver Roles']);
  
  const configData = [
    ['System Title', 'FCA Production System', 'Project', 'Backlog', 'Routing', 'christopher.olry@gsa.gov', 'AC'],
    ['Workgroup Name', 'FCA', 'Task', 'To Do', 'Pending Approval', 'ozel.kirkland@gsa.gov', 'DAC'],
    ['Org Code', 'FCA', 'Data Call', 'In Progress', 'Approved', '', 'Branch Chief'],
    ['ID Prefix', 'FCA', '', 'Blocked', 'Closed', '', 'Peer'],
    ['', '', '', 'Done', 'Draft', '', ''],
    ['', '', '', 'Cancelled', '', '', '']
  ];
  const configSheet = ss.getSheetByName('Config');
  configSheet.getRange(2, 1, configData.length, configData[0].length).setValues(configData);

  // Delete default Sheet1
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);
}
