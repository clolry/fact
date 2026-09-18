/**
 * PMSC MASTER CODE
 * Entry point for Web App, Menus, and Triggers.
 */

// --- CONFIGURATION ---
const SHEET_TASKS = 'Tasks';
const SHEET_TEAM = 'Team_Log';
const CHAT_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK'); 
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('CLO_GEMINI_KEY');

// ==========================================
// 1. WEB APP ENTRY POINT
// ==========================================
function doGet(e) {
    if (e.parameter.debug === '1') {
        const out = debugKanban();
        return HtmlService.createHtmlOutput('<pre>' + JSON.stringify(out, null, 2) + '</pre>');
    }
  const accessLevel = getAccessLevel_();
  return routeRequest_(e, accessLevel);
}

function routeRequest_(e, accessLevel) {
  const config = loadConfig_();
  const wg = config.workgroupName || "PMSC";
  
  // Handle page parameter routes first
  if (e && e.parameter && e.parameter.page) {

    if (e.parameter.page === 'reports') {
      return (accessLevel === 'ADMIN')
        ? HtmlService.createHtmlOutputFromFile('ReportBuilder')
            .setTitle(`${wg} Report Builder`)
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        : HtmlService.createHtmlOutput(
            '<h1>Access Denied</h1><p>Admin access required.</p>'
          );
    }

    if (e.parameter.page === 'action') {
      const itemId = e.parameter.id;
      const action = e.parameter.action; // 'Approve' or 'Decline'
      if (!itemId || !action) return HtmlService.createHtmlOutput('<h1>Error</h1><p>Missing parameters.</p>');
      
      try {
          // Verify that this user is actually an approver for the active step
          const ss = SpreadsheetApp.getActiveSpreadsheet();
          let sheet, data, headers, wfCol, foundRow;
          let itemTitle = itemId;
          for (const sName of ['Tasks', 'Projects', 'Sub_Tasks']) {
              sheet = ss.getSheetByName(sName);
              if (!sheet) continue;
              data = sheet.getDataRange().getValues();
              headers = data[0];
              wfCol = headers.indexOf('WorkflowStep');
              const titleCol = headers.indexOf('Title');
              if (wfCol < 0) continue;
              
              const row = data.find(r => String(r[0]) === String(itemId));
              if (row) {
                foundRow = row;
                if (titleCol >= 0) itemTitle = row[titleCol] || itemId;
                break;
              }
          }
          
          if (!foundRow) return HtmlService.createHtmlOutput('<h1>Error</h1><p>Item not found.</p>');
          const wfStr = foundRow[wfCol];
          if (!wfStr || (!wfStr.startsWith('[') && !wfStr.startsWith('{'))) return HtmlService.createHtmlOutput('<h1>Error</h1><p>Workflow not active for this item.</p>');
          
          const parsed = JSON.parse(wfStr);
          const steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
          const activeStep = steps.find(s => s.status === 'Pending');
          
          const extractEmail = (str) => {
              const match = str.match(/<([^>]+)>/);
              return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
          };
          const userEmail = extractEmail((e.parameter.u || Session.getActiveUser().getEmail() || ''));
          
          if (activeStep) {
              const activeApprovers = (activeStep.approvers || []).map(extractEmail);
              if (activeApprovers.includes(userEmail)) {
                  const approvedByEmails = (activeStep.approvedBy || []).map(extractEmail);
                  if (approvedByEmails.includes(userEmail)) {
                      return HtmlService.createHtmlOutput('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h2>Action Already Recorded</h2><p>You have already approved this step of the workflow.</p></div>');
                  }
              } else {
                  // User is not an active approver. Did they complete a previous step?
                  const userSteps = steps.filter(s => s.approvers.map(extractEmail).includes(userEmail));
                  if (userSteps.length > 0) {
                      const allCompleted = userSteps.every(s => s.status === 'Approved' || s.status === 'FYI_Complete' || s.status === 'Declined' || s.status === 'Returned');
                      if (allCompleted) {
                          return HtmlService.createHtmlOutput('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h2>Workflow Step Already Completed</h2><p>Your action for this workflow step has already been completed and recorded.</p></div>');
                      }
                  }
                  return HtmlService.createHtmlOutput('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h2>Access Denied</h2><p>You are not authorized to take action on the current active step of this workflow.</p></div>');
              }
          } else {
              // No active step. Did they complete a previous step?
              const userSteps = steps.filter(s => s.approvers.map(extractEmail).includes(userEmail));
              if (userSteps.length > 0) {
                  return HtmlService.createHtmlOutput('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h2>Workflow Already Completed</h2><p>This approval routing workflow has already been completed.</p></div>');
              }
              return HtmlService.createHtmlOutput('<div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;"><h2>Error</h2><p>No active workflow step pending approval.</p></div>');
          }
          
          // Generate the routing timeline HTML for display
          const timelineHtml = (typeof generateRoutingTimelineHtml_ === 'function')
              ? generateRoutingTimelineHtml_(steps)
              : '';
          
          const color = action === 'Approve' ? '#0f9d58' : '#d93025';
          return HtmlService.createHtmlOutput(`
             <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 30px auto; padding: 0 20px;">
                <h2 style="color: ${color};">Confirm ${action}</h2>
                <p><strong>Item:</strong> ${itemId} - ${itemTitle}</p>
                <p><strong>Your Role:</strong> ${activeStep.role || 'Approver'}</p>
                
                ${timelineHtml ? `<h3 style="margin-top:20px; color:#333;">Approval Routing Status:</h3>${timelineHtml}` : ''}
                
                <div style="margin-top: 20px;">
                  <label style="font-weight:600;">Comments (required for Decline, optional for Approve):</label><br><br>
                  <textarea id="notes" placeholder="Enter comments..." style="width: 100%; box-sizing:border-box; height: 100px; padding: 10px; border-radius: 4px; border: 1px solid #ccc; font-family: inherit; font-size:0.95em;"></textarea>
                </div>
                <br>
                <div style="display: flex; gap: 10px;">
                    <button id="btn-cancel" onclick="cancelAction()" style="padding: 10px 20px; font-size: 15px; background-color: #f1f3f4; color: #3c4043; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-weight: bold;">Cancel</button>
                    <button id="btn" onclick="submitAction()" style="padding: 10px 20px; font-size: 15px; background-color: ${color}; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Confirm ${action}</button>
                </div>
                <div id="msg" style="margin-top: 20px;"></div>
                
                <script>
                  function cancelAction() {
                      document.getElementById('msg').innerHTML = '<h3 style="color: #666">Action Cancelled. You may close this window.</h3>';
                      document.getElementById('notes').style.display = 'none';
                      document.getElementById('btn').style.display = 'none';
                      document.getElementById('btn-cancel').style.display = 'none';
                  }
                  function submitAction() {
                      document.getElementById('btn').disabled = true;
                      document.getElementById('btn-cancel').style.display = 'none';
                      document.getElementById('msg').innerHTML = '<span style="color:#666;">Processing... please wait.</span>';
                      const notes = document.getElementById('notes').value;
                      google.script.run.withSuccessHandler(function(res) {
                          if (res.success) {
                              document.getElementById('msg').innerHTML = '<h3 style="color: ${color}">Success! Your response has been recorded. You may close this window.</h3>';
                              document.getElementById('notes').style.display = 'none';
                              document.getElementById('btn').style.display = 'none';
                          } else {
                              document.getElementById('msg').innerHTML = '<p style="color: red">Error: ' + res.error + '</p>';
                              document.getElementById('btn').disabled = false;
                          }
                      }).processEmailAction('${itemId}', '${action}', notes, '${e.parameter.u || ''}');
                  }
                <\/script>
             </div>
          `);
      } catch(err) {
          return HtmlService.createHtmlOutput('<h1>Error processing action</h1><p>' + err.message + '</p>');
      }
    }

    if (e.parameter.page === 'guestportal') {
      if (accessLevel === 'ADMIN' || accessLevel === 'GUEST') {
        const template = HtmlService.createTemplateFromFile('GuestPortal');
        template.requestedTask = e && e.parameter && e.parameter.id ? e.parameter.id : '';
        return template.evaluate()
            .setTitle(`${wg} Action Status Portal`)
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      } else {
        return HtmlService.createHtmlOutput('<h1>Access Denied</h1>');
      }
    }

    if (e.parameter.page === 'intakeform') {
      return HtmlService.createHtmlOutputFromFile('IntakeForm')
        .setTitle('New Action Item');
    }
  }

  // Main page — served when no page parameter matches
  if (accessLevel === 'ADMIN' || accessLevel === 'EXECUTIVE' || accessLevel === 'EXEC_COORD') {
    const template = HtmlService.createTemplateFromFile('Index');
    template.workgroup = wg;
    template.sidebarConfig = config.sidebarConfig || '[]';
    template.accessLevel = accessLevel;
    template.requestedTask = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : '';
    template.requestedTab = (e && e.parameter && e.parameter.tab) ? String(e.parameter.tab).trim() : '';
    return template.evaluate()
      .setTitle(`${wg} Kanban Board`);
  } else if (accessLevel === 'GUEST') {
    const template = HtmlService.createTemplateFromFile('GuestPortal');
    template.requestedTask = e && e.parameter && e.parameter.id ? e.parameter.id : '';
    return template.evaluate()
      .setTitle(`${wg} Action Status Portal`)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } else {
    return HtmlService.createHtmlOutput(
      '<h1>Access Denied</h1><p>You do not have permission to access this application.</p>'
    );
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 2. MENU SETUP (Fixed Function Names)
// ==========================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('PMSC Tools')
    .addItem('⚡ Generate Sub-Tasks (Selected Row)', 'generateSubTasks')
    .addSeparator()
    .addItem('✅ Process Intake Row', 'processIntakeRow')
    .addSeparator()
    .addItem('💬 Test Chat Connection', 'testChatWebhook_')
    .addToUi();
}

// ==========================================
// 3. BACKGROUND TRIGGERS (Email & Chat)
// ==========================================

// ... (Your Email/Chat logic lives in KanbanBackend.gs now, 
//      so we don't need to duplicate it here, but we DO need the manual triggers below)
function postCheckInToChat(e) {
  // Pass through to backend logic if needed, or keep simple version here
  if (!e) return; 
  // ... (Keep your existing chat logic if you have it here, otherwise it's safe to omit)
}
function testChatWebhook_() {
  testChatWebhook();
}

function testChatWebhook() {
  const webhookUrl = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK') || PropertiesService.getScriptProperties().getProperty('NOTIFICATION_CHAT_WEBHOOK');
  if (!webhookUrl) {
    SpreadsheetApp.getUi().alert('Please set the CHAT_WEBHOOK script property in Project Settings.');
    return;
  }
  const config = loadConfig_();
  const wg = config.workgroupName || 'FACT';
  try {
    const res = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: `✅ ${wg} System: Webhook connection successful!` }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      SpreadsheetApp.getUi().alert(`✅ Test message sent successfully to Google Chat for ${wg}!`);
    } else {
      SpreadsheetApp.getUi().alert(`⚠️ Error sending to Chat: HTTP ${res.getResponseCode()}\n${res.getContentText()}`);
    }
  } catch(e) {
    SpreadsheetApp.getUi().alert(`❌ Webhook error: ${e.message}`);
  }
}
function getGuestPortalUrl() {
  return ScriptApp.getService().getUrl() + '?page=guestportal';
}

