// ==========================================
// 2. CORE DATA FUNCTIONS
// ==========================================
function getProjectsData_(includeArchived = false) {
  const ss = SpreadsheetApp.getActive();
  const getRaw = (name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 1) return {headers: [], data: []};
    const values = sh.getDataRange().getDisplayValues();
    return {headers: values[0], data: values.slice(1)};
  };

  const pRaw = getRaw('Projects');
  const tRaw = getRaw('Tasks');
  const sRaw = getRaw('Sub_Tasks');
  const nRaw = getRaw('Notes');
  
  const noteMap = new Map();
  if (nRaw.data.length > 0) {
    const idIdx = nRaw.headers.indexOf('Parent_ID');
    const txtIdx = nRaw.headers.indexOf('Note_Text');
    nRaw.data.forEach(r => { if (r[idIdx] && r[txtIdx]) noteMap[r[idIdx]] = r[txtIdx]; });
  }

  let allItems = [];
  let itemMap = {};
  const cleanDate = (d) => d ? d.split('T')[0] : '';
  
  const mapRow = (headers, r, isProject) => {
      const getVal = (col) => {
          const idx = headers.indexOf(col);
          return idx >= 0 ? r[idx] : '';
      };
      
      let execStatus = getVal('ExecStatus') || getVal('Exec_Status');
      const wfStep = getVal('WorkflowStep');
      
      // Fallback if ExecStatus column is completely missing from the user's sheet
      if (!execStatus && wfStep) {
          if (wfStep.startsWith('DYNAMIC|')) {
              const parts = wfStep.split('|');
              if (parts[2] === 'PENDING') execStatus = 'Routing';
              else if (parts[2] === 'APPROVED') execStatus = 'Approved';
          } else if (wfStep.startsWith('{') || wfStep.startsWith('[')) {
              execStatus = 'Routing';
              try {
                  const parsed = JSON.parse(wfStep);
                  const sArr = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                  if (sArr.length > 0) {
                      if (sArr.every(s => s.status === 'Approved' || s.status === 'FYI_Complete')) {
                          execStatus = 'Approved';
                      } else if (sArr.some(s => s.status === 'Declined')) {
                          execStatus = 'Closed';
                      } else if (sArr.some(s => s.status === 'Returned')) {
                          execStatus = 'Draft';
                      }
                  }
              } catch(e) {}
          } else {
              execStatus = (wfStep === 'Approved') ? 'Approved' : (wfStep === 'Declined' ? 'Closed' : (wfStep === 'Returned' ? 'Draft' : 'Routing'));
          }
      }
      
      const card = {
          ID: getVal('ID'), Title: getVal('Title'), Type: getVal('Type') || (isProject ? 'Project' : 'Task'),
          ParentID: getVal('ParentID'), Owner: getVal('Owner'), DueDate: cleanDate(getVal('DueDate')),
          Status: getVal('Status'), Description: getVal('Description'), ExecStatus: execStatus,
          Complexity: getVal('Complexity'), Urgency: getVal('Urgency'), ThreadID: getVal('ThreadID'),
          DriveLink: getVal('DriveLink'), FolderID: getVal('FolderID'),
          Rank: getVal('Rank') ? parseFloat(getVal('Rank')) : 0, 
          CompletedDate: cleanDate(getVal('CompletedDate')), 
          Archived: (getVal('Archived') === 'TRUE'), 
          StatusSummary: getVal('StatusSummary'), Assigned: getVal('Assigned'),
          NotificationSchedule: getVal('NotificationSchedule'), OrgCode: getVal('OrgCode'),
          LatestNote: noteMap[getVal('ID')] || '',
          IsChild: false, Scoreboard: [],
          StatusSummaryLog: getVal('StatusSummaryLog') || r[38] || ''
      };
      
      if (!isProject) {
          card.RecDate = cleanDate(getVal('RecDate') || getVal('Received_Date'));
          card.IntDue = cleanDate(getVal('IntDue') || getVal('Internal_Due_Date'));
          card.DataCallNo = getVal('DataCallNo') || getVal('Data_Call_No');
          card.Requestor = getVal('Requestor');
      } else {
          card.StartDate = cleanDate(getVal('StartDate'));
          card.IntDue = cleanDate(getVal('IntDue') || getVal('Internal_Due_Date'));
      }
      // WorkflowStep and Primary_Doc_ID apply to both Tasks AND Projects
      card.WorkflowStep = getVal('WorkflowStep') || '';
      card.Primary_Doc_ID = getVal('Primary_Doc_ID') || '';
      return card;
  };

  // Projects data mapping
  const pIdIdx = pRaw.headers.indexOf('ID');
  if (pIdIdx !== -1) {
      pRaw.data.forEach(r => {
          if(!r[pIdIdx] || String(r[pIdIdx]).trim() === '') return;
          const card = mapRow(pRaw.headers, r, true);
          if (!includeArchived && card.Archived) return;
          allItems.push(card);
          itemMap[card.ID] = card;
      });
  }

  // Tasks data mapping
  const tIdIdx = tRaw.headers.indexOf('ID');
  if (tIdIdx !== -1) {
      tRaw.data.forEach(r => {
          if(!r[tIdIdx] || String(r[tIdIdx]).trim() === '') return;
          const task = mapRow(tRaw.headers, r, false);
          if (!includeArchived && task.Archived) return;
          allItems.push(task);
          itemMap[task.ID] = task;
      });
  }

  sRaw.data.forEach(r => {
      const idIdx = sRaw.headers.indexOf('ID');
      const pIdx = sRaw.headers.indexOf('Parent_ID');
      const nIdx = sRaw.headers.indexOf('Title');
      const dIdx = sRaw.headers.indexOf('DueDate');
      const stIdx = sRaw.headers.indexOf('Status');
      const aIdx = sRaw.headers.indexOf('Assigned');
      
      if(idIdx === -1 || pIdx === -1 || !r[idIdx] || !itemMap[r[pIdx]]) return;
      itemMap[r[pIdx]].Scoreboard.push({ id: r[idIdx], name: nIdx !== -1 ? r[nIdx] : '', status: stIdx !== -1 ? r[stIdx] : '', due: dIdx !== -1 ? cleanDate(r[dIdx]) : '', assigned: aIdx !== -1 ? (r[aIdx] || '') : '' });
  });

  return { projects: allItems };
}





