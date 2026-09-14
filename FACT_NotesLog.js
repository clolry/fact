// ==========================================
// 3. NOTES
// ==========================================

function extractOrgCodeFromName_(name) {
  if (!name) return '';
  const matchParentheses = name.match(/\((F[A-Z0-9]{3,7})\)/i);
  if (matchParentheses) return matchParentheses[1].toUpperCase();

  const matchBrackets = name.match(/\[(F[A-Z0-9]{3,7})\]/i);
  if (matchBrackets) return matchBrackets[1].toUpperCase();

  const matchHyphen = name.match(/-\s*(F[A-Z0-9]{3,7})\b/i);
  if (matchHyphen) return matchHyphen[1].toUpperCase();

  const matchWord = name.match(/\b(F[A-Z0-9]{3,7})\b/i);
  if (matchWord) return matchWord[1].toUpperCase();

  if (name.includes(' - ')) {
      const parts = name.split(' - ');
      const extracted = parts[parts.length - 1].trim();
      if (/^F[A-Z0-9]{1,8}$/i.test(extracted)) {
          return extracted.toUpperCase();
      }
  }
  return '';
}
/**
 * Appends a note to the Notes sheet for a given item, then logs the activity.
 * PERF-03: Added optional `title` parameter. Callers that already know the item
 * title should pass it in to skip the multi-sheet ID scan that previously ran
 * on every note creation.
 * @param {string} projectId The ID of the item to attach the note to.
 * @param {string} text The note text.
 * @param {string} [customAuthor] Optional. Overrides the current user as author.
 * @param {string} [knownTitle] Optional. The item title, to avoid a sheet scan.
 * @returns {Array} The updated notes list for the item.
 */
function addNote(projectId, text, customAuthor, knownTitle) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Notes');
  if (!sheet) { sheet = ss.insertSheet('Notes'); sheet.appendRow(['Note ID', 'Project ID', 'Timestamp', 'Author', 'Note Text']); }
  
  // Use customAuthor if provided, otherwise default to current user
  const author = customAuthor || Session.getActiveUser().getEmail();
  
  sheet.appendRow([Utilities.getUuid(), projectId, new Date(), author, text]);
  
  // Resolve the item title for the activity log.
  // If the caller already knows the title, use it directly (PERF-03).
  // Otherwise fall back to a sheet scan (legacy path, kept for backward compatibility).
  let realTitle = knownTitle || '';

  if (!realTitle) {
    realTitle = 'Item ' + projectId; // Fallback default
    const sources = ['Tasks', 'Projects', 'Sub_Tasks'];
    for (const name of sources) {
      const sh = ss.getSheetByName(name);
      if (!sh) continue;
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(projectId)) {
          realTitle = data[i][1]; // Column B is the Title
          break;
        }
      }
      if (realTitle !== 'Item ' + projectId) break;
    }
  }

  logActivity_(author, projectId, realTitle, 'Note', 'Added a new note');
  
  return getNotes(projectId);
}

function getNotes(projectId) {
  // 1. Security Check
  const config = loadConfig_();
  const currentUser = Session.getActiveUser().getEmail().toLowerCase();
  
  // If user is NOT an Admin, return empty or error
  if (!config.admins.includes(currentUser)) {
     return []; // Return empty list so the UI just shows nothing
  }

  // 2. Fetch Notes (Existing Logic)
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notes');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  let notes = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(projectId)) {
      notes.push({ timestamp: new Date(data[i][2]).toLocaleString(), author: data[i][3], text: data[i][4] });
    }
  }
  return notes.reverse();
}

// ==========================================
// 14. ACTIVITY LOGGING SYSTEM
// ==========================================
function logActivity_(user, id, title, action, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Activity_Log');
    if (!sh) { sh = ss.insertSheet('Activity_Log'); sh.appendRow(['Timestamp','User','ID','Title','Action','Details']); }
    
    // Clean user email
    let userName = user;
    if (user.includes('@')) {
       userName = user.split('@')[0].split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    
    sh.appendRow([new Date(), userName, id, title, action, details]);
  } catch(e) { console.error("Log failed: " + e.message); }
}

function getSystemTimeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Activity_Log');
  
  if (!sh || sh.getLastRow() < 2) return [];

  // Fetch last 50 events
  const lastRow = sh.getLastRow();
  const startRow = Math.max(2, lastRow - 49); 
  const data = sh.getRange(startRow, 1, lastRow - startRow + 1, 6).getValues();

  // Helper to safely parse dates
  const parseDate = (d) => {
    if (d instanceof Date) return d;
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  return data.map(r => {
     const dateObj = parseDate(r[0]);
     
     return {
       // If valid date, use it for sorting. If not, use current time (fallback)
       timeVal: dateObj ? dateObj.getTime() : 0, 
       
       // Formatted Date for Header (e.g. "Jan 27, 2026")
       dateStr: dateObj ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "Recent Activity",
       
       // Formatted Time for Item (e.g. "2:41 PM")
       timeStr: dateObj ? dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : String(r[0]),
       
       user: r[1],
       id: r[2],
       title: r[3],
       action: r[4],
       details: r[5]
     };
  })
  // Sort Newest First (Descending)
  .sort((a,b) => b.timeVal - a.timeVal);
}

/**
 * ==========================================
 * 15. NOTIFICATION SYSTEM
 * ==========================================
 */

/**
 * Resolves a list of names or emails into a clean list of email addresses using the Google Directory.
 * @param {string[]} recipients - An array of strings (names or emails).
 * @returns {string[]} A unique array of verified email addresses.
 * @private
 */
function resolveRecipientEmails_(recipients) {
  if (!recipients || recipients.length === 0) return [];
  const finalEmails = new Set();

  recipients.forEach(recipient => {
    const item = recipient.trim();
    if (!item) return;

    if (item.includes('@')) {
      finalEmails.add(item.toLowerCase());
      return;
    }

    try {
      const result = People.People.searchDirectoryPeople({
        query: item,
        readMask: 'emailAddresses',
        sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
      });

      if (result && result.people && result.people.length > 0 && result.people[0].emailAddresses) {
        finalEmails.add(result.people[0].emailAddresses[0].value.toLowerCase());
      } else {
         console.warn(`Notification Warning: Could not resolve an email for '${item}' from Directory.`);
      }
    } catch (e) {
      console.error(`People API Error for query '${item}': ${e.message}`);
    }
  });

  return [...finalEmails];
}

/**
 * Sends a simple message to the configured Google Chat webhook URL.
 * @param {string} message - The text message to send.
 */
/**
 * Sends a message to a Google Chat webhook.
 * @param {string} message - The text message to send.
 * @param {string} channel - The type of webhook to use ('checkin' or 'notification'). Defaults to 'checkin'.
 */
function sendToChat_(message, channel = 'checkin') {
  let webhookUrl;

  if (channel === 'notification') {
    webhookUrl = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_CHAT_WEBHOOK');
    if (!webhookUrl) {
      console.log("Chat Skipped: NOTIFICATION_CHAT_WEBHOOK property is not set.");
      return;
    }
  } else {
    webhookUrl = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK');
     if (!webhookUrl) {
      console.log("Chat Skipped: CHAT_WEBHOOK property is not set.");
      return;
    }
  }

  const payload = JSON.stringify({ text: message });
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(webhookUrl, options);
    if (response.getResponseCode() !== 200) {
      console.error(`Chat Webhook Error for channel '${channel}': ${response.getResponseCode()} ${response.getContentText()}`);
    }
  } catch (e) {
    console.error(`Failed to send chat message to channel '${channel}': ${e.message}`);
  }
}


/**
 * Scans all tasks and projects and sends due date reminders.
 * Parses a comma-separated list of reminder days.
 * Intended to be run on a daily time-driven trigger.
 */
/**
 * Scans all tasks and projects and sends due date reminders.
 * Parses a comma-separated list of reminder days.
 * Includes detailed logging for troubleshooting.
 * Intended to be run on a daily time-driven trigger.
 */
function sendDueDateReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to the beginning of the day

  // SEC-01: Read board URL from PropertiesService so it can be updated without a code deploy.
  // Set the BOARD_URL script property in Project Settings > Script Properties.
  const boardUrl = PropertiesService.getScriptProperties().getProperty('BOARD_URL')
    || ScriptApp.getService().getUrl();

  console.log(`Starting reminder check for ${today.toLocaleDateString()}`);

// ARCH-02: Note - The column index maps in sheetsToProcess are fragile. 
// A full schema extraction/mapping refactor is deferred as future work.
const sheetsToProcess = [
  {
    name: 'Tasks',
    idCol: 1,
    titleCol: 2,
    statusCol: 7,
    ownerCol: 5,        // Col E: Assigned_To
    teamCol: 23,        // Col W: Assigned
    intDueCol: 16,      // Col P: Internal_Due_Date
    summaryCol: 22,     // Col V: Status_Summary
    linksCol: 13,       // Col M: Drive_Link
    scheduleCol: 24,    // Col X: NotificationSchedule
    lastNotifiedCol: 25 // Col Y: LastNotified
  },
  {
    name: 'Projects',
    idCol: 1,
    titleCol: 2,
    statusCol: 7,
    ownerCol: 4,        // Col D: Owner
    teamCol: 19,        // Col S: Assigned
    intDueCol: 6,       // Col F: DueDate (used as due reference for Projects)
    summaryCol: 18,     // Col R: StatusSummary
    linksCol: 13,       // Col M: DriveLink
    scheduleCol: 20,    // Col T: NotificationSchedule
    lastNotifiedCol: 21 // Col U: LastNotified
  }
];

  sheetsToProcess.forEach(config => {
    const sheet = ss.getSheetByName(config.name);
    if (!sheet || sheet.getLastRow() < 2) {
      console.log(`Skipping sheet '${config.name}': Not found or empty.`);
      return;
    }

    const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.lastNotifiedCol);
    const data = dataRange.getDisplayValues();
    console.log(`Processing ${data.length} items from sheet '${config.name}'.`);

    const lastNotifiedUpdates = data.map(row => [row[config.lastNotifiedCol - 1]]); // copy existing
    let madeUpdates = false;

    data.forEach((row, index) => {
      const id = row[config.idCol - 1];
      const schedulesStr = row[config.scheduleCol - 1];
      const intDueDateStr = row[config.intDueCol - 1];
      const lastNotifiedStr = row[config.lastNotifiedCol - 1];
      const status = row[config.statusCol - 1];
      const title = row[config.titleCol - 1];
      
      if (!id || !schedulesStr || !intDueDateStr || ['Done', 'Cancelled'].includes(status)) {
        return;
      }
      
      if (lastNotifiedStr && new Date(lastNotifiedStr).setHours(0,0,0,0) === today.getTime()) {
        return;
      }

      try {
        const intDueDate = new Date(intDueDateStr);
        // Add 12 hours to safely push any timezone-shifted midnight back into the correct local day before normalizing
        intDueDate.setTime(intDueDate.getTime() + (12 * 60 * 60 * 1000));
        intDueDate.setHours(0, 0, 0, 0);

        const daysUntilDue = Math.round((intDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const scheduledDays = schedulesStr.split(',').map(s => parseInt(s.trim(), 10)).filter(num => !isNaN(num));

        console.log(`CHECKING: ID=${id}, Title='${title}', DueDate=${intDueDate.toLocaleDateString()}, DaysUntilDue=${daysUntilDue}, Schedule=[${scheduledDays.join(',')}]`);

        // --- START OF LOGIC CHANGE ---
        // The condition now checks for an exact match OR if the item is overdue AND an "On Due Date" reminder was set.
        const shouldNotify = scheduledDays.includes(daysUntilDue) || (daysUntilDue < 0 && scheduledDays.includes(0));
        // --- END OF LOGIC CHANGE ---

        if (shouldNotify) {
          console.log(`  >>> CONDITION MET for ${id}. Preparing to send notification.`);

          const owner = row[config.ownerCol - 1];
          const assignedTeam = (row[config.teamCol - 1] || '').split(',').map(name => name.trim());
          const summary = row[config.summaryCol - 1] || 'No summary provided.';
          const links = row[config.linksCol - 1] || 'No links provided.';
          
          const allRecipients = [owner, ...assignedTeam].filter(Boolean);
          const recipientEmails = resolveRecipientEmails_(allRecipients);

          if (recipientEmails.length > 0) {
            let dayText = daysUntilDue === 1 ? '1 day' : (daysUntilDue === 0 ? 'today' : (daysUntilDue < 0 ? `${Math.abs(daysUntilDue)} day(s) overdue` : `${daysUntilDue} days`));
            
            const subject = `Reminder: Task '${title}' is ${dayText}`;
            const htmlEmailBody = `
              <html><body>
              <p>This is an automated reminder that the following item is <b>${dayText}</b>.</p>
              <hr>
              <h3><a href="${boardUrl}">${title}</a> (${id})</h3>
              <p><b>Current Status Summary:</b><br>${summary.replace(/\n/g, '<br>')}</p>
              <p><b>Attachments / Links:</b><br>${links.replace(/\n/g, '<br>')}</p>
              <hr>
              <p>Please review the item on the <a href="${boardUrl}">${config.workgroupName || "PMSC"} Workgroup Activity Tracker (WAT)</a>.</p>
              </body></html>
            `;
            const chatMessage = `*Reminder: Task is ${dayText}*\n*<${boardUrl}|${title}>* (${id})\n*Owner:* ${owner}\n*Summary:* ${summary}`;

            sendMaskedEmail_({ to: recipientEmails.join(','), subject: subject, htmlBody: htmlEmailBody });
            sendToChat_(chatMessage, 'notification');
            
            // PERF-02: Batch updates to lastNotified
            lastNotifiedUpdates[index] = [new Date()];
            madeUpdates = true;
            console.log(`  >>> SUCCESS: Sent reminder for ${id} to ${recipientEmails.join(',')}`);

          } else {
            console.warn(`  >>> FAILED for ${id}: No valid recipients found for '${allRecipients.join(', ')}'.`);
          }
        }
      } catch (e) {
        console.error(`  >>> ERROR while processing item ${id} ('${title}'): ${e.message}`);
      }
    });

    if (madeUpdates) {
      sheet.getRange(2, config.lastNotifiedCol, lastNotifiedUpdates.length, 1).setValues(lastNotifiedUpdates);
    }
  });
  console.log("Reminder check complete.");
}
/**
 * Determines the current US Government Fiscal Year string (e.g., "FY2026").
 * The fiscal year starts in October of the previous calendar year.
 * @returns {string} The current fiscal year string.
 * @private
 */
