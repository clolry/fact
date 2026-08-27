/**
 * PMSC SYSTEM BACKEND
 */

// ==========================================
// 0. SCRIPT PROPERTIES & CONSTANTS
// ==========================================
const NOTIFICATION_CHAT_WEBHOOK_URL = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_CHAT_WEBHOOK');

// ==========================================
// 1. BOOTSTRAP & INIT (SERVER SIDE)
// ==========================================
function getBootstrap() {
  const config = loadConfig_();
  const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
  const adminList = config.admins || [];
  const isAdmin = adminList.includes(currentUserEmail);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let projects = [];
  try { projects = getProjectsData_().projects; } catch(e) { console.error(e); }

  let list = [];
  try {
     const sh = ss.getSheetByName('Team_Log');
     if(sh && sh.getLastRow()>1) {
        const raw = sh.getRange(2,2,sh.getLastRow()-1,1).getValues().flat();
        [...new Set(raw.filter(String))].forEach(email => {
           let parts = email.split('@')[0].split('.');
           list.push({ name: parts.map(p=>p.charAt(0).toUpperCase()+p.slice(1)).join(' '), email: email.toLowerCase() });
        });
     }
  } catch(e){}
  // 6. Return Data Package
  return { 
      config: config, 
      projects: projects, 
      people: { list: list }, 
      user: { email: currentUserEmail, isAdmin: isAdmin },
      intakeCount: isAdmin ? getIntakeCount_(ss) : 0,
      intakeLastChecked: PropertiesService.getScriptProperties().getProperty('intakeLastChecked') || null
  };
}

function getIntakeCount_(ss) {
  try {
     const ish = ss.getSheetByName('Intake_Queue');
     if(ish && ish.getLastRow()>1) {
       return ish.getRange(2, 7, ish.getLastRow()-1, 1).getValues().flat().filter(s => s === 'Pending Review').length;
     }
  } catch(e){}
  return 0;
}

/**
 * Polls all pending approval requests and advances FACT workflow
 * when approvals are completed.
 * Set a time-driven trigger to run every 15 minutes.
 */
function pollApprovalStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const trackingSheet = ss.getSheetByName('Approval_Tracking');
  if (!trackingSheet || trackingSheet.getLastRow() < 2) return;

  const data = trackingSheet.getRange(2, 1, trackingSheet.getLastRow() - 1, 8).getValues();

  data.forEach((row, index) => {
    const itemId = row[0];
    const fileId = row[1];
    const approvalId = row[2];
    const currentStatus = row[5];
    const sheetRow = index + 2;

    if (currentStatus === 'Approved' || currentStatus === 'Rejected' || currentStatus === 'Cancelled') return;

    try {
      const approval = Drive.Approvals.get(fileId, approvalId);
      const approvalState = approval.approvalState;

      if (approvalState === 'APPROVED') {
        trackingSheet.getRange(sheetRow, 6).setValue('Approved');
        trackingSheet.getRange(sheetRow, 7).setValue(new Date());
        advanceWorkflow_(itemId, 'Approved', { Type: 'Data Call' }); // Mockup for now
      } else if (approvalState === 'REJECTED') {
        trackingSheet.getRange(sheetRow, 6).setValue('Rejected');
        trackingSheet.getRange(sheetRow, 7).setValue(new Date());
        advanceWorkflow_(itemId, 'Declined', { Type: 'Data Call' }); // Mockup for now
      }
    } catch (e) {
      console.error(`Error polling approval for ${itemId}: ${e.message}`);
    }
  });
}