/**
 * Handles post-save tasks: initial notes, activity logging, and intake cleanup.
 * @param {object} form The form data.
 * @param {string} finalId The item ID.
 * @param {boolean} isNew Whether this was a new item.
 * @param {string} sheetName The sheet the item was saved to.
 * @param {string[]} changeLog Array of change descriptions.
 * @private
 */
function finalizeItem_(form, finalId, isNew, sheetName, changeLog) {
  // Add initial note if provided
  if (isNew && form.InitialNote) {
    addNote(finalId, form.InitialNote);
  } else if (isNew && form.IntakeRowIndex) {
    // Fallback: If promoted from intake without form.InitialNote, pull email body from intake row and add as note
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const intakeSheet = ss.getSheetByName('Intake_Queue');
      const idx = parseInt(form.IntakeRowIndex);
      if (intakeSheet && !isNaN(idx) && idx > 0) {
        const intakeRow = intakeSheet.getRange(idx, 1, 1, 9).getValues()[0];
        let body = (intakeRow[3] || '').toString().trim();
        const sender = (intakeRow[1] || '').toString().trim();
        if (body) {
          if (body.startsWith("'")) body = body.substring(1).trim();
          const noteHeader = sender ? `📧 INTAKE EMAIL from ${sender}:\n` : `📧 INTAKE EMAIL:\n`;
          addNote(finalId, `${noteHeader}${body}`);
        }
      }
    } catch (e) {
      console.error(`Error adding intake body as note: ${e.message}`);
    }
  }

  // Mark intake item as converted
  if (form.IntakeRowIndex && isNew) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const intakeSheet = ss.getSheetByName('Intake_Queue');
      const idx = parseInt(form.IntakeRowIndex);
      if (intakeSheet && !isNaN(idx) && idx > 0) {
        intakeSheet.getRange(idx, 7).setValue('Converted');
        intakeSheet.getRange(idx, 1, 1, intakeSheet.getMaxColumns())
          .setBackground('#f3f3f3');
      }
    } catch (e) {
      console.error(`Error marking intake item as converted: ${e.message}`);
    }
  }

  // Log activity
  logActivity_(
    Session.getActiveUser().getEmail(),
    finalId,
    form.Title,
    isNew ? 'Created' : 'Updated',
    isNew ? `Item created in ${sheetName}.` : (changeLog || []).join(', ')
  );
}