function getCurrentFiscalYear_() {
  const today = new Date();
  const month = today.getMonth(); // 0=Jan, 9=Oct
  const year = today.getFullYear();
  // If the month is October (9) or later, the fiscal year is the next calendar year.
  const fiscalYear = (month >= 9) ? year + 1 : year;
  return `FY${fiscalYear}`;
}

/**
 * Searches for a subfolder within a parent folder. If not found, it creates one.
 * @param {DriveApp.Folder} parentFolder The parent folder to search within.
 * @param {string} folderName The name of the subfolder to find or create.
 * @returns {DriveApp.Folder} The found or newly created subfolder.
 * @private
 */
function getOrCreateSubfolder_(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) {
    // Folder already exists, return it.
    return folders.next();
  } else {
    // Folder does not exist, create and return it.
    return parentFolder.createFolder(folderName);
  }
}

/**
 * A temporary function to force the Google Drive authorization prompt.
 * Run this once from the script editor.
 */
function forceDriveAuthorization() {
      try {
        const folder = DriveApp.getRootFolder();
        Logger.log(`Successfully accessed Drive folder: ${folder.getName()}`);
        SpreadsheetApp.getUi().alert('Google Drive permissions have been successfully authorized.');
      } catch (e) {
        SpreadsheetApp.getUi().alert(`Could not authorize Google Drive. Please ensure the 'Google Drive API' is enabled in Services. Error: ${e.message}`);
      }
    }
    /**
 * Helper to find the FolderID for a given Task or Project ID.
 * This is a bit slow as it scans the sheets. Could be optimized later if needed.
 * @param {string} taskId The ID of the task/project (e.g., "TASK-1234").
 * @returns {string|null} The Google Drive Folder ID or null if not found.
 * @private
 */
function findFolderIdForTaskId_(taskId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // We check Tasks first, then Projects, as most items will be tasks.
  const sheetsToSearch = [
    { name: 'Tasks', idCol: 1, folderIdCol: 14 },
    { name: 'Projects', idCol: 1, folderIdCol: 14 }
  ];

  for (const config of sheetsToSearch) {
    const sheet = ss.getSheetByName(config.name);
    if (!sheet || sheet.getLastRow() < 2) continue;

    const ids = sheet.getRange(2, config.idCol, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === taskId) {
        return sheet.getRange(i + 2, config.folderIdCol).getValue();
      }
    }
  }
  console.warn(`Could not find a FolderID for item: ${taskId}`);
  return null;
}


/**
 * Scans a given Gmail message for attachments and links, then saves them
 * to the Google Drive folder associated with the given taskId.
 * @param {string} taskId The ID of the task/project to associate artifacts with.
 * @param {GoogleAppsScript.Gmail.GmailMessage} message The Gmail message object to process.
 * @private
 */
function processAndSaveArtifacts_(targetFolderId, message) {
  if (!targetFolderId || !message) { return []; }
  console.log(`--- Starting artifact processing for folder: ${targetFolderId} ---`);
  const newLinksCreated = [];

  try {
    const recordFolder = DriveApp.getFolderById(targetFolderId);

    // 1. Process Direct Attachments
    const attachments = message.getAttachments();
    if (attachments.length > 0) {
      attachments.forEach(attachment => {
        if (attachment.getName() && attachment.getSize() > 0) {
          try {
            const file = recordFolder.createFile(attachment);
            newLinksCreated.push(file.getUrl());
            console.log(`  > SUCCESS: Saved attachment "${attachment.getName()}"`);
          } catch (e) {
            console.error(`  > FAILED to save attachment "${attachment.getName()}": ${e.message}`);
          }
        }
      });
    }

    // 2. Process Links in Body
    const body = message.getPlainBody();
    const urlRegex = /https?:\/\/[^\s>"]+/g;
    const urls = body.match(urlRegex) || [];
    if (urls.length > 0) {
      urls.forEach(url => {
        console.log(`Processing URL: ${url}`);
        try {
          // --- THE FINAL FIX IS HERE ---
          // This regex now specifically looks for file-related paths, ignoring folder paths.
          const driveFileIdMatch = url.match(/\/(?:document|spreadsheets|presentation|file)\/d\/([\w-]+)/);
          const driveFolderIdMatch = url.match(/\/drive\/folders\/([\w-]+)/);

          if (driveFileIdMatch && driveFileIdMatch[1]) {
            const targetFileId = driveFileIdMatch[1];
            console.log(`  > Identified as Drive File. ID: ${targetFileId}`);
            recordFolder.createShortcut(targetFileId);
            newLinksCreated.push(url);
            console.log(`  > SUCCESS: Created native shortcut for Drive File.`);
          
          } else if (driveFolderIdMatch && driveFolderIdMatch[1]) {
            const targetFolderId = driveFolderIdMatch[1];
            console.log(`  > Identified as Drive Folder. ID: ${targetFolderId}`);
            recordFolder.createShortcut(targetFolderId);
            newLinksCreated.push(url);
            console.log(`  > SUCCESS: Created native shortcut for Drive Folder.`);

          } else {
            const titleMatch = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/);
            const title = (titleMatch && titleMatch[1]) ? titleMatch[1] : 'External Link';
            console.log(`  > Identified as an external link. Creating GDoc link file: [WEB LINK] ${title}`);
            const doc = DocumentApp.create(`[WEB LINK] ${title}`);
            doc.getBody().appendParagraph(url).setLinkUrl(url);
            doc.saveAndClose();
            const docFile = DriveApp.getFileById(doc.getId()).moveTo(recordFolder);
            newLinksCreated.push(docFile.getUrl());
          }
        } catch (e) {
          console.error(`  > FAILED to process link "${url}". Error: ${e.message}`);
        }
      });
    }
  } catch (e) {
    console.error(`--- CRITICAL FAILURE in processAndSaveArtifacts_: ${e.message} ---`);
  }
  
  console.log(`--- Finished artifact processing. Created ${newLinksCreated.length} new links. ---`);
  return newLinksCreated;
}

function getIntakeQueue() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Intake_Queue');

    if (!sh || sh.getLastRow() < 2) {
      console.log("getIntakeQueue: Sheet is empty or has only a header row.");
      return [];
    }

    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();

    // --- START: THE DEFINITIVE FIX ---
    // First, map the data to include the original row index from the sheet.
    const itemsWithOriginalIndex = data.map((row, index) => {
      return {
        data: row,
        originalRowIndex: index + 2 // This is the TRUE row number (2-based)
      };
    });

    // Now, filter this new array based on the status.
    const pendingItems = itemsWithOriginalIndex.filter(item => {
      const rowData = item.data;
      return rowData && rowData[6] && String(rowData[6]).trim() === 'Pending Review';
    });

    // Finally, map the filtered items into the objects for the UI, using the stored originalRowIndex.
    return pendingItems.map(item => {
      const r = item.data;
      // This helper ensures dates are always sent as safe strings
      const toSafeDateString = (dateValue) => (dateValue instanceof Date) ? dateValue.toISOString() : String(dateValue);

      return {
        rowIndex: item.originalRowIndex, // Use the TRUE original row index
        date: toSafeDateString(r[0]),
        sender: r[1],
        subject: r[2],
        body: r[3],
        type: r[4],
        threadId: r[8],
        status: r[6],
        approvalType: r[9] || '',
        priorApprover: r[10] || '',
        background: r[11] || '',
        suggestedDueDate: toSafeDateString(r[12])
      };
    });
    // --- END: THE DEFINITIVE FIX ---

  } catch (e) {
    console.error(`FATAL ERROR in getIntakeQueue: ${e.message}`);
    // Always return an empty array to prevent the frontend from crashing.
    return [];
  }
}

/**
 * A dedicated logging function to inspect data.
 * Private (note underscore suffix) — NOT callable from the frontend via google.script.run.
 * @private
 */
function logForDebugging_(data) {
  Logger.log("--- DEBUG LOG ---");
  Logger.log(JSON.stringify(data, null, 2));
  Logger.log("--- END DEBUG LOG ---");
}

function processGroupEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = loadConfig_();
  const groupEmailString = config.groupEmail;
  let finalTimestamp;

  try {
    if (!groupEmailString) {
      console.error("CRITICAL: 'GROUP_EMAIL' script property is not set. Cannot process emails.");
      return; // Exit early if config is missing
    }

    let logSheet = ss.getSheetByName('Message_Log');
    if (!logSheet) {
      logSheet = ss.insertSheet('Message_Log');
      logSheet.appendRow(['MessageID', 'ThreadID', 'Date']);
      logSheet.hideSheet();
    }
    const processedMsgs = new Set(logSheet.getRange(2, 1, logSheet.getLastRow() > 1 ? logSheet.getLastRow() - 1 : 1, 1).getValues().flat());
    
    const intakeSheet = ss.getSheetByName('Intake_Queue');
    const intakeThreads = new Set();
    if (intakeSheet.getLastRow() > 1) {
      intakeSheet.getRange(2, 9, intakeSheet.getLastRow() - 1, 1).getValues().flat().forEach(t => { if (t) intakeThreads.add(t); });
    }

    const threadMap = new Map();
    getProjectsData_().projects.forEach(p => {
      if (p.ThreadID) {
        String(p.ThreadID).split(',').map(s => s.trim()).filter(Boolean).forEach(tid => threadMap.set(tid, p.ID));
      }
    });

    const emailQuery = groupEmailString.split(',').map(e => `(to:"${e.trim()}" OR cc:"${e.trim()}")`).join(' OR ');
    const query = `(${emailQuery}) newer_than:7d`;
    const threads = GmailApp.search(query, 0, 50);
    console.log(`Found ${threads.length} recent threads to check against the log.`);

    if (threads.length > 0) {
      threads.forEach(thread => {
        const threadId = thread.getId();
        const messages = thread.getMessages();
        
        messages.forEach(msg => {
          const msgId = msg.getId();
          if (processedMsgs.has(msgId)) return;

          console.log(`Processing new message (ID: ${msgId}) in thread ${threadId}`);
          
          try {
            if (threadMap.has(threadId)) {
              const taskId = threadMap.get(threadId);
              const noteText = `📧 FOLLOW-UP EMAIL from ${msg.getFrom()} (${msg.getDate().toLocaleDateString()}):\n${msg.getPlainBody().substring(0, 3000)}`;
              addNote(taskId, noteText, 'System.Intake');
              logSheet.appendRow([msgId, threadId, new Date()]);
              processedMsgs.add(msgId);
            } else if (!intakeThreads.has(threadId)) {
              const subject = msg.getSubject();
              const from = msg.getFrom();
              const date = msg.getDate();
              let body = msg.getPlainBody().substring(0, 3000);
              if (/^[-+=@]/.test(body)) body = "'" + body;
              
              intakeSheet.appendRow([date, from, subject, body, 'Task', 'Medium', 'Pending Review', '', threadId]);
              intakeThreads.add(threadId);
              logSheet.appendRow([msgId, threadId, new Date()]);
              processedMsgs.add(msgId);
            }
          } catch (e) {
            console.error(`Failed to process message ${msgId}. Error: ${e.message}`);
          }
        });
      });
    }
  } catch (e) {
    console.error(`A critical error occurred during processGroupEmails: ${e.message}`);
  }

  finalTimestamp = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('intakeLastChecked', finalTimestamp);
  console.log(`Email processing complete. Timestamp updated to ${finalTimestamp}`);
  
  return finalTimestamp;
}
/**
 * Serves the HTML for the Guest Status Portal.
 */