function processEmailAction(itemId, action, notes, userEmail) {
    try {
        const res = advanceWorkflow_(itemId, action, notes || "", userEmail);
        return res;
    } catch(err) {
        return { success: false, error: err.toString() };
    }
}

function debugKanban() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Tasks');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const execCol = headers.indexOf('ExecStatus');
  const wfCol = headers.indexOf('WorkflowStep');
  
  if(data.length > 1) {
      const lastRow = data[data.length - 1];
      return {
         execStatus: lastRow[execCol],
         wfStep: lastRow[wfCol]
      };
  }
  return { error: 'No data' };
}
// trigger push
 

/**
 * ONE-TIME MIGRATION SCRIPT
 * Run this from the Apps Script editor to convert old free-text Status_Summary 
 * columns into the new JSON StatusSummaryLog format.
 */
function migrateStatusSummaries() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const standardStatuses = ['green', 'yellow', 'red', 'on track', 'at risk', 'off track', 'completed', 'not started', 'legacy note'];
  
  ['Projects', 'Tasks'].forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    
    const headers = sh.getRange(1, 1, 1, sh.getMaxColumns()).getValues()[0];
    const sumIdx = headers.indexOf('StatusSummary');
    let logIdx = headers.indexOf('StatusSummaryLog');
    
    if (sumIdx === -1) return;
    
    // Create StatusSummaryLog column if it doesn't exist
    if (logIdx === -1) {
      logIdx = headers.length;
      sh.getRange(1, logIdx + 1).setValue('StatusSummaryLog');
    }
    
    const dataRange = sh.getDataRange();
    const values = dataRange.getValues();
    const updates = [];
    
    for (let r = 1; r < values.length; r++) {
      const oldText = String(values[r][sumIdx]).trim();
      const existingLog = String(values[r][logIdx]).trim();
      
      // Fix items that were just migrated incorrectly
      if (oldText === "Legacy Note" && existingLog.startsWith('[')) {
          try {
              const logs = JSON.parse(existingLog);
              if (logs.length === 1 && logs[0].note) {
                  logs[0].comment = logs[0].note;
                  delete logs[0].note;
                  logs[0].status = "On Track";
                  updates.push({ row: r + 1, colSum: sumIdx + 1, colLog: logIdx + 1, newSum: "On Track", newLog: JSON.stringify(logs) });
                  continue;
              }
          } catch(e) {}
      }
      
      // Standard migration for unmigrated items
      if (oldText && !standardStatuses.includes(oldText.toLowerCase()) && !oldText.startsWith('[')) {
         const newJson = JSON.stringify([{
           date: new Date().toISOString().split('T')[0],
           status: "On Track",
           comment: oldText
         }]);
         
         updates.push({ row: r + 1, colSum: sumIdx + 1, colLog: logIdx + 1, newSum: "On Track", newLog: newJson });
      }
    }
    
    // Apply updates
    updates.forEach(u => {
      sh.getRange(u.row, u.colSum).setValue(u.newSum);
      sh.getRange(u.row, u.colLog).setValue(u.newLog);
    });
  });
}