// ==========================================
// 11. FETCH SINGLE ITEM (Robust Search)
// ==========================================
function getItemDetails(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetId = String(id).trim(); // Remove safety spaces
  const cleanDate = (d) => d ? new Date(d).toISOString().split('T')[0] : '';
  
  // Define all places an item might live
  // We check them in order.
  const places = [
    { name: 'Tasks', kind: 'Task' },
    { name: 'Tasks_Archive', kind: 'Task' },
    { name: 'Projects', kind: 'Project' },
    { name: 'Projects_Archive', kind: 'Project' },
    { name: 'Sub_Tasks', kind: 'Sub' } // Just in case
  ];

  for (const place of places) {
    const sh = ss.getSheetByName(place.name);
    if (!sh) continue;

    // Get all data to search efficiently
    const data = sh.getDataRange().getValues();
    
    // Start at row 1 (skip header)
    for (let i = 1; i < data.length; i++) {
      // Compare trimmed IDs
      if (String(data[i][0]).trim() === targetId) {
         const r = data[i];
         
         // FOUND IT! Return the correct structure based on the Sheet Type
         const headers = data[0];
         const getVal = (colName) => {
             const idx = headers.indexOf(colName);
             return idx >= 0 ? r[idx] : '';
         };
         
         if (place.kind === 'Project') {
             return {
                ID: getVal('ID'), Title: getVal('Title'), Type: 'Project', Owner: getVal('Owner'),
                DueDate: cleanDate(getVal('DueDate') || getVal('Due_Date')), Status: getVal('Status'),
                Description: getVal('Desc') || getVal('Description'), ExecStatus: getVal('ExecStatus'), Complexity: getVal('Complexity'), Urgency: getVal('Urgency'),
                DriveLink: getVal('DriveLink'), FolderID: getVal('FolderID'), 
                Archived: (getVal('Archived') === 'TRUE'), 
                CompletedDate: cleanDate(getVal('CompletedDate')),     
                StatusSummary: getVal('StatusSummary'),
                Primary_Doc_ID: getVal('Primary_Doc_ID') || r[37] || '',
                StatusSummaryLog: getVal('StatusSummaryLog') || r[38] || '',
                WorkflowStep: getVal('WorkflowStep'),
                Assigned: getVal('Assigned'),
                IntDue: cleanDate(getVal('IntDue') || getVal('Internal_Due_Date'))
             };
         } else if (place.kind === 'Task') {
             return {
                ID: getVal('ID'), Title: getVal('Title'), Type: getVal('Type'), ParentID: getVal('ParentID'),
                Owner: getVal('Owner'), DueDate: cleanDate(getVal('DueDate')), Status: getVal('Status'),
                Description: getVal('Desc') || getVal('Description'), Complexity: getVal('Complexity'), Urgency: getVal('Urgency'), ExecStatus: getVal('ExecStatus'),
                ThreadID: getVal('ThreadID'), DriveLink: getVal('DriveLink'), 
                RecDate: cleanDate(getVal('RecDate')), IntDue: cleanDate(getVal('IntDue')),
                Requestor: getVal('Requestor'), CompletedDate: cleanDate(getVal('CompletedDate')),     
                Archived: (getVal('Archived') === 'TRUE'), StatusSummary: getVal('StatusSummary'),
                WorkflowStep: getVal('WorkflowStep'),
                Primary_Doc_ID: getVal('Primary_Doc_ID') || r[37] || '',
                StatusSummaryLog: getVal('StatusSummaryLog') || r[38] || '',
                Assigned: getVal('Assigned'),
                NotificationSchedule: getVal('NotificationSchedule')
             };
         } else {
             // Sub-Task Fallback
             return {
                ID: getVal('ID'), Title: getVal('Title'), Type: 'Sub-Task', ParentID: getVal('ParentID'),
                Owner: getVal('Owner'), DueDate: cleanDate(getVal('DueDate')), Status: getVal('Status'),
                Description: getVal('Desc') || getVal('Description'),
                CompletedDate: ''
             };
         }
      }
    }
  }
  
  return null; // Truly not found
}