function doGet_guestPortal(e) {
  return HtmlService.createHtmlOutputFromFile('GuestPortal')
    .setTitle(`${config.workgroupName || "PMSC"} Action Status Portal`)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/**
 * Called from the Guest Portal. Identifies the logged-in user and returns a list
 * of all action items where they are the requestor, the owner, or an assigned team member.
 * Uses exact email matching via the Stakeholders sheet for security.
 * @returns {Array} An array of action item objects relevant to the user.
 */
function getGuestActionData() {
  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
    const { emailToName, nameToEmail } = buildStakeholderMap_();

    // Resolve the user's display name from the Stakeholders sheet
    const userDisplayName = (emailToName.get(userEmail) || '').toLowerCase().trim();

    console.log(`Guest Portal: Resolving user email="${userEmail}", displayName="${userDisplayName}"`);

    // Fetch full sheet data to also access the WorkflowStep column
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const allItems = getProjectsData_(false).projects;
    const userActions = [];
    const seenIds = new Set();

    // Build a map from item ID to WorkflowStep JSON so we can check approver membership
    const wfMap = new Map();
    for (const sheetName of ['Tasks', 'Projects', 'Sub_Tasks']) {
      const sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) continue;
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const idCol = headers.indexOf('ID');
      const wfCol = headers.indexOf('WorkflowStep');
      if (idCol < 0 || wfCol < 0) continue;
      for (let i = 1; i < data.length; i++) {
        const id = String(data[i][idCol]).trim();
        const wf = String(data[i][wfCol] || '').trim();
        if (id && wf) wfMap.set(id, wf);
      }
    }

    allItems.forEach(item => {
      if (item.Archived) return;
      if (seenIds.has(item.ID)) return;

      // Check primary ownership / assignment match
      let isMatch = isUserOnCard_(
        userEmail,
        userDisplayName,
        nameToEmail,
        item.Owner,
        item.Requestor,
        item.Assigned
      );

      // Also check if user is a workflow approver on any step (FYI or action)
      if (!isMatch) {
        const wfStr = wfMap.get(item.ID);
        if (wfStr && (wfStr.startsWith('[') || wfStr.startsWith('{'))) {
          try {
            const parsed = JSON.parse(wfStr);
            const steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
            for (const step of steps) {
              // s.approvers can be an array of strings or a comma-separated string
              let approverList = [];
              if (Array.isArray(step.approvers)) {
                approverList = step.approvers;
              } else if (typeof step.approvers === 'string') {
                approverList = step.approvers.split(',').map(s => s.trim());
              }
              const normalised = approverList.map(a => a.toLowerCase().trim());
              if (normalised.some(a => a === userEmail || (userDisplayName && a === userDisplayName))) {
                isMatch = true;
                break;
              }
            }
          } catch (e) {
            // Malformed JSON – skip workflow check for this item
          }
        }
      }

      if (!isMatch) return;
      seenIds.add(item.ID);

      const guestVisibleNotes = getGuestNotes_(item.ID);

      userActions.push({
        id: item.ID,
        title: item.Title,
        status: item.Status,
        owner: item.Owner || 'Unassigned',
        assigned: item.Assigned || '',
        intDue: item.IntDue
          ? new Date(item.IntDue).toLocaleDateString('en-US', { timeZone: 'UTC' })
          : 'N/A',
        dueDate: item.DueDate
          ? new Date(item.DueDate).toLocaleDateString('en-US', { timeZone: 'UTC' })
          : 'N/A',
        statusSummary: item.StatusSummary || 'No summary provided.',
        driveLink: item.DriveLink || '',
        notes: guestVisibleNotes
      });
    });

    console.log(`Guest Portal: Found ${userActions.length} actions for ${userEmail}`);
    return userActions;

  } catch (e) {
    console.error(`Error in getGuestActionData: ${e.message}`);
    throw new Error(`An error occurred loading your actions: ${e.message}`);
  }
}
/**
 * Checks the user's permissions and returns their access level.
 * This is the central security function called by doGet().
 * @returns {string} 'ADMIN', 'GUEST', or 'NONE'.
 * @private
 */
function getAccessLevel_() {
  try {
    const currentUserEmail = Session.getActiveUser().getEmail().toLowerCase();
    Logger.log(`getAccessLevel_ Check: Running for user "${currentUserEmail}"`);

    const props = PropertiesService.getScriptProperties();

    // 1. Check for Admin status
    const adminListJson = props.getProperty('adminUserList');
    if (adminListJson) {
      const adminList = JSON.parse(adminListJson);
      if (adminList.includes(currentUserEmail)) return 'ADMIN';
    }

    // 2. Check for Exec Coordinator status (Edit access)
    const execCoordListJson = props.getProperty('execCoordUserList');
    if (execCoordListJson) {
      const execCoordList = JSON.parse(execCoordListJson);
      if (execCoordList.includes(currentUserEmail)) return 'EXEC_COORD';
    }

    // 3. Check for Executive status (Read access + Dashboard)
    const execListJson = props.getProperty('execUserList');
    if (execListJson) {
      const execList = JSON.parse(execListJson);
      if (execList.includes(currentUserEmail)) return 'EXECUTIVE';
    }

    // 4. Check for Shared User (Task assignees / Approvers)
    const sharedListJson = props.getProperty('sharedUserList');
    if (sharedListJson) {
      const sharedList = JSON.parse(sharedListJson);
      if (sharedList.includes(currentUserEmail)) return 'GUEST'; // Shared users route to Guest Portal
    }

    // 5. Check legacy Stakeholders tab (Guests)
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stakeholderSheet = ss.getSheetByName('Stakeholders');
    if (stakeholderSheet && stakeholderSheet.getLastRow() > 1) {
      const stakeholderData = stakeholderSheet.getRange(2, 1, stakeholderSheet.getLastRow() - 1, 2).getValues();
      const stakeholderEmails = stakeholderData.map(r => (r[1] || '').toLowerCase().trim());
      if (stakeholderEmails.includes(currentUserEmail)) return 'GUEST';
    }

    // 6. Default deny.
    Logger.log(`DECISION: User not found in any access list. Access NONE.`);
    return 'NONE';

  } catch (e) {
    // Outer catch — something critically failed (e.g. Session unavailable)
    console.error(`Critical error during access level check: ${e.message}`);
    return 'NONE'; // Fail securely
  }
}
/**
 * UTILITY FUNCTION: Run this manually from the script editor ONCE
 * after changing the admin list in the 'Config' sheet.
 * It reads the admin emails and saves them to the fast PropertiesService
 * for use by the security firewall in doGet().
 */
function syncAdminListToProperties() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Config');
    if (!sh) {
      throw new Error("'Config' sheet not found.");
    }
    const data = sh.getDataRange().getValues();
    // Assuming Admins are in Column F (index 5)
    const extractEmail = (str) => {
      const match = str.match(/<([^>]+)>/);
      return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
    };
    const adminList = data.slice(1).map(r => r[5]).filter(String).map(extractEmail);
    
    if (adminList.length === 0) {
      console.warn("No admins found in Config sheet. Properties will be empty.");
    }
    
    // Store the list as a JSON string
    PropertiesService.getScriptProperties().setProperty('adminUserList', JSON.stringify(adminList));
    
    // --- CORRECTED FEEDBACK METHOD ---
    // Logger.log always works when running from the editor.
    Logger.log(`Success! Synced ${adminList.length} admins to script properties. The app will now use this list for security checks.`);
    
  } catch (e) {
    Logger.log(`Failed to sync admin list: ${e.message}`);
    throw new Error(`Failed to sync admin list: ${e.message}`);
  }
}
/**
 * Searches the GSA Directory for people matching a query string.
 * @param {string} query The name or email fragment to search for.
 * @returns {Array} A list of suggested people, each as an object {name, email, org, orgCode}.
 */
function searchDirectory(query) {
  if (!query || query.trim().length < 3) {
    return []; // Don't search until at least 3 characters are typed
  }

  try {
    const service = People.People;
    const response = service.searchDirectoryPeople({
      query: query,
      readMask: 'names,emailAddresses,organizations', // Ask for name, email, and org info
      sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE']
    });

    const people = response.people || [];
    
    return people.map(person => {
      const name = (person.names && person.names.length > 0) ? person.names[0].displayName : '';
      const email = (person.emailAddresses && person.emailAddresses.length > 0) ? person.emailAddresses[0].value : '';
      
      // Attempt to get Workgroup and Org Code from the organization field
      let workgroup = '';
      let orgCode = '';
      if (person.organizations && person.organizations.length > 0) {
        // This often contains a descriptive name, e.g., "Federal Acquisition Service"
        workgroup = person.organizations[0].name || ''; 
        // This often contains the specific org code, e.g., "QF"
        orgCode = person.organizations[0].department || ''; 
      }

      // Attempt to extract full Org Code from display name using regex
      const extractedOrg = extractOrgCodeFromName_(name);
      if (extractedOrg) {
          orgCode = extractedOrg;
      }

      if (name && email) {
        return { name: name, email: email, workgroup: workgroup, orgCode: orgCode };
      }
      return null;
    }).filter(Boolean); // Filter out any null results

  } catch (e) {
    console.error(`Directory search failed for query "${query}": ${e.message}`);
    return []; // Return an empty array on error
  }
}
/**
 * Adds a person to the 'Stakeholders' sheet if they do not already exist.
 * It checks for existence based on the email address.
 * @param {object} personInfo An object with {name, email, workgroup, orgCode}.
 */
function addOrUpdateStakeholder(personInfo) {
  // 1. Basic validation
  if (!personInfo || !personInfo.email) {
    console.error("addOrUpdateStakeholder called with invalid personInfo.");
    return;
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const stakeholderSheet = ss.getSheetByName('Stakeholders');
    if (!stakeholderSheet) {
      console.error("The 'Stakeholders' sheet was not found. Cannot add new user.");
      return;
    }

    // 2. Check if the stakeholder already exists to avoid duplicates
    // We do this by checking against the email column (Column B)
    let existingEmails = [];
    if (stakeholderSheet.getLastRow() > 1) {
      existingEmails = stakeholderSheet.getRange(2, 2, stakeholderSheet.getLastRow() - 1, 1)
                                      .getValues()
                                      .flat()
                                      .map(e => e.toLowerCase());
    }
    
    const newEmail = personInfo.email.toLowerCase();

    if (existingEmails.includes(newEmail)) {
      console.log(`Stakeholder ${newEmail} already exists. No action needed.`);
      return; // Exit if the user is already in our list
    }

    // 3. If they don't exist, add them as a new row
    console.log(`Adding new stakeholder: ${personInfo.name} (${personInfo.email})`);
    stakeholderSheet.appendRow([
      personInfo.name,
      personInfo.email,
      personInfo.workgroup || '', // Ensure we write a blank string if undefined
      personInfo.orgCode || ''
    ]);

  } catch (e) {
    console.error(`Failed to add or update stakeholder ${personInfo.email}. Error: ${e.message}`);
  }
}
/**
 * Allows an authenticated guest to add a note to an item they are associated with.
 * Uses exact email matching via Stakeholders for the security check.
 * @param {string} itemId The ID of the item to comment on.
 * @param {string} commentText The text of the comment.
 * @returns {object} A success or error message.
 */
function addGuestComment(itemId, commentText) {
  if (!itemId || !commentText || commentText.trim() === '') {
    throw new Error("Invalid input. Comment text cannot be empty.");
  }

  try {
    const userEmail = Session.getActiveUser().getEmail().toLowerCase().trim();
    const { emailToName, nameToEmail } = buildStakeholderMap_();
    const userDisplayName = emailToName.get(userEmail) || userEmail;

    // Fetch the item
    const item = getProjectsData_(true).projects.find(p => p.ID === itemId);
    if (!item) throw new Error("Item not found.");

    // Security check using the same exact matching logic
    const hasAccess = isUserOnCard_(
      userEmail,
      userDisplayName.toLowerCase(),
      nameToEmail,
      item.Owner,
      item.Requestor,
      item.Assigned
    );

    if (!hasAccess) {
      console.warn(`Access denied: ${userEmail} attempted to comment on ${itemId}`);
      throw new Error("Access Denied. You are not associated with this item.");
    }

    // Format and save the note
    const displayName = emailToName.get(userEmail) || userEmail;
    const note = `[GUEST COMMENT by ${displayName}]:\n${commentText}`;
    addNote(itemId, note, displayName);

    // Update Status Summary
    const today = new Date().toLocaleDateString();
    const newSummaryText = `Guest Comment by ${displayName}: ${commentText}`;
    const logEntry = `[${today}] ${newSummaryText}\n${item.StatusSummaryLog || item.StatusSummary || ''}`;
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    for (const sName of sheets) {
      const sh = ss.getSheetByName(sName);
      if (!sh) continue;
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const sumCol = headers.indexOf('StatusSummary') + 1;
      const logCol = headers.indexOf('StatusSummaryLog') + 1;
      
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(itemId)) {
          if (sumCol > 0) sh.getRange(i + 1, sumCol).setValue(newSummaryText);
          if (logCol > 0) sh.getRange(i + 1, logCol).setValue(logEntry);
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // Notify internal owner
    if (item.Owner) {
      const ownerEmail = nameToEmail.get(item.Owner.toLowerCase().trim());
      const recipientEmails = ownerEmail
        ? [ownerEmail]
        : resolveRecipientEmails_([item.Owner]);

      if (recipientEmails.length > 0) {
        const subject = `New Comment on Task: ${item.Title}`;
        const body = `${displayName} has added a comment to "${item.Title}" (${itemId}).\n\nComment:\n"${commentText}"`;
        sendMaskedEmail_({ to: recipientEmails.join(','), subject: subject, body: body });
        sendToChat_(
          `*New Guest Comment* on *${item.Title}* (${itemId}) from *${displayName}*.\n> ${commentText}`,
          'notification'
        );
      }
    }

    return { success: true, message: "Comment added successfully." };

  } catch (e) {
    console.error(`Error in addGuestComment: ${e.message}`);
    throw new Error(`Could not add comment: ${e.message}`);
  }
}
/**
 * Gets the display name of the currently logged-in user for the Intake Form.
 * @returns {string} The user's full display name or their email as a fallback.
 */
function getLoggedInUserName() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const person = People.People.get('people/me', { personFields: 'names' });
    if (person && person.names && person.names.length > 0) {
      return person.names[0].displayName;
    }
    return userEmail; // Fallback to email if name is not found
  } catch (e) {
    console.error(`Could not get user's name via People API: ${e.message}`);
    return Session.getActiveUser().getEmail(); // Secure fallback
  }
}

/**
 * Receives form data from the Intake Form and adds it to the Intake_Queue sheet.
 * @param {object} formData The data object from the form.
 * @returns {object} A success message.
 */
function submitNewAction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const intakeSheet = ss.getSheetByName('Intake_Queue');
    if (!intakeSheet) {
      throw new Error("Intake_Queue sheet not found. Please create it.");
    }

    let bodyForNotes = '';
    if (formData.primaryDoc) {
      bodyForNotes += `Final Deliverable Link: ${formData.primaryDoc}\n\n`;
    }
    if (formData.background) {
      bodyForNotes += `Background: ${formData.background}\n\n`;
    }
    if (formData.links) {
      bodyForNotes += '--- Links Provided ---\n' + formData.links;
    }
    // Add apostrophe to prevent accidental formula injection
    bodyForNotes = "'" + bodyForNotes;

    // This array now matches the full column structure of your Intake_Queue sheet
    intakeSheet.appendRow([
      new Date(),                     // A: Date Received
      formData.requestor,             // B: Sender
      formData.title,                 // C: Subject
      bodyForNotes,                   // D: Body (as a backup/note)
      formData.type || 'Task',        // E: Type
      'Medium',                       // F: Urgency
      'Pending Review',               // G: Status
      '',                             // H: Summary
      '',                             // I: ThreadID (blank for form submissions)
      formData.approverRole || '',    // J: ApprovalType (mapped to approverRole)
      formData.priorApprover || '',   // K: PriorApprover
      formData.background || '',      // L: Background
      formData.dueDate || ''          // M: SuggestedDueDate
    ]);

    return { success: true, message: "Thank you! Your action item has been successfully submitted." };
  } catch (e) {
    console.error(`Error in submitNewAction: ${e.message}`);
    throw new Error("An error occurred while submitting your action. Please contact the administrator.");
  }
}
/**
 * Records an approval for a specific role (e.g., FCA, AC) and moves the item
 * to the next logical status in the executive workflow.
 * @param {string} itemId The ID of the task being approved.
 * @param {string} approverRole The role of the approver (e.g., 'FCA', 'FCB', 'AC').
 * @param {string} notes The notes provided by the approver.
 * @returns {object} A success object.
 */
function recordApproval(itemId, approverRole, notes) {
  if (!itemId || !approverRole) throw new Error("Item ID and Approver Role are required.");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Tasks');
  if (!sheet) throw new Error("Tasks sheet not found.");

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  let row = -1;
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === itemId) {
      row = i + 2;
      break;
    }
  }
  if (row === -1) throw new Error("Task with ID " + itemId + " not found.");
  
  const today = new Date();
  const user = Session.getActiveUser().getEmail().split('@')[0];
  const approvalLogEntry = `${approverRole} (${user}) - ${today.toLocaleDateString()}`;

  // PERF-09: Read the entire row once, mutate in-memory, write back in a single setValues().
  // Replaces 3-4 individual getValue/setValue calls with 1 read + 1 write.
  const numCols = sheet.getMaxColumns();
  const existingRow = sheet.getRange(row, 1, 1, numCols).getValues()[0];

  // Update prior approver history (col 27 → index 26)
  const existingApprovers = existingRow[26] || '';
  existingRow[26] = existingApprovers ? `${existingApprovers}; ${approvalLogEntry}` : approvalLogEntry;

  let nextExecStatus = '';
  switch (approverRole) {
    case 'FCA':
      existingRow[28] = today;  // col 29
      existingRow[29] = notes;  // col 30
      nextExecStatus = 'AC Review';
      break;
    case 'FCB':
      existingRow[30] = today;  // col 31
      existingRow[31] = notes;  // col 32
      nextExecStatus = 'AC Review';
      break;
    case 'FCC':
      existingRow[32] = today;  // col 33
      existingRow[33] = notes;  // col 34
      nextExecStatus = 'AC Review';
      break;
    case 'AC':
      existingRow[34] = today;  // col 35
      existingRow[35] = notes;  // col 36
      nextExecStatus = 'Approved';
      break;
    default:
      throw new Error("Invalid approver role specified.");
  }

  if (nextExecStatus) {
    existingRow[10] = nextExecStatus; // col 11 (ExecStatus)
  }

  sheet.getRange(row, 1, 1, numCols).setValues([existingRow]);
  
  return { success: true };
}
/**
 * Fetches only guest-visible comments for a given item.
 * Bypasses the admin-only check in getNotes().
 * @param {string} projectId The item ID to fetch notes for.
 * @returns {Array} Array of note objects visible to guests.
 * @private
 */
function getGuestNotes_(projectId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Notes');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const notes = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== String(projectId).trim()) continue;
    const noteText = data[i][4] || '';
    if (noteText.startsWith('[GUEST COMMENT')) {
      notes.push({
        timestamp: new Date(data[i][2]).toLocaleString(),
        author: data[i][3],
        text: noteText
      });
    }
  }

  return notes.reverse();
}
/**
 * Builds a lookup map from the Stakeholders sheet.
 * @returns {{emailToName: Map, nameToEmail: Map}} Two-way lookup maps.
 * @private
 */
function buildStakeholderMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Stakeholders');
  const emailToName = new Map();
  const nameToEmail = new Map();

  if (!sheet || sheet.getLastRow() < 2) return { emailToName, nameToEmail };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  data.forEach(row => {
    const name = (row[0] || '').toString().trim().toLowerCase();
    const email = (row[1] || '').toString().trim().toLowerCase();
    if (name && email) {
      emailToName.set(email, name);
      nameToEmail.set(name, email);
    }
  });

  return { emailToName, nameToEmail };
}
/**
 * Determines if a user is associated with a card using exact matching only.
 * Matching strategy (in order):
 *   1. Email exact match against any field value resolved via Stakeholders
 *   2. Display name exact match (case-insensitive) against card fields
 *
 * @param {string} userEmail - The authenticated user's email (lowercase).
 * @param {string} userDisplayName - The user's display name from Stakeholders (lowercase).
 * @param {Map} nameToEmail - Map of display name → email from Stakeholders.
 * @param {...string} cardFields - The card field values to check (Owner, Requestor, Assigned).
 * @returns {boolean}
 * @private
 */
function isUserOnCard_(userEmail, userDisplayName, nameToEmail, ...cardFields) {
  // Helper: extract bare email from "Name <email>" format stored by directory autocomplete
  const extractBareEmail = (str) => {
    const match = str.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase().trim() : null;
  };

  // Helper: extract just the display-name portion from "Name <email>" format
  const extractDisplayName = (str) => {
    const match = str.match(/^(.+?)\s*<[^>]+>$/);
    return match ? match[1].toLowerCase().trim() : null;
  };

  // Flatten and clean all values from card fields.
  // Assigned can be comma-separated (e.g. "Alice Smith <a@b.com>, Bob Jones <b@c.com>")
  // NOTE: We must NOT split on commas inside angle brackets, so we split then re-join tokens
  // that were accidentally split mid-"Name <email>" entry. In practice the autocomplete always
  // appends a trailing ", " after each selection so each token is self-contained.
  const rawTokens = cardFields
    .filter(Boolean)
    .flatMap(field => field.split(','))
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);

  for (const token of rawTokens) {
    // Extract email from "Name <email>" if present
    const embeddedEmail = extractBareEmail(token);
    const embeddedName  = extractDisplayName(token);

    // Strategy 1a: Direct embedded email match (handles "Name <email>" format from autocomplete)
    if (embeddedEmail && embeddedEmail === userEmail) {
      return true;
    }

    // Strategy 1b: Resolve the plain name portion to an email via Stakeholders map
    const nameToLookup = embeddedName || token;
    const resolvedEmail = nameToEmail.get(nameToLookup);
    if (resolvedEmail && resolvedEmail === userEmail) {
      return true;
    }

    // Strategy 2: If no email can be resolved, fall back to exact display name match
    if (!resolvedEmail && !embeddedEmail && userDisplayName && token === userDisplayName) {
      return true;
    }

    // Strategy 3: Token is stored as a bare email directly
    if (!embeddedEmail && token === userEmail) {
      return true;
    }
  }

  return false;
}
/**
 * Public wrapper around getGuestNotes_() for use by google.script.run.
 * Safe to call from the Guest Portal frontend.
 * @param {string} projectId The item ID to fetch notes for.
 * @returns {Array} Guest-visible notes for the item.
 */
function getGuestNotesForItem(projectId) {
  if (!projectId) return [];
  try {
    return getGuestNotes_(projectId);
  } catch (e) {
    console.error(`Error in getGuestNotesForItem: ${e.message}`);
    return [];
  }
}
/**
 * Checks a list of display names against the Stakeholders sheet
 * and adds any that are missing via a directory lookup.
 * Called automatically when a card is saved.
 * @param {string[]} names Array of display names to check.
 * @private
 */
function ensureStakeholdersRegistered_(names) {
  if (!names || names.length === 0) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Stakeholders');
  if (!sheet) return;

  // Build current email set for fast duplicate checking
  const existingEmails = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 2, sheet.getLastRow() - 1, 1)
      .getValues()
      .flat()
      .forEach(e => { if (e) existingEmails.add(e.toLowerCase().trim()); });
  }

  // Clean and deduplicate the incoming names
  const uniqueNames = [...new Set(
    names
      .flatMap(n => n.split(','))
      .map(n => n.trim())
      .filter(Boolean)
  )];

  uniqueNames.forEach(name => {
    let emailToSave = name.includes('@') ? name.trim() : null;
    let query = name;
    
    // If it contains a bracketed email like "Name <email>", extract just the email
    const emailMatch = name.match(/<([^>]+)>/);
    if (emailMatch) {
       emailToSave = emailMatch[1].trim();
       query = emailToSave;
    } else if (name.includes('@')) {
       emailToSave = name.trim();
       query = emailToSave;
    }

    try {
      const result = People.People.searchDirectoryPeople({
        query: name,
        readMask: 'names,emailAddresses,organizations',
        sources: [
          'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT',
          'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'
        ]
      });

      if (!result || !result.people || result.people.length === 0) {
        console.warn(`ensureStakeholdersRegistered_: No directory match for "${query}"`);
        // Fallback: If they provided an email but directory failed, save just the email
        if (emailToSave && !existingEmails.has(emailToSave.toLowerCase())) {
            sheet.appendRow([emailToSave, emailToSave, '', '']);
            existingEmails.add(emailToSave.toLowerCase());
        }
        return;
      }

      const person = result.people[0];
      const resolvedEmail = person.emailAddresses?.[0]?.value?.toLowerCase() || emailToSave?.toLowerCase();
      
      if (!resolvedEmail || existingEmails.has(resolvedEmail)) return;

      let displayName = person.names?.[0]?.displayName || name;
      let workgroup = person.organizations?.[0]?.name || '';
      let orgCode = person.organizations?.[0]?.department || '';

      // Attempt to extract full Org Code from displayName using regex
      const extractedOrg = extractOrgCodeFromName_(displayName);
      if (extractedOrg) {
          orgCode = extractedOrg;
      }

      sheet.appendRow([displayName, resolvedEmail, workgroup, orgCode]);
      existingEmails.add(resolvedEmail); // Prevent duplicates within same save operation
      console.log(`ensureStakeholdersRegistered_: Added ${displayName} (${resolvedEmail})`);

    } catch (e) {
      console.error(`ensureStakeholdersRegistered_: Failed for "${name}": ${e.message}`);
    }
  });

  // Sync the updated email list to ScriptProperties for lightning fast getAccessLevel_() execution
  try {
    PropertiesService.getScriptProperties().setProperty('sharedUserList', JSON.stringify(Array.from(existingEmails)));
  } catch (e) {
    console.error('Failed to sync sharedUserList to properties:', e.message);
  }
}
/**
 * Creates the Report_Templates sheet if it does not exist.
 * Run once manually from the script editor.
 */
function setupReportTemplatesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('Report_Templates')) {
    Logger.log('Report_Templates sheet already exists.');
    return;
  }
  const sheet = ss.insertSheet('Report_Templates');
  sheet.appendRow([
    'Template_ID', 'Name', 'Filters_JSON', 'Output_Type',
    'Recipients', 'Schedule', 'Next_Run', 'Last_Run',
    'Output_FolderID',
    'Schedule_DOW',   // Day of week (0=Sun, 1=Mon ... 6=Sat)
    'Schedule_DOM',   // Day of month (1-28)
    'Schedule_Hour'   // Hour of day (0-23)
  ]);
  sheet.setFrozenRows(1);
  Logger.log('Report_Templates sheet created.');
}
/**
 * Returns all saved report templates.
 * @returns {Array} Array of template objects.
 */
function getReportTemplates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Report_Templates');
  if (!sheet || sheet.getLastRow() < 2) return [];

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 13) // Now 13 columns
    .getValues()
    .filter(r => r[0])
    .map(r => ({
      id:             r[0],
      name:           r[1],
      filters:        safeJsonParse_(r[2], {}),
      outputType:     r[3],
      recipients:     r[4],
      schedule:       r[5],
      nextRun:        r[6] ? new Date(r[6]).toISOString().split('T')[0] : '',
      lastRun:        r[7] ? new Date(r[7]).toLocaleString() : 'Never',
      outputFolderId: r[8]  || '',
      scheduleDow:    r[9]  !== '' ? parseInt(r[9])  : 1,
      scheduleDom:    r[10] !== '' ? parseInt(r[10]) : 1,
      scheduleHour:   r[11] !== '' ? parseInt(r[11]) : 8,
      emailMessage:   r[12] || ''   // ← New field
    }));
}

/**
 * Saves a new or updated report template.
 * @param {object} template The template object from the frontend.
 * @returns {{success: boolean, id: string}}
 */
function saveReportTemplate(template) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Report_Templates');
  if (!sheet) {
    setupReportTemplatesSheet();
    sheet = ss.getSheetByName('Report_Templates');
  }

  const id = template.id || `RPT-${Date.now()}`;

  const nextRun = calculateNextRunDate_(
    template.schedule,
    template.scheduleDow,
    template.scheduleDom,
    template.scheduleHour
  );

  const rowData = [
    id,
    template.name        || 'Unnamed Report',
    JSON.stringify(template.filters || {}),
    template.outputType  || 'Doc',
    template.recipients  || '',
    template.schedule    || 'None',
    nextRun,
    '',                               // Last_Run
    template.outputFolderId || '',
    template.scheduleDow  || 1,
    template.scheduleDom  || 1,
    template.scheduleHour || 8,
    template.emailMessage || ''       // ← Column M
  ];

  if (sheet.getLastRow() > 1) {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) {
        sheet.getRange(i + 2, 1, 1, rowData.length).setValues([rowData]);
        return { success: true, id };
      }
    }
  }

  sheet.appendRow(rowData);
  return { success: true, id };
}
/**
 * Deletes a report template by ID.
 * @param {string} id The template ID to delete.
 * @returns {{success: boolean}}
 */
function deleteReportTemplate(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Report_Templates');
  if (!sheet || sheet.getLastRow() < 2) return { success: false };

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) {
      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }
  return { success: false };
}
/**
 * Main entry point for generating a report.
 * Called from the frontend Run Now button or the scheduled trigger.
 * @param {string} templateId The ID of the template to run.
 * @returns {{success: boolean, docUrl: string, sheetUrl: string}}
 */