// ==========================================
// 12. GET WORKFLOW TEMPLATES
// ==========================================
function getWorkflowTemplates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Workflow_Templates');
  
  if (!sh) {
    // Create the sheet and populate a default template
    sh = ss.insertSheet('Workflow_Templates');
    sh.hideSheet();
    sh.appendRow(['Template_Name', 'JSON_Definition']);
    
    // Default Template: Standard Route
    const defaultTemplate = [
        { step: 1, role: "Peer Review", type: "Sequential", approvers: [""], status: "Pending" },
        { step: 2, role: "Branch Chief", type: "Sequential", approvers: [""], status: "Future" },
        { step: 3, role: "Executive DAC", type: "Sequential", approvers: [""], status: "Future" }
    ];
    
    // Default Template: Parallel Board Review
    const parallelTemplate = [
        { step: 1, role: "Board Review", type: "Parallel", approvers: ["", ""], status: "Pending" },
        { step: 2, role: "Final Sign-off", type: "Sequential", approvers: [""], status: "Future" }
    ];
    
    sh.appendRow(['Standard 3-Step Route', JSON.stringify(defaultTemplate)]);
    sh.appendRow(['Parallel Board Review', JSON.stringify(parallelTemplate)]);
    
    sh.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#e0e0e0");
    sh.setColumnWidth(2, 500);
  }
  
  const data = sh.getDataRange().getValues();
  if (data.length === 0) return [];
  
  const templates = [];
  // Determine column mapping dynamically based on headers
  let nameColIndex = 0;
  let jsonColIndex = 1;
  let appliesToColIndex = -1;
  let startIdx = 1; // Assuming row 0 is headers
  
  if (data[0].length >= 4) {
      nameColIndex = data[0].indexOf('Name') > -1 ? data[0].indexOf('Name') : 1;
      appliesToColIndex = data[0].indexOf('Applies_To') > -1 ? data[0].indexOf('Applies_To') : 2;
      jsonColIndex = data[0].indexOf('Steps_JSON') > -1 ? data[0].indexOf('Steps_JSON') : 3;
  }
  
  for (let i = startIdx; i < data.length; i++) {
     const nameVal = data[i][nameColIndex];
     const jsonVal = data[i][jsonColIndex];
     const appliesToVal = appliesToColIndex > -1 ? data[i][appliesToColIndex] : 'All';
     
     if (!nameVal || !jsonVal) continue;
     
     try {
         // Sanitize common JSON errors (smart quotes)
         let rawJson = jsonVal.toString().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
         templates.push({
             name: nameVal,
             appliesTo: appliesToVal || 'All',
             definition: JSON.parse(rawJson)
         });
     } catch (e) {
         templates.push({
             name: "⚠️ [INVALID JSON] " + nameVal,
             appliesTo: 'All',
             definition: []
         });
     }
  }
  return templates;
}