function generateReport(templateId) {
  const templates = getReportTemplates();
  const template = templates.find(t => t.id === templateId);
  if (!template) throw new Error(`Template "${templateId}" not found.`);

  // 1. Pull and filter data
  const data = getFilteredReportData_(template.filters);

  // 2. Handle empty results
  if (data.length === 0) {
    updateReportLastRun_(templateId);
    if (template.recipients && template.recipients.trim()) {
      sendEmptyReportNotification_(template);
    }
    return {
      success: true,
      docUrl: '',
      sheetUrl: '',
      message: 'No items matched the selected filters. Recipients have been notified.'
    };
  }

  // 3. Ensure output folder exists
  const folderId = ensureReportFolder_(template);

  // 4. Generate outputs
  let docUrl = '';
  let sheetUrl = '';
  let docId = '';
  let sheetId = '';
  const reportTitle = `${template.name} — ${new Date().toLocaleDateString()}`;

  if (template.outputType === 'Doc' || template.outputType === 'Both') {
    docUrl = generateReportDoc_(data, reportTitle, template.filters, folderId);
    // Extract file ID from URL for sharing
    const docIdMatch = docUrl.match(/\/d\/([\w-]+)/);
    if (docIdMatch) docId = docIdMatch[1];
  }

  if (template.outputType === 'Sheet' || template.outputType === 'Both') {
    sheetUrl = generateReportSheet_(data, reportTitle, template.filters, folderId);
    const sheetIdMatch = sheetUrl.match(/\/d\/([\w-]+)/);
    if (sheetIdMatch) sheetId = sheetIdMatch[1];
  }

  // 5. Share files with recipients
  if (template.recipients && template.recipients.trim()) {
    const recipientEmails = template.recipients
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);

    shareReportFiles_(recipientEmails, docId, sheetId);
  }

  // 6. Send email
  if (template.recipients && template.recipients.trim()) {
    sendReportEmail_(template, reportTitle, docUrl, sheetUrl, data.length);
  }

  // 7. Update Last_Run
  updateReportLastRun_(templateId);

  return {
    success: true,
    docUrl,
    sheetUrl,
    message: `Report generated with ${data.length} items.`
  };
}

/**
 * Filters the project/task data based on report template filters.
 * @param {object} filters The filters object from the template.
 * @returns {Array} Filtered array of items.
 * @private
 */
function getFilteredReportData_(filters) {
  const allItems = getProjectsData_(filters.includeArchived || false).projects;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return allItems.filter(item => {

    // Owner filter
    if (filters.owners && filters.owners.length > 0) {
      if (!filters.owners.some(o => (item.Owner || '').includes(o))) return false;
    }

    // Assigned team member filter
    // Assigned field can be comma-separated e.g. "Alice, Bob, Carol"
    // Item matches if ANY of the selected members appear in the Assigned field
    if (filters.assignedMembers && filters.assignedMembers.length > 0) {
      const itemAssigned = (item.Assigned || '')
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);
      const hasMatch = filters.assignedMembers.some(member =>
        itemAssigned.some(a =>
          a.toLowerCase() === member.toLowerCase()
        )
      );
      if (!hasMatch) return false;
    }

    // Type filter
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.includes(item.Type)) return false;
    }

    // Status filter
    if (filters.statuses && filters.statuses.length > 0) {
      if (!filters.statuses.includes(item.Status)) return false;
    }

    // Exec Status filter
    if (filters.execStatus && filters.execStatus !== '') {
      if (item.ExecStatus !== filters.execStatus) return false;
    }

    // Date range filter
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      if (!item.IntDue || new Date(item.IntDue) < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      if (!item.IntDue || new Date(item.IntDue) > to) return false;
    }

    // Overdue only filter
    if (filters.overdueOnly) {
      if (!item.DueDate) return false;
      const due = new Date(item.DueDate);
      due.setHours(0, 0, 0, 0);
      if (due >= today || item.Status === 'Done') return false;
    }

    return true;
  });
}
/**
 * Generates a formatted Google Doc report and saves it to the output folder.
 * @param {Array} data Filtered items array.
 * @param {string} title Report title.
 * @param {object} filters The filters used.
 * @param {string} folderId The output folder ID.
 * @returns {string} URL of the created document.
 * @private
 */
/**
 * Generates a formatted Google Doc report with optional logo and configurable fields.
 * @param {Array} data Filtered items array.
 * @param {string} title Report title.
 * @param {object} filters The filters used including field selections.
 * @param {string} folderId The output folder ID.
 * @returns {string} URL of the created document.
 * @private
 */
function generateReportDoc_(data, title, filters, folderId) {
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  const fields = filters.fields || {};

  // Page setup
  body.setPageHeight(792).setPageWidth(612);
  body.setMarginTop(54).setMarginBottom(72)
      .setMarginLeft(72).setMarginRight(72);

 // ── HEADER TABLE ─────────────────────────────────────────────────────────
  // Page margins (must match setMargin values below)
  const PAGE_MARGIN_LEFT = 72;   // 1 inch
  const PAGE_MARGIN_TOP  = 54;   // 0.75 inch

  // Target position in inches from page edge
  const LOGO_X_INCHES = 0.77;
  const LOGO_Y_INCHES = 0.42;

  // Convert to offsets relative to anchor paragraph
  // Offset = (target * 72) - margin
  const logoLeftOffset = (LOGO_X_INCHES * 72) - PAGE_MARGIN_LEFT;
  const logoTopOffset  = (LOGO_Y_INCHES * 72) - PAGE_MARGIN_TOP;

  // Anchor paragraph at position 0
  const anchorPara = body.insertParagraph(0, '');
  anchorPara.setSpacingBefore(0).setSpacingAfter(0);

  let logoInserted = false;
  try {
    const props = PropertiesService.getScriptProperties();
    const logoFileId = (props.getProperty('REPORT_LOGO_FILE_ID') || '').trim();

    if (logoFileId) {
      const file = DriveApp.getFileById(logoFileId);
      const mimeType = file.getMimeType();

      if (mimeType.startsWith('image/')) {
        const logoBlob = file.getBlob();
        const posImage = anchorPara.addPositionedImage(logoBlob);

        // Scale to target height preserving aspect ratio
        const origH = posImage.getHeight();
        const origW = posImage.getWidth();
        const targetH = 60;
        const targetW = Math.round(origW * (targetH / origH));
        posImage.setHeight(targetH).setWidth(targetW);

        // Set position relative to anchor paragraph
        posImage.setLeftOffset(logoLeftOffset);
        posImage.setTopOffset(logoTopOffset);
        posImage.setLayout(DocumentApp.PositionedLayout.BREAK_BOTH);

        logoInserted = true;
        console.log(`Logo inserted at offset L:${logoLeftOffset} T:${logoTopOffset}`);
      } else {
        console.warn(`Logo file is ${mimeType} — not an image. Skipping.`);
      }
    }
  } catch (e) {
    console.warn(`Logo insertion failed: ${e.message}`);
  }

  // ── TITLE BLOCK ──────────────────────────────────────────────────────────

  const generatedBy = Session.getActiveUser().getEmail().split('@')[0]
    .split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  // Title — centered
  const titlePara = body.appendParagraph(title);
  titlePara.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  titlePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  titlePara.setSpacingBefore(0).setSpacingAfter(6);

  // Generated date — centered
  body.appendParagraph(`Generated: ${new Date().toLocaleString()}   |   Total Items: ${data.length}`)
      .setFontSize(9)
      .setForegroundColor('#5f6368')
      .setItalic(true)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .setSpacingAfter(1);

  body.appendHorizontalRule();

  // ── CONTENT ─────────────────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const fmtDate = (dStr) => {
    if (!dStr) return '';
    try {
      return new Date(dStr).toLocaleDateString('en-US', { timeZone: 'UTC' });
    } catch(e) { return dStr; }
  };

  // Group by Status
  const config = loadConfig_();
  const statusOrder = config.stages || [];
  const groups = {};
  statusOrder.forEach(s => groups[s] = []);
  data.forEach(item => {
    const s = item.Status || 'Unknown';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  });

  for (const status of statusOrder) {
    const items = groups[status];
    if (!items || items.length === 0) continue;

    body.appendParagraph(`\n${status} (${items.length})`)
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    items.forEach(item => {
      try {
        // Color strip logic
        let itemColor = '#1a73e8';
        if (item.Status === 'Done' || item.Status === 'Cancelled') {
          itemColor = '#188038';
        } else if (item.DueDate) {
          const due = new Date(item.DueDate); due.setHours(0,0,0,0);
          const diff = (due - today) / (1000 * 60 * 60 * 24);
          if (diff < 0)     itemColor = '#d93025';
          else if (diff <= 3) itemColor = '#f9ab00';
        }

        const table = body.appendTable();
        table.setBorderWidth(0.5).setBorderColor('#CCCCCC');
        const row = table.appendTableRow();

        // Color strip cell
        row.appendTableCell('').setWidth(8).setBackgroundColor(itemColor);

        // Content cell
        const cell = row.appendTableCell();
        cell.setPaddingLeft(10).setPaddingRight(10).setPaddingTop(6).setPaddingBottom(6);

        // ── Title line ──
        const titleLine = `[${item.ID}] ${item.Title}`;
        cell.appendParagraph(titleLine)
            .setBold(true)
            .setFontSize(10);

        // ── Meta line 1: Type / Owner / Assigned ──
        const meta1Parts = [];
        if (fields.type !== false)     meta1Parts.push(`Type: ${item.Type || '—'}`);
        if (fields.owner !== false)    meta1Parts.push(`Owner: ${item.Owner || 'Unassigned'}`);
        if (fields.assigned !== false && item.Assigned) {
          meta1Parts.push(`Team: ${item.Assigned}`);
        }
        if (meta1Parts.length > 0) {
          cell.appendParagraph(meta1Parts.join('   |   '))
              .setFontSize(9)
              .setForegroundColor('#333333');
        }

        // ── Meta line 2: Dates ──
        const dateParts = [];
        if (fields.recDate && item.RecDate) {
          dateParts.push(`Received: ${fmtDate(item.RecDate)}`);
        }
        if (fields.intDue !== false && item.IntDue) {
          dateParts.push(`Internal Due: ${fmtDate(item.IntDue)}`);
        }
        if (fields.dueDate !== false && item.DueDate) {
          dateParts.push(`Final Due: ${fmtDate(item.DueDate)}`);
        }
        if (dateParts.length > 0) {
          cell.appendParagraph(dateParts.join('   |   '))
              .setFontSize(9)
              .setForegroundColor('#333333');
        }

        // ── Meta line 3: Exec Status / Urgency / Complexity ──
        const meta3Parts = [];
        if (fields.execStatus !== false && item.ExecStatus) {
          meta3Parts.push(`Exec: ${item.ExecStatus}`);
        }
        if (fields.urgency && item.Urgency) {
          meta3Parts.push(`Urgency: ${item.Urgency}`);
        }
        if (fields.complexity && item.Complexity) {
          meta3Parts.push(`Complexity: ${item.Complexity}`);
        }
        if (meta3Parts.length > 0) {
          cell.appendParagraph(meta3Parts.join('   |   '))
              .setFontSize(9)
              .setForegroundColor('#555555');
        }

        // ── Requestor / Data Call No ──
        const meta4Parts = [];
        if (fields.requestor && item.Requestor) {
          meta4Parts.push(`Requestor: ${item.Requestor}`);
        }
        if (fields.dataCallNo && item.DataCallNo) {
          meta4Parts.push(`Data Call #: ${item.DataCallNo}`);
        }
        if (meta4Parts.length > 0) {
          cell.appendParagraph(meta4Parts.join('   |   '))
              .setFontSize(9)
              .setForegroundColor('#555555');
        }

        // ── Status Summary ──
        if (fields.statusSummary !== false && item.StatusSummary) {
          cell.appendParagraph(`📋 ${item.StatusSummary}`)
              .setItalic(true)
              .setFontSize(9)
              .setForegroundColor('#1155CC');
        }

        // ── Drive Links / Attachments ──
        if (fields.driveLinks !== false && item.DriveLink) {
          cell.appendParagraph('Attachments / Links:')
              .setFontSize(9)
              .setForegroundColor('#333333');

          const links = item.DriveLink.split('\n').filter(Boolean);
          links.forEach(link => {
            const urlMatch = link.match(/https?:\/\/\S+/);
            const textPart = urlMatch
              ? link.replace(urlMatch[0], '').trim() || urlMatch[0]
              : link;
            const url = urlMatch ? urlMatch[0] : '';

            const linkItem = cell.appendListItem(textPart);
            linkItem.setGlyphType(DocumentApp.GlyphType.BULLET);
            if (url) linkItem.setLinkUrl(url);
            linkItem.setFontSize(8).setForegroundColor('#0b5394');
          });
        }

        body.appendParagraph(''); // Spacer

      } catch (err) {
        console.error(`Skipped item ${item.ID}: ${err.message}`);
        body.appendParagraph(`[Error rendering item ${item.ID}]`)
            .setItalic(true)
            .setForegroundColor('#FF0000');
      }
    });
  }

  doc.saveAndClose();

  // Move to output folder
  if (folderId) {
    try {
      DriveApp.getFileById(doc.getId())
              .moveTo(DriveApp.getFolderById(folderId));
    } catch (e) {
      console.error(`Could not move report doc: ${e.message}`);
    }
  }

  return doc.getUrl();
}

/**
 * Generates a Google Sheet report and saves it to the output folder.
 * @param {Array} data Filtered items array.
 * @param {string} title Report title.
 * @param {object} filters The filters used.
 * @param {string} folderId The output folder ID.
 * @returns {string} URL of the created spreadsheet.
 * @private
 */
/**
 * Generates a Google Sheet report with configurable columns.
 * @param {Array} data Filtered items array.
 * @param {string} title Report title.
 * @param {object} filters The filters used including field selections.
 * @param {string} folderId The output folder ID.
 * @returns {string} URL of the created spreadsheet.
 * @private
 */
function generateReportSheet_(data, title, filters, folderId) {
  const ss = SpreadsheetApp.create(title);
  const sheet = ss.getActiveSheet();
  sheet.setName('Report');
  const fields = filters.fields || {};

  // Build dynamic column list based on field selection
  const columns = [
    { key: 'ID',            label: 'ID',               always: true },
    { key: 'Title',         label: 'Title',             always: true },
    { key: 'Status',        label: 'Status',            always: true },
    { key: 'Type',          label: 'Type',              field: 'type' },
    { key: 'Owner',         label: 'Owner',             field: 'owner' },
    { key: 'Assigned',      label: 'Assigned Team',     field: 'assigned' },
    { key: 'ExecStatus',    label: 'Exec Status',       field: 'execStatus' },
    { key: 'IntDue',        label: 'Internal Due',      field: 'intDue' },
    { key: 'DueDate',       label: 'Final Due',         field: 'dueDate' },
    { key: 'RecDate',       label: 'Received Date',     field: 'recDate' },
    { key: 'Urgency',       label: 'Urgency',           field: 'urgency' },
    { key: 'Complexity',    label: 'Complexity',        field: 'complexity' },
    { key: 'Requestor',     label: 'Requestor',         field: 'requestor' },
    { key: 'DataCallNo',    label: 'Data Call No.',     field: 'dataCallNo' },
    { key: 'StatusSummary', label: 'Status Summary',    field: 'statusSummary' },
    { key: 'DriveLink',     label: 'Attachments/Links', field: 'driveLinks' }
  ].filter(col =>
    col.always ||
    fields[col.field] === true ||
    (fields[col.field] === undefined && [
      'type','owner','assigned','execStatus','intDue','dueDate','statusSummary','driveLinks'
    ].includes(col.field))
  );

  // Header row
  const headers = columns.map(c => c.label);
  sheet.appendRow(headers);

  // Style header
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground('#005ea2')
             .setFontColor('#ffffff')
             .setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Data rows
  const allRows = [];
  data.forEach(item => {
    const row = columns.map(col => {
      const val = item[col.key] || '';
      return val;
    });
    allRows.push(row);
  });
  
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, columns.length).setValues(allRows);
  }

  // Auto-resize columns
  sheet.autoResizeColumns(1, headers.length);

  // Metadata sheet
  const metaSheet = ss.insertSheet('Report Info');
  const metaData = [
    ['Report Name', title],
    ['Generated', new Date().toLocaleString()],
    ['Total Items', data.length],
    ['Fields Included', headers.join(', ')],
    ['Filters Applied', JSON.stringify(filters, null, 2)]
  ];
  metaSheet.getRange(1, 1, metaData.length, 2).setValues(metaData);

  // Move to output folder
  if (folderId) {
    try {
      DriveApp.getFileById(ss.getId())
              .moveTo(DriveApp.getFolderById(folderId));
    } catch (e) {
      console.error(`Could not move report sheet: ${e.message}`);
    }
  }

  return ss.getUrl();
}
/**
 * Sends the report email with links to generated files.
 * @param {object} template The report template.
 * @param {string} reportTitle The report title.
 * @param {string} docUrl URL of the Google Doc (or empty string).
 * @param {string} sheetUrl URL of the Google Sheet (or empty string).
 * @param {number} itemCount Number of items in the report.
 * @private
 */
function sendReportEmail_(template, reportTitle, docUrl, sheetUrl, itemCount) {
  const recipients = template.recipients
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);

  if (recipients.length === 0) return;

  // Custom message block
  const customMessageHtml = template.emailMessage
    ? `<div style="background:#f8f9fa; border-left:4px solid #005ea2;
                   padding:12px 15px; margin:15px 0;
                   border-radius:0 4px 4px 0;">
         <p style="margin:0; font-size:0.95rem; color:#202124; line-height:1.5;">
           ${template.emailMessage.replace(/\n/g, '<br>')}
         </p>
       </div>`
    : '';

  const customMessageText = template.emailMessage
    ? `\n${template.emailMessage}\n\n`
    : '';

  // Button-style links — no emoji, clear call to action
  let linksHtml = '';
  let linksText = '';

  if (docUrl) {
    linksHtml += `
      <a href="${docUrl}"
         style="display:inline-block; background:#005ea2; color:#ffffff;
                text-decoration:none; padding:10px 20px; border-radius:4px;
                font-weight:bold; font-size:0.9rem; margin-right:10px;
                margin-bottom:10px;">
        Open Google Doc Report
      </a>`;
    linksText += `Google Doc Report:\n${docUrl}\n\n`;
  }

  if (sheetUrl) {
    linksHtml += `
      <a href="${sheetUrl}"
         style="display:inline-block; background:#188038; color:#ffffff;
                text-decoration:none; padding:10px 20px; border-radius:4px;
                font-weight:bold; font-size:0.9rem; margin-bottom:10px;">
        Open Google Sheet Report
      </a>`;
    linksText += `Google Sheet Report:\n${sheetUrl}\n\n`;
  }

  const htmlBody = `
    <html>
    <body style="font-family:Arial, sans-serif; max-width:600px;
                 margin:0 auto; color:#202124;">

      <!-- Header -->
      <div style="background:#005ea2; padding:20px 25px;
                  border-radius:6px 6px 0 0;">
        <h2 style="color:white; margin:0; font-size:1.1rem;
                   font-weight:600;">
          ${reportTitle}
        </h2>
      </div>

      <!-- Body -->
      <div style="border:1px solid #dadce0; border-top:none; padding:25px;
                  border-radius:0 0 6px 6px; background:#ffffff;">

        <p style="margin-top:0; color:#5f6368; font-size:0.95rem;">
          Your report has been generated containing
          <strong style="color:#202124;">
            ${itemCount} item${itemCount !== 1 ? 's' : ''}
          </strong>.
        </p>

        ${customMessageHtml}

        <!-- Link buttons -->
        <div style="margin:20px 0;">
          <p style="font-weight:600; margin-bottom:12px; color:#202124;">
            Click below to open your report:
          </p>
          ${linksHtml}
        </div>

        <hr style="border:none; border-top:1px solid #dadce0; margin:20px 0;">

        <p style="color:#9aa0a6; font-size:0.8rem; margin:0; line-height:1.5;">
          This report was automatically generated by the ${config.workgroupName || "PMSC"} System.
          ${template.schedule && template.schedule !== 'None'
            ? `<br>Next scheduled run: ${template.nextRun || 'See report settings.'}`
            : ''}
        </p>

      </div>
    </body>
    </html>
  `;

  // Plain text fallback — no emoji, clear URLs
  const plainText =
    `${reportTitle}\n` +
    `${'='.repeat(reportTitle.length)}\n\n` +
    `Your report has been generated with ${itemCount} item${itemCount !== 1 ? 's' : ''}.\n\n` +
    customMessageText +
    `Click the link(s) below to open your report:\n\n` +
    linksText +
    (template.schedule && template.schedule !== 'None'
      ? `Next scheduled run: ${template.nextRun || 'See report settings.'}\n`
      : '') +
    `\nThis report was automatically generated by the ${config.workgroupName || "PMSC"} System.`;

  GmailApp.sendEmail(
    recipients.join(','),
    reportTitle,
    plainText,
    { htmlBody }
  );
}

/**
 * Calculates the next run date for a scheduled report.
 * @param {string} schedule 'None', 'Daily', 'Weekly', or 'Monthly'
 * @param {number} dow Day of week: 0=Sun, 1=Mon, 2=Tue ... 6=Sat (Weekly only)
 * @param {number} dom Day of month: 1-28 (Monthly only)
 * @param {number} hour Hour of day in 24h format (default 8 = 8am)
 * @returns {Date|string} Next scheduled run date or '' for None
 * @private
 */
function calculateNextRunDate_(schedule, dow, dom, hour) {
  if (!schedule || schedule === 'None') return '';

  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const now = new Date();
  const targetHour = (hour !== undefined && hour !== null) ? parseInt(hour) : 8;

  // Start with today at the target hour
  const next = new Date(now);
  next.setHours(targetHour, 0, 0, 0);

  if (schedule === 'Daily') {
    // If today's run time has already passed, schedule for tomorrow
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (schedule === 'Weekly') {
    const targetDow = (dow !== undefined && dow !== null) ? parseInt(dow) : 1; // Default Monday
    const currentDow = next.getDay();
    let daysUntil = (targetDow - currentDow + 7) % 7;
    // If it's the right day but time has passed, go to next week
    if (daysUntil === 0 && next <= now) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (schedule === 'Monthly') {
    const targetDom = (dom !== undefined && dom !== null) ? parseInt(dom) : 1;
    next.setDate(targetDom);
    // If this month's date has already passed, move to next month
    if (next <= now) next.setMonth(next.getMonth() + 1);
    return next;
  }

  return '';
}

/**
 * Updates the Last_Run timestamp for a template after successful generation.
 * @param {string} templateId The template ID to update.
 * @private
 */
function updateReportLastRun_(templateId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Report_Templates');
  if (!sheet || sheet.getLastRow() < 2) return;

  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === templateId) {
      sheet.getRange(i + 2, 8).setValue(new Date()); // Last_Run

      // Read schedule config from this row
      const rowData = sheet.getRange(i + 2, 1, 1, 12).getValues()[0];
      const schedule = rowData[5];
      const dow      = rowData[9];
      const dom      = rowData[10];
      const hour     = rowData[11];

      if (schedule && schedule !== 'None') {
        const nextRun = calculateNextRunDate_(schedule, dow, dom, hour);
        sheet.getRange(i + 2, 7).setValue(nextRun); // Next_Run
      }
      break;
    }
  }
}

/**
 * Ensures the output folder exists for a report template.
 * Creates one in the destination folder if not already set.
 * @param {object} template The report template.
 * @returns {string} The folder ID to use for output.
 * @private
 */
function ensureReportFolder_(template) {
  if (template.outputFolderId) {
    try {
      DriveApp.getFolderById(template.outputFolderId);
      return template.outputFolderId;
    } catch (e) {
      console.warn(`Report folder ID invalid, will create new one: ${e.message}`);
    }
  }

  const config = loadConfig_();
  if (!config.destinationFolderId) {
    console.warn('No destination folder configured. Report saved to root.');
    return '';
  }

  const parentFolder = DriveApp.getFolderById(config.destinationFolderId);
  const reportFolder = parentFolder.createFolder(`Reports — ${template.name}`);

  // Save the new folder ID back to the template
  saveReportTemplate({ ...template, outputFolderId: reportFolder.getId() });

  return reportFolder.getId();
}

/**
 * Scheduled trigger entry point. Runs all reports whose Next_Run date is today or past.
 * Set a daily time-driven trigger pointing to this function.
 */
function runScheduledReports() {
  const templates = getReportTemplates();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`runScheduledReports: Checking ${templates.length} templates`);

  templates.forEach(template => {
    if (!template.nextRun || template.schedule === 'None') return;

    const nextRun = new Date(template.nextRun);
    nextRun.setHours(0, 0, 0, 0);

    if (nextRun <= today) {
      try {
        console.log(`Running scheduled report: "${template.name}"`);
        const result = generateReport(template.id);
        console.log(
          `Completed "${template.name}": ${result.message}`
        );
      } catch (e) {
        console.error(
          `Scheduled report failed for "${template.name}": ${e.message}`
        );
      }
    } else {
      console.log(
        `Skipping "${template.name}" — next run is ${template.nextRun}`
      );
    }
  });

  console.log('runScheduledReports: Complete');
}

/**
 * Safe JSON parse with fallback.
 * @param {string} str JSON string to parse.
 * @param {*} fallback Value to return if parsing fails.
 * @returns {*}
 * @private
 */
function safeJsonParse_(str, fallback) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch (e) {
    return fallback;
  }
}

/**
 * Reusable wrapper for the USAi Chat Completions API.
 * Modeled after OpenAI Chat Completions format.
 *
 * @param {Array} messages Array of {role, content} message objects.
 * @param {object} options Optional overrides: model, temperature, max_tokens.
 * @returns {string} The assistant's response text.
 * @private
 */