// ==========================================
// 13. GET ACTIVE TASK LIST (FOR DROPDOWN)
// ==========================================
function getActiveTaskList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Tasks');
  if (!sh || sh.getLastRow() < 2) return [];

  // Get ID (Col A), Title (Col B), Status (Col G)
  // Indexes: 0, 1, 6
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  
  // Filter for items that are NOT Done/Cancelled/Archived
  const active = data.filter(r => r[6] !== 'Done' && r[6] !== 'Cancelled');
  
  // Return simple objects
  return active.map(r => ({
    id: r[0],
    title: r[1]
  }));
}
function getMyRecentThreadIds() {
  const config = loadConfig_();
  const groupEmailString = config.groupEmail;
  
  if (!groupEmailString) {
     console.log("Error: GROUP_EMAIL not set in Script Properties.");
     return;
  }
  
  // Format for multi-inbox
  const emails = groupEmailString.split(',').map(e => e.trim()).filter(e => e);
  const emailQuery = emails.map(e => `to:${e}`).join(' OR ');
  const query = `(${emailQuery}) newer_than:14d`;
  
  const threads = GmailApp.search(query);
  
  console.log(`--- FOUND ${threads.length} THREADS (Last 14 Days) ---`);
  
  threads.forEach(t => {
    const subject = t.getFirstMessageSubject();
    const id = t.getId();
    console.log(`ID: ${id}  |  SUBJECT: "${subject}"`);
  });
  
  console.log("-----------------------------------------------------");
  
  if (threads.length === 0) {
    console.log("No emails found. Double check that you have access to view emails sent to your configured addresses.");
  }
}

/**
 * Saves or updates a Workflow Template in the Workflow_Templates sheet.
 */
function saveApprovalWorkflowTemplate(name, oldName, appliesTo, scope, stepsJson) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Workflow_Templates');
  if (!sheet) {
      sheet = ss.insertSheet('Workflow_Templates');
      sheet.appendRow(['Template_ID', 'Name', 'Applies_To', 'Steps_JSON', 'Scope']);
  }
  
  const data = sheet.getDataRange().getValues();
  let foundIndex = -1;
  const nameToSearch = oldName || name;
  
  for (let i = 1; i < data.length; i++) {
     if (data[i][1] === nameToSearch) {
         foundIndex = i;
         break;
     }
  }
  
  if (foundIndex > 0) {
      // Update existing
      sheet.getRange(foundIndex + 1, 2).setValue(name);
      sheet.getRange(foundIndex + 1, 3).setValue(appliesTo);
      sheet.getRange(foundIndex + 1, 4).setValue(stepsJson);
      sheet.getRange(foundIndex + 1, 5).setValue(scope || 'Local');
  } else {
      // Create new
      const newId = Utilities.getUuid().substring(0,8).toUpperCase();
      sheet.appendRow([newId, name, appliesTo, stepsJson, scope || 'Local']);
  }
  return true;
}

/**
 * Deletes a Workflow Template from the Workflow_Templates sheet.
 */
function deleteApprovalWorkflowTemplate(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Workflow_Templates');
  if (!sheet) return false;
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
     if (data[i][1] === name) {
         sheet.deleteRow(i + 1);
         return true;
     }
  }
  return false;
}

/**
 * Gets the current system configuration from the Config sheet.
 */