function callUsaiApi_(messages, options = {}) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty('USAI_BASE_URL');
  const apiKey = props.getProperty('USAI_API_KEY');

  if (!baseUrl || !apiKey) {
    throw new Error(
      'USAi API not configured. Please set USAI_BASE_URL and USAI_API_KEY ' +
      'in Project Settings > Script Properties.'
    );
  }

  const endpoint = `${baseUrl}/api/v1/chat/completions`;

  const payload = {
    model: options.model || props.getProperty('USAI_DEFAULT_MODEL') || 'claude_4_5_sonnet',
    messages: messages,
    max_tokens: options.max_tokens || 2048,
    temperature: options.temperature !== undefined ? options.temperature : 0.3
  };

  const requestOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'accept': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let response;
  try {
    response = UrlFetchApp.fetch(endpoint, requestOptions);
  } catch (e) {
    throw new Error(`USAi API network error: ${e.message}`);
  }

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    console.error(`USAi API Error ${responseCode}: ${responseText}`);
    throw new Error(`USAi API returned status ${responseCode}. Check logs for details.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (e) {
    throw new Error(`USAi API returned unparseable response: ${responseText.substring(0, 200)}`);
  }

  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('USAi API response was empty or malformed.');
  }

  console.log(
    `USAi API: model=${parsed.model}, ` +
    `tokens=${parsed.usage?.total_tokens || 'unknown'}`
  );

  return content;
}

/**
 * Test function — run from the script editor to verify API connectivity.
 * Results appear in the Execution Log.
 */
function testUsaiApi_() {
  try {
    const response = callUsaiApi_([
      {
        role: 'system',
        content: 'You are a helpful assistant. Reply in exactly one sentence.'
      },
      {
        role: 'user',
        content: 'Confirm that the USAi API connection is working.'
      }
    ]);
    Logger.log('USAi API Test SUCCESS: ' + response);
    // Removed SpreadsheetApp.getUi() — not available in direct execution context
  } catch (e) {
    Logger.log('USAi API Test FAILED: ' + e.message);
  }
}

/**
 * Scans the user's personal inbox and the configured group inbox
 * for unread messages from the last 24 hours.
 * @returns {Array} Array of email summary objects.
 * @private
 */
function scanUnreadEmails_() {
  const emails = [];
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  // --- Personal Inbox ---
  try {
    const personalThreads = GmailApp.search('is:unread newer_than:1d', 0, 20);
    personalThreads.forEach(thread => {
      const msg = thread.getMessages()[0];
      emails.push({
        id: msg.getId(),
        threadId: thread.getId(),
        subject: msg.getSubject() || '(No Subject)',
        from: msg.getFrom(),
        date: msg.getDate().toLocaleString(),
        snippet: msg.getPlainBody().substring(0, 500).trim(),
        isStarred: msg.isStarred(),
        source: 'personal'
      });
    });
  } catch (e) {
    console.error(`Personal inbox scan failed: ${e.message}`);
  }

  // --- Group Inbox ---
  try {
    const config = loadConfig_();
    if (config.groupEmail) {
      const groupEmails = config.groupEmail
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);

      const query = groupEmails.map(e => `to:"${e}"`).join(' OR ');
      const groupThreads = GmailApp.search(
        `(${query}) newer_than:1d`, 0, 20
      );

      groupThreads.forEach(thread => {
        const msg = thread.getMessages()[0];
        // Avoid duplicates already captured in personal scan
        if (!emails.some(e => e.threadId === thread.getId())) {
          emails.push({
            id: msg.getId(),
            threadId: thread.getId(),
            subject: msg.getSubject() || '(No Subject)',
            from: msg.getFrom(),
            date: msg.getDate().toLocaleString(),
            snippet: msg.getPlainBody().substring(0, 500).trim(),
            isStarred: msg.isStarred(),
            source: 'group'
          });
        }
      });
    }
  } catch (e) {
    console.error(`Group inbox scan failed: ${e.message}`);
  }

  // Sort: starred first, then by date descending
  return emails.sort((a, b) => {
    if (a.isStarred && !b.isStarred) return -1;
    if (!a.isStarred && b.isStarred) return 1;
    return new Date(b.date) - new Date(a.date);
  });
}

/**
 * Fetches today's calendar events from the configured calendar.
 * @returns {Array} Array of event objects.
 * @private
 */
function getTodayCalendarEvents_() {
  const events = [];
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    // Primary calendar
    const primaryCal = CalendarApp.getDefaultCalendar();
    primaryCal.getEvents(startOfDay, endOfDay).forEach(event => {
      events.push({
        title: event.getTitle(),
        start: event.getStartTime().toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit'
        }),
        end: event.getEndTime().toLocaleTimeString([], {
          hour: '2-digit', minute: '2-digit'
        }),
        isAllDay: event.isAllDayEvent(),
        location: event.getLocation() || '',
        description: (event.getDescription() || '').substring(0, 200),
        source: 'primary'
      });
    });
  } catch (e) {
    console.error(`Primary calendar scan failed: ${e.message}`);
  }

  try {
    // Configured leave/team calendar if different from primary
    const config = loadConfig_();
    if (config.calendarId) {
      const teamCal = CalendarApp.getCalendarById(config.calendarId);
      if (teamCal) {
        teamCal.getEvents(startOfDay, endOfDay).forEach(event => {
          events.push({
            title: event.getTitle(),
            start: event.isAllDayEvent() ? 'All Day' : event.getStartTime().toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit'
            }),
            end: event.isAllDayEvent() ? '' : event.getEndTime().toLocaleTimeString([], {
              hour: '2-digit', minute: '2-digit'
            }),
            isAllDay: event.isAllDayEvent(),
            location: event.getLocation() || '',
            description: (event.getDescription() || '').substring(0, 200),
            source: 'team'
          });
        });
      }
    }
  } catch (e) {
    console.error(`Team calendar scan failed: ${e.message}`);
  }

  // Sort by start time, all-day events first
  return events.sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return a.start.localeCompare(b.start);
  });
}

/**
 * Pulls Kanban items due today or this week for the current user.
 * @returns {{today: Array, thisWeek: Array, overdue: Array}}
 * @private
 */
function getTodayKanbanItems_() {
  const userEmail = Session.getActiveUser().getEmail().toLowerCase();
  const { emailToName, nameToEmail } = buildStakeholderMap_();
  // PERF-07: buildStakeholderMap_() previously called inside allItems.forEach(),
  // causing one full sheet read per kanban item. Now called once before the loop.
  const userDisplayName = (emailToName.get(userEmail) || '').toLowerCase();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + 7);

  const allItems = getProjectsData_(false).projects;

  const todayItems = [];
  const thisWeekItems = [];
  const overdueItems = [];

  allItems.forEach(item => {
    if (item.Archived || item.Status === 'Done' || item.Status === 'Cancelled') return;

    // Check if user is associated with this item (nameToEmail already resolved above)
    if (!isUserOnCard_(userEmail, userDisplayName, nameToEmail,
        item.Owner, item.Requestor, item.Assigned)) return;

    if (!item.IntDue && !item.DueDate) return;

    const dueDate = new Date(item.IntDue || item.DueDate);
    dueDate.setHours(0, 0, 0, 0);

    const itemSummary = {
      id: item.ID,
      title: item.Title,
      type: item.Type,
      status: item.Status,
      owner: item.Owner || 'Unassigned',
      dueDate: dueDate.toLocaleDateString('en-US', { timeZone: 'UTC' }),
      statusSummary: item.StatusSummary || '',
      execStatus: item.ExecStatus || '',
      urgency: item.Urgency || ''
    };

    if (dueDate < today) {
      overdueItems.push(itemSummary);
    } else if (dueDate.getTime() === today.getTime()) {
      todayItems.push(itemSummary);
    } else if (dueDate <= endOfWeek) {
      thisWeekItems.push(itemSummary);
    }
  });

  return { today: todayItems, thisWeek: thisWeekItems, overdue: overdueItems };
}

/**
 * Assembles the full morning briefing prompt from all data sources.
 * @param {Array} emails Email summaries.
 * @param {Array} events Calendar events.
 * @param {object} kanbanItems Today/week/overdue kanban items.
 * @returns {Array} Messages array ready for callUsaiApi_().
 * @private
 */
function buildMorningPrompt_(emails, events, kanbanItems) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Format kanban context
  const formatItems = (items) => items.length === 0
    ? 'None'
    : items.map(i =>
        `- [${i.id}] ${i.title} (${i.type}, ${i.urgency || 'Normal'} urgency)` +
        (i.statusSummary ? ` — ${i.statusSummary}` : '')
      ).join('\n');

  // Format email context (truncated for token efficiency)
  const emailContext = emails.length === 0
    ? 'No unread emails in the last 24 hours.'
    : emails.map((e, i) =>
        `Email ${i + 1}:\n` +
        `  Subject: ${e.subject}\n` +
        `  From: ${e.from}\n` +
        `  Source: ${e.source === 'group' ? 'Group Inbox' : 'Personal Inbox'}\n` +
        `  Preview: ${e.snippet.substring(0, 300)}`
      ).join('\n\n');

  // Format calendar context
  const calContext = events.length === 0
    ? 'No calendar events today.'
    : events.map(e =>
        `- ${e.isAllDay ? '[All Day]' : `${e.start}–${e.end}`}: ${e.title}` +
        (e.location ? ` @ ${e.location}` : '')
      ).join('\n');

  const systemPrompt = `You are an executive assistant AI helping a federal government project manager 
start their workday. You are professional, concise, and action-oriented. 
You understand government project management workflows.
Today's date is ${today}.

You must respond with ONLY valid JSON in exactly this structure — no markdown, no explanation:
{
  "greeting": "A brief personalized good morning message (1-2 sentences)",
  "priorityActions": [
    {
      "rank": 1,
      "itemId": "TASK-XXXX or EMAIL or CALENDAR",
      "action": "Specific action to take",
      "reason": "Why this is the top priority",
      "urgency": "High|Medium|Low"
    }
  ],
  "emailSuggestions": [
    {
      "emailIndex": 0,
      "subject": "Original email subject",
      "suggestedAction": "Reply|Forward|Archive|No action needed",
      "draftReply": "Full draft reply text if suggestedAction is Reply, otherwise empty string",
      "reason": "Brief reason for recommendation"
    }
  ],
  "calendarNotes": "Brief observations about today's schedule and any conflicts (1-3 sentences)",
  "blockerAlert": "Any critical blockers or conflicts detected across all sources, or empty string if none",
  "focusSuggestion": "Recommended primary focus for the morning (1 sentence)"
}`;

  const userPrompt = `Please analyze my workday and provide my morning briefing.

=== UNREAD EMAILS (Last 24 Hours) ===
${emailContext}

=== TODAY'S CALENDAR ===
${calContext}

=== OVERDUE ACTION ITEMS ===
${formatItems(kanbanItems.overdue)}

=== DUE TODAY ===
${formatItems(kanbanItems.today)}

=== DUE THIS WEEK ===
${formatItems(kanbanItems.thisWeek)}

Please prioritize my actions for the day and suggest draft replies for any emails that need responses.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Parses the AI response JSON with graceful fallback.
 * @param {string} rawResponse The raw string from callUsaiApi_().
 * @returns {object} Parsed briefing object.
 * @private
 */
function parseBriefingResponse_(rawResponse) {
  // Strip markdown code fences if the model added them despite instructions
  const cleaned = rawResponse
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error(`Failed to parse AI briefing response: ${e.message}`);
    console.error(`Raw response was: ${rawResponse.substring(0, 500)}`);

    // Return a safe fallback so the UI doesn't crash
    return {
      greeting: 'Good morning! Your briefing could not be fully generated today.',
      priorityActions: [],
      emailSuggestions: [],
      calendarNotes: 'Calendar data loaded but AI summary unavailable.',
      blockerAlert: '',
      focusSuggestion: 'Please review your action items and emails manually.',
      parseError: true
    };
  }
}

/**
 * Creates Gmail draft replies for emails flagged by the AI.
 * @param {Array} emails The original email objects from scanUnreadEmails_().
 * @param {Array} emailSuggestions The AI's email suggestion objects.
 * @returns {Array} Array of {subject, draftUrl} for created drafts.
 * @private
 */
function saveDraftReplies_(emails, emailSuggestions) {
  const draftsCreated = [];

  emailSuggestions.forEach(suggestion => {
    if (suggestion.suggestedAction !== 'Reply') return;
    if (!suggestion.draftReply || suggestion.draftReply.trim() === '') return;

    const emailIndex = suggestion.emailIndex;
    if (emailIndex === undefined || emailIndex >= emails.length) return;

    const originalEmail = emails[emailIndex];

    try {
      const thread = GmailApp.getThreadById(originalEmail.threadId);
      if (!thread) return;

      const originalMessage = thread.getMessages()[0];
      const replyTo = originalMessage.getFrom();
      const subject = originalEmail.subject.startsWith('Re:')
        ? originalEmail.subject
        : `Re: ${originalEmail.subject}`;

      // Create as a draft (not sent)
      GmailApp.createDraft(
        replyTo,
        subject,
        suggestion.draftReply,
        {
          htmlBody: `<div style="font-family: Arial, sans-serif; font-size: 14px;">
            ${suggestion.draftReply.replace(/\n/g, '<br>')}
          </div>`,
          inReplyTo: originalMessage.getId(),
          references: originalMessage.getId()
        }
      );

      draftsCreated.push({
        subject: subject,
        to: replyTo
      });

      console.log(`Draft created for: ${subject}`);
    } catch (e) {
      console.error(
        `Failed to create draft for email index ${emailIndex}: ${e.message}`
      );
    }
  });

  return draftsCreated;
}

/**
 * Saves the morning briefing as a Google Doc in the destination folder.
 * @param {object} briefing The parsed AI briefing object.
 * @param {Array} emails Email summaries.
 * @param {Array} events Calendar events.
 * @param {object} kanbanItems Today/week/overdue kanban items.
 * @returns {string} URL of the created document.
 * @private
 */
function saveBriefingDoc_(briefing, emails, events, kanbanItems) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const title = `Morning Briefing — ${today}`;
  const doc = DocumentApp.create(title);
  const body = doc.getBody();

  body.setMarginTop(72).setMarginBottom(72)
      .setMarginLeft(72).setMarginRight(72);

  // Title
  body.insertParagraph(0, title)
      .setHeading(DocumentApp.ParagraphHeading.HEADING1)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph(briefing.greeting || '')
      .setItalic(true)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendHorizontalRule();

  // Focus suggestion
  if (briefing.focusSuggestion) {
    body.appendParagraph('🎯 Focus for Today')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(briefing.focusSuggestion);
  }

  // Blocker alert
  if (briefing.blockerAlert) {
    body.appendParagraph('🚨 Blocker Alert')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(briefing.blockerAlert)
        .setForegroundColor('#d93025');
  }

  // Priority Actions
  if (briefing.priorityActions && briefing.priorityActions.length > 0) {
    body.appendParagraph('✅ Priority Actions')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    briefing.priorityActions.forEach(action => {
      body.appendParagraph(
        `${action.rank}. [${action.urgency}] ${action.action}`
      ).setBold(true).setFontSize(11);
      body.appendParagraph(`   Why: ${action.reason}`)
          .setItalic(true).setFontSize(10)
          .setForegroundColor('#5f6368');
    });
  }

  // Calendar
  body.appendParagraph('📅 Today\'s Calendar')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (events.length === 0) {
    body.appendParagraph('No events today.');
  } else {
    events.forEach(e => {
      body.appendParagraph(
        `${e.isAllDay ? 'All Day' : `${e.start}–${e.end}`}: ${e.title}` +
        (e.location ? ` @ ${e.location}` : '')
      ).setFontSize(10);
    });
  }
  if (briefing.calendarNotes) {
    body.appendParagraph(briefing.calendarNotes)
        .setItalic(true).setFontSize(10).setForegroundColor('#5f6368');
  }

  // Email Digest
  body.appendParagraph('📧 Email Digest')
      .setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (emails.length === 0) {
    body.appendParagraph('No unread emails.');
  } else {
    emails.forEach((email, i) => {
      body.appendParagraph(
        `${i + 1}. ${email.subject} — from ${email.from}`
      ).setBold(true).setFontSize(10);

      const suggestion = briefing.emailSuggestions?.find(s => s.emailIndex === i);
      if (suggestion) {
        body.appendParagraph(
          `   Recommended: ${suggestion.suggestedAction} — ${suggestion.reason}`
        ).setItalic(true).setFontSize(9).setForegroundColor('#1a73e8');
      }
    });
  }

  doc.saveAndClose();

  // Move to destination folder if configured
  const config = loadConfig_();
  if (config.destinationFolderId) {
    try {
      const folder = DriveApp.getFolderById(config.destinationFolderId);
      const briefingsFolder = getOrCreateSubfolder_(folder, 'Morning Briefings');
      DriveApp.getFileById(doc.getId()).moveTo(briefingsFolder);
    } catch (e) {
      console.error(`Could not move briefing doc: ${e.message}`);
    }
  }

  return doc.getUrl();
}

/**
 * Main entry point for the Morning Prep tool.
 * Called from the frontend when the user loads the Morning Prep view.
 * @param {object} options {saveDrafts: bool, saveDoc: bool}
 * @returns {object} Full briefing package for the frontend.
 */
function getMorningBriefing(options = {}) {
  const result = {
    emails: [],
    events: [],
    kanbanItems: { today: [], thisWeek: [], overdue: [] },
    briefing: null,
    draftsCreated: [],
    docUrl: '',
    errors: []
  };

  // 1. Gather data (non-fatal — collect errors but continue)
  try {
    result.emails = scanUnreadEmails_();
  } catch (e) {
    result.errors.push(`Email scan: ${e.message}`);
  }

  try {
    result.events = getTodayCalendarEvents_();
  } catch (e) {
    result.errors.push(`Calendar scan: ${e.message}`);
  }

  try {
    result.kanbanItems = getTodayKanbanItems_();
  } catch (e) {
    result.errors.push(`Kanban scan: ${e.message}`);
  }

  // 2. Build and call AI
  try {
    const messages = buildMorningPrompt_(
      result.emails,
      result.events,
      result.kanbanItems
    );
    const rawResponse = callUsaiApi_(messages, { temperature: 0.4 });
    result.briefing = parseBriefingResponse_(rawResponse);
  } catch (e) {
    result.errors.push(`AI briefing: ${e.message}`);
    result.briefing = parseBriefingResponse_(''); // Returns safe fallback
  }

  // 3. Save draft replies (if requested)
  if (options.saveDrafts && result.briefing?.emailSuggestions) {
    try {
      result.draftsCreated = saveDraftReplies_(
        result.emails,
        result.briefing.emailSuggestions
      );
    } catch (e) {
      result.errors.push(`Draft creation: ${e.message}`);
    }
  }

  // 4. Save briefing doc (if requested)
  if (options.saveDoc) {
    try {
      result.docUrl = saveBriefingDoc_(
        result.briefing,
        result.emails,
        result.events,
        result.kanbanItems
      );
    } catch (e) {
      result.errors.push(`Doc save: ${e.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.warn(`getMorningBriefing completed with errors: ${result.errors.join('; ')}`);
  }

  return result;
}
function diagnosUsaiAuth() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty('USAI_BASE_URL');
  const apiKey = props.getProperty('USAI_API_KEY');

  // Log what we have without exposing the full key
  Logger.log(`Base URL: "${baseUrl}"`);
  Logger.log(`API Key present: ${!!apiKey}`);
  Logger.log(`API Key length: ${apiKey ? apiKey.length : 0}`);
  Logger.log(`API Key first 8 chars: ${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'}`);
  Logger.log(`API Key has leading/trailing spaces: ${apiKey !== (apiKey || '').trim()}`);
  
  // Construct exactly what will be sent
  const authHeader = `Bearer ${apiKey}`;
  Logger.log(`Auth header prefix: "${authHeader.substring(0, 15)}..."`);
  Logger.log(`Full endpoint: ${baseUrl}/api/v1/chat/completions`);
}
/**
 * Tests both common authentication header formats against the USAi API.
 * Run from the script editor and check the Execution Log.
 */
function testUsaiAuthFormats_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty('USAI_BASE_URL') || '').trim();
  const apiKey = (props.getProperty('USAI_API_KEY') || '').trim();
  const model = (props.getProperty('USAI_DEFAULT_MODEL') || 'claude_4_5_sonnet').trim();

  const endpoint = `${baseUrl}/api/v1/chat/completions`;

  const testPayload = JSON.stringify({
    model: model,
    messages: [
      { role: 'user', content: 'Say only the word: connected' }
    ],
    max_tokens: 10
  });

  const headerFormats = [
    {
      label: 'Format 1: Bearer token',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      }
    },
    {
      label: 'Format 2: X-API-Key header',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      }
    },
    {
      label: 'Format 3: Api-Key header',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      }
    },
    {
      label: 'Format 4: Authorization with api-key scheme',
      headers: {
        'Authorization': `api-key ${apiKey}`,
        'Content-Type': 'application/json',
        'accept': 'application/json'
      }
    }
  ];

  headerFormats.forEach(format => {
    try {
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        headers: format.headers,
        payload: testPayload,
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText().substring(0, 150);

      if (code === 200) {
        Logger.log(`✅ SUCCESS — ${format.label}`);
        Logger.log(`   Response: ${body}`);
      } else {
        Logger.log(`❌ FAILED (${code}) — ${format.label}`);
        Logger.log(`   Response: ${body}`);
      }
    } catch (e) {
      Logger.log(`💥 ERROR — ${format.label}: ${e.message}`);
    }
  });

  Logger.log('Auth format test complete. Check above for ✅ SUCCESS.');
}
function testUsaiKeyVariants_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty('USAI_BASE_URL') || '').trim();
  const apiKey = (props.getProperty('USAI_API_KEY') || '').trim();
  const model = (props.getProperty('USAI_DEFAULT_MODEL') || 'claude_4_5_sonnet').trim();

  const endpoint = `${baseUrl}/api/v1/chat/completions`;

  const testPayload = JSON.stringify({
    model: model,
    messages: [{ role: 'user', content: 'Say only the word: connected' }],
    max_tokens: 10
  });

  // Build key variants to test
  const keyVariants = [
    { label: 'Key as-is with Bearer', key: apiKey },
    { label: 'Key with api-key- prefix stripped', key: apiKey.replace(/^api-key-/i, '') },
    { label: 'Key uppercased', key: apiKey.toUpperCase() },
    { label: 'Key lowercased', key: apiKey.toLowerCase() }
  ];

  keyVariants.forEach(variant => {
    try {
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        headers: {
          'Authorization': `Bearer ${variant.key}`,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        payload: testPayload,
        muteHttpExceptions: true
      });

      const code = response.getResponseCode();
      const body = response.getContentText().substring(0, 150);

      Logger.log(`${code === 200 ? '✅' : '❌'} (${code}) — ${variant.label}`);
      Logger.log(`   Key length used: ${variant.key.length}`);
      if (code !== 200) Logger.log(`   Response: ${body}`);
      else Logger.log(`   SUCCESS Response: ${body}`);

    } catch (e) {
      Logger.log(`💥 ERROR — ${variant.label}: ${e.message}`);
    }
  });
}
function testReportLogo_() {
  const props = PropertiesService.getScriptProperties();
  const fileId = (props.getProperty('REPORT_LOGO_FILE_ID') || '').trim();

  Logger.log('File ID: "' + fileId + '"');
  Logger.log('File ID length: ' + fileId.length);

  if (!fileId) {
    Logger.log('ERROR: REPORT_LOGO_FILE_ID is empty or not set.');
    return;
  }

  try {
    const file = DriveApp.getFileById(fileId);
    Logger.log('File found: ' + file.getName());
    Logger.log('MIME type: ' + file.getMimeType());
    Logger.log('Size: ' + file.getSize() + ' bytes');
  } catch (e) {
    Logger.log('ERROR accessing file: ' + e.message);
  }
}
/**
 * Sends a brief notification email when a scheduled report
 * finds no records matching its filters.
 * @param {object} template The report template object.
 * @private
 */
function sendEmptyReportNotification_(template) {
  const recipients = template.recipients
    .split(',')
    .map(r => r.trim())
    .filter(Boolean);

  if (recipients.length === 0) return;

  const subject = `Report Notice: ${template.name} — No Items Found`;

  const htmlBody = `
    <html>
    <body style="font-family:Arial, sans-serif; max-width:600px;
                 margin:0 auto; color:#202124;">

      <div style="background:#f9ab00; padding:20px 25px;
                  border-radius:6px 6px 0 0;">
        <h2 style="color:white; margin:0; font-size:1.1rem; font-weight:600;">
          ${template.name}
        </h2>
      </div>

      <div style="border:1px solid #dadce0; border-top:none; padding:25px;
                  border-radius:0 0 6px 6px; background:#ffffff;">

        <p style="margin-top:0; color:#202124;">
          Your scheduled report ran on
          <strong>${new Date().toLocaleString()}</strong>
          but found <strong>no items</strong> matching the configured filters.
        </p>

        <p style="color:#5f6368; font-size:0.9rem;">
          No document was generated. This may mean:
        </p>

        <ul style="color:#5f6368; font-size:0.9rem; line-height:1.8;">
          <li>All items currently match a status excluded by your filters</li>
          <li>No items fall within the configured date range</li>
          <li>The owner or assigned team filter does not match any active items</li>
        </ul>

        <p style="color:#5f6368; font-size:0.9rem;">
          If you believe this is incorrect, review the report filter
          configuration in the ${config.workgroupName || "PMSC"} Report Builder.
        </p>

        <hr style="border:none; border-top:1px solid #dadce0; margin:20px 0;">

        <p style="color:#9aa0a6; font-size:0.8rem; margin:0; line-height:1.5;">
          This notice was automatically generated by the ${config.workgroupName || "PMSC"} System.<br>
          ${template.schedule && template.schedule !== 'None'
            ? `Next scheduled run: ${template.nextRun || 'See report settings.'}`
            : ''}
        </p>

      </div>
    </body>
    </html>
  `;

  const plainText =
    `${template.name} — No Items Found\n\n` +
    `Your scheduled report ran on ${new Date().toLocaleString()} ` +
    `but found no items matching the configured filters.\n\n` +
    `No document was generated.\n\n` +
    `This may mean:\n` +
    `- All items currently match a status excluded by your filters\n` +
    `- No items fall within the configured date range\n` +
    `- The owner or assigned team filter does not match any active items\n\n` +
    (template.schedule && template.schedule !== 'None'
      ? `Next scheduled run: ${template.nextRun || 'See report settings.'}\n`
      : '') +
    `\nThis notice was automatically generated by the ${config.workgroupName || "PMSC"} System.`;

  try {
    GmailApp.sendEmail(
      recipients.join(','),
      subject,
      plainText,
      { htmlBody }
    );
    console.log(`Empty report notification sent for "${template.name}"`);
  } catch (e) {
    console.error(`Failed to send empty report notification: ${e.message}`);
  }
}
/**
 * Shares generated report files with all email recipients.
 * Grants viewer access — recipients can read but not edit.
 * @param {string[]} recipientEmails Array of email addresses.
 * @param {string} docId Google Doc file ID (or empty string).
 * @param {string} sheetId Google Sheet file ID (or empty string).
 * @private
 */
function shareReportFiles_(recipientEmails, docId, sheetId) {
  // Pull the global config to get the group email
  const config = loadConfig_();
  let allEmails = [...recipientEmails];
  if (config.groupEmail) {
    const groupEmails = config.groupEmail.split(',').map(e => e.trim()).filter(Boolean);
    allEmails = allEmails.concat(groupEmails);
  }
  
  // Deduplicate emails
  allEmails = [...new Set(allEmails)];

  if (allEmails.length === 0) return;

  allEmails.forEach(email => {
    if (!email || !email.includes('@')) return;

    // Share the Doc
    if (docId) {
      try {
        DriveApp.getFileById(docId).addViewer(email);
        console.log(`Shared Doc ${docId} with ${email}`);
      } catch (e) {
        console.error(`Could not share Doc with ${email}: ${e.message}`);
      }
    }

    // Share the Sheet
    if (sheetId) {
      try {
        DriveApp.getFileById(sheetId).addViewer(email);
        console.log(`Shared Sheet ${sheetId} with ${email}`);
      } catch (e) {
        console.error(`Could not share Sheet with ${email}: ${e.message}`);
      }
    }
  });
}
/**
 * Fetches the complete audit log for a specific item from the Activity_Log sheet.
 */
function getItemAuditLog(itemId) {
  try {
    if (!itemId) return { success: true, data: [] };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Activity_Log');
    if (!sh || sh.getLastRow() < 2) return { success: true, data: [] };
    
    const data = sh.getDataRange().getValues();
    // Headers: Timestamp, User, ID, Title, Action, Details
    // Ensure both are strings and trimmed for comparison
    const targetId = String(itemId).trim();
    
    const filtered = data.slice(1).filter(r => String(r[2]).trim() === targetId);
    
    const auditData = filtered.map(r => ({
        date: r[0] ? new Date(r[0]).toISOString() : '',
        user: r[1],
        action: r[4],
        details: r[5]
    })).sort((a,b) => new Date(b.date) - new Date(a.date));
    
    return { success: true, data: auditData };
  } catch(e) {
    console.error("Failed to fetch audit log: " + e.message);
    return { success: false, error: e.message };
  }
}