function getAdminSettingsBackend() {
  try {
    const access = getAccessLevel_();
    if (access !== 'ADMIN') return { success: false, error: "Access Denied" };
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Config');
    if (!sh) return { success: false, error: "Config sheet not found" };
    
    const data = sh.getDataRange().getValues();
    const getList = (colIndex) => data.slice(1).map(r => r[colIndex]).filter(String);
    
    const settings = {};
    data.slice(1).forEach(r => { if(r[0]) settings[r[0]] = r[1]; });

    // Read Drive_Config for type-specific folders (handling standard & legacy buggy layouts safely)
    let driveConfig = {};
    let driveSh = ss.getSheetByName('Drive_Config');
    if (driveSh && driveSh.getLastRow() > 0) {
      const numCols = Math.min(4, driveSh.getMaxColumns());
      const headers = driveSh.getRange(1, 1, 1, numCols).getValues()[0].map(h => h.toString().trim());
      const isBuggyOrder = (headers[1] === 'IDPrefix');
      
      if (driveSh.getLastRow() > 1) {
        const driveData = driveSh.getRange(2, 1, driveSh.getLastRow() - 1, numCols).getValues();
        driveData.forEach(row => {
          if (row[0]) {
            if (isBuggyOrder) {
              // Buggy order: RecordType, IDPrefix, BaseFolderId, TemplateFolderId
              driveConfig[row[0]] = {
                prefix: '',
                base: row[1] || '',
                template: row[2] || ''
              };
            } else {
              // Standard order: RecordType, BaseFolderId, TemplateFolderId, IDPrefix
              driveConfig[row[0]] = {
                base: row[1] || '',
                template: row[2] || '',
                prefix: row[3] || ''
              };
            }
          }
        });
      }
    }

    // Read Stakeholders (Full Table) with role column safely
    let stakeholders = [];
    let stkSh = ss.getSheetByName('Stakeholders');
    if (stkSh && stkSh.getLastRow() > 1) {
        const numCols = Math.min(5, stkSh.getMaxColumns());
        const stkData = stkSh.getRange(2, 1, stkSh.getLastRow() - 1, numCols).getValues();
        stakeholders = stkData.map(r => ({
            name: r[0],
            email: r[1],
            workgroup: r[2],
            orgCode: r[3],
            role: r[4] || 'GUEST'
        })).filter(s => s.email);
    }

    return { 
        success: true, 
        data: {
            admins: getList(5), // Col F
            execCoords: getList(7), // Col H
            execs: getList(4), // Col E
            types: getList(2), // Col C
            stages: getList(3), // Col D
            approverRoles: getList(6), // Col G
            workgroup: settings['Workgroup Name'] || "PMSC",
            orgCode: settings['Org Code'] || "",
            systemEmailAlias: settings['System Email Alias'] || "",
            sidebarConfig: settings['Sidebar Config'] || "[]",
            healthStatuses: settings['Health Statuses'] || "",
            driveConfig: driveConfig,
            stakeholders: stakeholders
        }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Saves Admin Settings to the Config sheet and synchronizes PropertiesService.
 */
function saveAdminSettingsBackend(payload) {
  try {
    const access = getAccessLevel_();
    if (access !== 'ADMIN') return { success: false, error: "Access Denied" };
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Config');
    if (!sh) return { success: false, error: "Config sheet not found" };
    
    const maxRows = sh.getMaxRows();
    if (maxRows > 1) {
        // Clear columns C through H
        sh.getRange(2, 3, maxRows - 1, 6).clearContent();
    }
    
    const writeCol = (csv, colIndex) => {
        if(!csv) return;
        const arr = csv.split(',').map(s => s.trim()).filter(String);
        if(arr.length > 0) {
            sh.getRange(2, colIndex, arr.length, 1).setValues(arr.map(a => [a]));
        }
        return arr;
    };
    
    const types = writeCol(payload.types, 3); // Col C
    const stages = writeCol(payload.stages, 4); // Col D
    const execs = writeCol(payload.execs, 5); // Col E
    const admins = writeCol(payload.admins, 6); // Col F
    const approverRoles = writeCol(payload.approverRoles, 7); // Col G
    const execCoords = writeCol(payload.execCoords, 8); // Col H
    
    // Write key-value pairs in Col A and B
    const kvs = {
        'Workgroup Name': payload.workgroup,
        'Org Code': payload.orgCode,
        'System Email Alias': payload.systemEmailAlias,
        'Sidebar Config': payload.sidebarConfig,
        'Health Statuses': payload.healthStatuses
    };
    
    // Explicitly update ScriptProperties for instant access across backend
    PropertiesService.getScriptProperties().setProperty('SYSTEM_EMAIL_ALIAS', payload.systemEmailAlias || '');
    
    const data = sh.getDataRange().getValues();
    for (let key in kvs) {
        let found = false;
        for (let i = 1; i < data.length; i++) {
            if (data[i][0] === key) {
                sh.getRange(i + 1, 2).setValue(kvs[key]);
                found = true;
                break;
            }
        }
        if (!found) {
            sh.appendRow([key, kvs[key]]);
        }
    }
    
    // Write Drive_Config mappings in standard order
    let driveSh = ss.getSheetByName('Drive_Config');
    if (!driveSh) driveSh = ss.insertSheet('Drive_Config');
    driveSh.clear();
    driveSh.appendRow(['RecordType', 'BaseFolderId', 'TemplateFolderId', 'IDPrefix']);
    driveSh.getRange("A1:D1").setFontWeight("bold");
    
    if (payload.driveConfig) {
      const driveRows = [];
      for (const type in payload.driveConfig) {
        const item = payload.driveConfig[type];
        if (type.trim()) driveRows.push([type.trim(), item.base || '', item.template || '', item.prefix || '']);
      }
      if (driveRows.length > 0) {
        driveSh.getRange(2, 1, driveRows.length, 4).setValues(driveRows);
      }
    }

    // Sync Stakeholders from full object array (including role) safely
    if (payload.stakeholders && Array.isArray(payload.stakeholders)) {
        let stkSh = ss.getSheetByName('Stakeholders');
        if (stkSh) {
            const lastRow = stkSh.getLastRow();
            if (lastRow > 1) {
                const clearCols = Math.min(5, stkSh.getMaxColumns());
                stkSh.getRange(2, 1, lastRow - 1, clearCols).clearContent();
            }
            if (payload.stakeholders.length > 0) {
                const stkRows = payload.stakeholders.map(s => [s.name || '', s.email || '', s.workgroup || '', s.orgCode || '', s.role || 'GUEST']);
                if (stkSh.getMaxColumns() < 5) {
                    stkSh.insertColumnsAfter(stkSh.getMaxColumns(), 5 - stkSh.getMaxColumns());
                }
                stkSh.getRange(2, 1, stkRows.length, 5).setValues(stkRows);
            }
            
            // Re-sync the sharedUserList property for access control
            const emails = payload.stakeholders.map(s => s.email).filter(Boolean);
            PropertiesService.getScriptProperties().setProperty('sharedUserList', JSON.stringify(emails));
        }
    }

    // Sync to PropertiesService for instant access
    const props = PropertiesService.getScriptProperties();
    const extractEmail = (str) => {
      const match = str.match(/<([^>]+)>/);
      return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
    };
    if (admins) props.setProperty('adminUserList', JSON.stringify(admins.map(extractEmail)));
    if (execs) props.setProperty('execUserList', JSON.stringify(execs.map(extractEmail)));
    if (execCoords) props.setProperty('execCoordUserList', JSON.stringify(execCoords.map(extractEmail)));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Public endpoint to fetch a single item by ID efficiently.
 */
function getItemById(itemId) {
    if (!itemId) return null;
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        for (const sName of ['Tasks', 'Projects', 'Sub_Tasks']) {
            const sh = ss.getSheetByName(sName);
            if (!sh) continue;
            
            const data = sh.getDataRange().getDisplayValues();
            if (data.length < 2) continue;
            
            const headers = data[0];
            const idCol = headers.indexOf('ID');
            if (idCol < 0) continue;
            
            const row = data.find(r => String(r[idCol]) === String(itemId));
            if (row) {
                // Just map it using the same mapping logic as the main data loader
                const item = {};
                for (let i = 0; i < headers.length; i++) {
                    item[headers[i]] = row[i];
                }
                item.Type = sName === 'Projects' ? 'Project' : (sName === 'Tasks' ? 'Task' : 'Sub-Task');
                return { success: true, data: item };
            }
        }
        return { success: false, error: 'Item not found' };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
