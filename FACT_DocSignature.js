/**
 * FACT Document Signature Service
 * Handles automatic stamping of approval signatures into a Google Document.
 */

function appendSignatureToDoc_(fileId, email, role, action, notes) {
  try {
    if (!fileId) return;
    const file = DriveApp.getFileById(fileId);
    const originalName = file.getName();
    
    const doc = DocumentApp.openById(fileId);
    const body = doc.getBody();
    
    // Look for an existing Approval Record table
    const tables = body.getTables();
    let approvalTable = null;
    
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (table.getNumRows() > 0) {
        const firstCellText = table.getCell(0, 0).getText();
        if (firstCellText.includes("FACT APPROVAL RECORD") || firstCellText.includes("Date / Time")) {
          approvalTable = table;
          break;
        }
      }
    }
    
    // If no table exists, create it at the top of the document
    if (!approvalTable) {
      const headerPara = body.insertParagraph(0, "Approval Routing Log");
      headerPara.setHeading(DocumentApp.ParagraphHeading.HEADING3);
      headerPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      
      approvalTable = body.insertTable(1, [
        ["Date / Time", "Name", "Role", "Action", "Comments"]
      ]);
      body.insertParagraph(2, " "); // Spacer below table
      
      const headerRow = approvalTable.getRow(0);
      const headerStyle = {};
      headerStyle[DocumentApp.Attribute.BOLD] = true;
      headerRow.setAttributes(headerStyle);
    }
    
    // Resolve the email to a name
    const nameStr = email.split('@')[0].replace('.', ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    const now = new Date();
    const timestamp = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
    
    const newRow = approvalTable.appendTableRow();
    
    const plainStyle = {};
    plainStyle[DocumentApp.Attribute.BACKGROUND_COLOR] = '#ffffff';
    plainStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
    
    const c1 = newRow.appendTableCell(timestamp).setAttributes(plainStyle);
    
    const c2 = newRow.appendTableCell(nameStr).setAttributes(plainStyle);
    
    const c3 = newRow.appendTableCell(role || "Approver").setAttributes(plainStyle);
    
    const actionCell = newRow.appendTableCell(action || "Approved");
    actionCell.setAttributes(plainStyle);
    if (action === "Approve" || action === "Approved") actionCell.editAsText().setForegroundColor("#0f9d58");
    if (action === "Decline" || action === "Returned") actionCell.editAsText().setForegroundColor("#d23f31");
    
    const c5 = newRow.appendTableCell(notes || "").setAttributes(plainStyle);
    
    doc.saveAndClose();
    try {
        file.setName(originalName);
    } catch(err) {
        console.warn("Failed to restore filename: " + err.message);
    }
  } catch(e) {
    console.error("Failed to append signature to document: " + e.message);
    throw new Error("Doc Signature Error: " + e.message);
  }
}

/**
 * Downgrades all specified approver emails to Commenter access.
 */
function downgradeToCommenter_(fileId, emails) {
  try {
    const token = ScriptApp.getOAuthToken();
    emails.forEach(email => {
      if(email && email.includes('@')) {
          const url = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false`;
          const payload = { role: 'commenter', type: 'user', emailAddress: email.trim() };
          UrlFetchApp.fetch(url, {
              method: 'post',
              contentType: 'application/json',
              headers: { Authorization: "Bearer " + token },
              payload: JSON.stringify(payload),
              muteHttpExceptions: true
          });
      }
    });
  } catch(e) {
    console.error("Failed to downgrade permissions: " + e.message);
  }
}

/**
 * Creates a copy of the approved document in the item's folder, 
 * and prepends the routing log.
 */
function createApprovedDocumentCopy_(docId, folderId, itemTitle, steps, logLines) {
  try {
    const originalFile = DriveApp.getFileById(docId);
    let targetFolder = DriveApp.getRootFolder();
    if (folderId) {
        const fMatch = folderId.match(/[-\w]{25,}/);
        if (fMatch) {
            targetFolder = DriveApp.getFolderById(fMatch[0]);
        }
    }
    
    const newName = `[APPROVED] ${itemTitle} - ${new Date().toLocaleDateString()}`;
    const copiedFile = originalFile.makeCopy(newName, targetFolder);
    const mimeType = originalFile.getMimeType();
    
    // Build routing summary
    let startTime = "Unknown time";
    if (logLines && logLines.length > 0) {
        const chronoLogs = [...logLines].reverse();
        const match = chronoLogs[0].match(/\[(.*?)\]/);
        if (match) startTime = match[1];
    }
    const completionTime = new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: '2-digit', day: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short'
    });
    
    const summaryText = `Approval routing began at ${startTime} and completed at ${completionTime}.\nOriginal Document`;
    
    if (mimeType === MimeType.GOOGLE_DOCS) {
        const newDoc = DocumentApp.openById(copiedFile.getId());
        const body = newDoc.getBody();
        const paragraph = body.insertParagraph(0, summaryText);
        
        const style = {};
        style[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
        style[DocumentApp.Attribute.FONT_SIZE] = 10;
        style[DocumentApp.Attribute.FOREGROUND_COLOR] = '#5f6368';
        style[DocumentApp.Attribute.BACKGROUND_COLOR] = null;
        paragraph.setAttributes(style);
        
        paragraph.editAsText().setBackgroundColor(null);
        
        const textObj = paragraph.editAsText();
        const docWordIndex = summaryText.indexOf('Original Document');
        textObj.setLinkUrl(docWordIndex, docWordIndex + 16, originalFile.getUrl());
        textObj.setForegroundColor(docWordIndex, docWordIndex + 16, '#1a73e8');
        
        newDoc.saveAndClose();
    } else if (mimeType === MimeType.GOOGLE_SHEETS) {
        const newSheet = SpreadsheetApp.openById(copiedFile.getId());
        const summaryTab = newSheet.insertSheet('Approval Summary', 0);
        summaryTab.getRange('A1').setValue(summaryText);
        summaryTab.getRange('A1').setFontColor('#5f6368').setFontFamily('Arial').setFontSize(10);
        const richText = SpreadsheetApp.newRichTextValue()
            .setText(summaryText)
            .setLinkUrl(summaryText.indexOf('Original Document'), summaryText.indexOf('Original Document') + 17, originalFile.getUrl())
            .build();
        summaryTab.getRange('A1').setRichTextValue(richText);
        SpreadsheetApp.flush();
    } else if (mimeType === MimeType.GOOGLE_SLIDES) {
        // The user explicitly requested not to add the secondary "Approval routing began at..." summary slide.
        // We will just rely on the copied document which already contains the stamped routing timeline slide.
    }
  } catch(e) {
    console.error("Failed to create approved copy: " + e.message);
    throw new Error("Doc Copy Error: " + e.message);
  }
}

/**
 * Writes or replaces the routing timeline at the TOP of the primary Google Doc.
 * Called when a workflow starts (startAdvancedWorkflow) and after each step.
 * @param {string} docId - The Google Doc file ID.
 * @param {Array}  steps - Array of workflow step objects with status.
 * @param {string} itemId - The item ID for display purposes.
 * @param {string} itemTitle - The item title for display.
 */

function stampRoutingTimeline_(fileId, steps, itemId, itemTitle) {
    if (!fileId) return;
    try {
        const file = DriveApp.getFileById(fileId);
        const mimeType = file.getMimeType();
        
        if (mimeType === MimeType.GOOGLE_DOCS) {
            appendRoutingTimelineToDoc_(fileId, steps, itemId, itemTitle);
        } else if (mimeType === MimeType.GOOGLE_SHEETS) {
            appendRoutingTimelineToSheet_(fileId, steps, itemId, itemTitle);
        } else if (mimeType === MimeType.GOOGLE_SLIDES) {
            appendRoutingTimelineToSlide_(fileId, steps, itemId, itemTitle);
        } else {
            console.warn(`stampRoutingTimeline_: Unsupported MIME type ${mimeType} for file ${fileId}`);
        }
    } catch (e) {
        console.error("stampRoutingTimeline_ router error: " + e.message);
    }
}

function appendRoutingTimelineToDoc_(docId, steps, itemId, itemTitle) {
  try {
    if (!docId) return;
    const file = DriveApp.getFileById(docId);
    const originalName = file.getName();
    
    // Unlock document if locked by a native approval
    if (typeof unlockDocument_ === 'function') {
        try {
            unlockDocument_(docId);
        } catch(e) {
            console.warn("unlockDocument_ failed: " + e.message);
        }
    }
    
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    
    const MARKER_TEXT = 'FACT APPROVAL ROUTING';
    
    // Remove any previously inserted routing block (search for MARKER paragraph)
    let markerIdx = -1;
    for (let i = 0; i < body.getNumChildren(); i++) {
      const child = body.getChild(i);
      let text = '';
      try {
          if (child.getType() === DocumentApp.ElementType.PARAGRAPH) text = child.asParagraph().getText();
          else if (child.getType() === DocumentApp.ElementType.LIST_ITEM) text = child.asListItem().getText();
          else if (child.editAsText) text = child.editAsText().getText();
      } catch(e) {}
      
      if (text.includes(MARKER_TEXT)) {
        markerIdx = i;
        break;
      }
    }
    
    // If found, delete the marker paragraph and the first table following it
    if (markerIdx >= 0) {
      for (let i = markerIdx + 1; i < body.getNumChildren(); i++) {
        const nextChild = body.getChild(i);
        if (nextChild.getType() === DocumentApp.ElementType.TABLE) {
          body.removeChild(nextChild);
          break;
        }
        let text = '';
        try {
            if (nextChild.getType() === DocumentApp.ElementType.PARAGRAPH) text = nextChild.asParagraph().getText();
            else if (nextChild.getType() === DocumentApp.ElementType.LIST_ITEM) text = nextChild.asListItem().getText();
        } catch(e) {}
        
        if (text.includes(MARKER_TEXT)) {
          break;
        }
      }
      body.removeChild(body.getChild(markerIdx));
    }
    
    if (!steps || steps.length === 0) {
      doc.saveAndClose();
      try {
          file.setName(originalName);
      } catch(err) {
          console.warn("Failed to restore filename: " + err.message);
      }
      return;
    }
    
    // Status display config: [label, background color, text color]
    const statusConfig = {
      'Approved':     ['✅ Approved',         '#e6f4ea', '#137333'],
      'FYI_Complete': ['ℹ️ Notified (FYI)',   '#e8f0fe', '#1a73e8'],
      'Pending':      ['⏳ Pending',           '#fef7e0', '#b06000'],
      'Declined':     ['❌ Declined',          '#fce8e6', '#c5221f'],
      'Returned':     ['↩️ Returned',          '#fff3e0', '#e65100'],
      'Removed':      ['🚫 Removed/Skipped',  '#f1f3f4', '#5f6368'],
      'Configured':   ['⚪ Queued',            '#f1f3f4', '#5f6368']
    };
    
    const formatDateTime = (iso) => {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZoneName: 'short'
        });
      } catch(e) { return ''; }
    };
    
    // Build table data: Header + one row per step
    const tableData = [['Step', 'Role', 'Approver(s)', 'Type', 'Status', 'Date / Time', 'Comments']];

    steps.forEach((step, idx) => {
      let approversDisplay = '';
      if (Array.isArray(step.approvers)) {
          const approvedByList = Array.isArray(step.approvedBy) ? step.approvedBy : [];
          approversDisplay = step.approvers.map(a => {
              // Ensure we check ignoring case and brackets
              const cleanA = a.toLowerCase().replace(/<[^>]+>/g, '').trim();
              const isApproved = approvedByList.some(app => app.toLowerCase().replace(/<[^>]+>/g, '').trim() === cleanA);
              return (isApproved || step.status === 'Approved' || step.status === 'FYI_Complete') ? `✅ ${a}` : `⏳ ${a}`;
          }).join('\n');
      } else {
          approversDisplay = step.approvers || '';
      }

      const cfg = statusConfig[step.status] || statusConfig['Configured'];
      let dateTime = '';
      if (step.status === 'Approved' || step.status === 'FYI_Complete') {
          if (step.approvedAt) dateTime = (step.status === 'FYI_Complete' ? 'Notified: ' : 'Approved: ') + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Removed') {
          if (step.approvedAt) dateTime = 'Removed: ' + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Declined') {
          const ts = step.declinedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Declined: ' + formatDateTime(ts);
      } else if (step.status === 'Returned') {
          const ts = step.returnedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Returned: ' + formatDateTime(ts);
      } else if (step.status === 'Pending') {
          if (step.sentAt) dateTime = 'Pending Since: ' + formatDateTime(step.sentAt);
      }
      const comments = (step.approverComments || []).join('\n');
      tableData.push([String(idx + 1), step.role || '', approversDisplay, step.type || '', cfg[0], dateTime, comments]);
    });
    
    // Insert the marker paragraph at the old position (or 0)
    const insertPos = markerIdx >= 0 ? markerIdx : 0;
    const markerPara = body.insertParagraph(insertPos, `${MARKER_TEXT}\n${itemId || ''} - ${itemTitle || ''}  (Updated: ${formatDateTime(new Date().toISOString())})`);
    markerPara.setAttributes({
      [DocumentApp.Attribute.HEADING]: DocumentApp.ParagraphHeading.HEADING3,
      [DocumentApp.Attribute.FOREGROUND_COLOR]: '#1a1a2e',
      [DocumentApp.Attribute.BOLD]: true
    });
    
    // Insert the table right after the marker paragraph
    const table = body.insertTable(insertPos + 1, tableData);
    body.insertParagraph(insertPos + 2, '');
    body.insertParagraph(insertPos + 3, ''); // Additional line break before document content
    
    // Define approximate column widths in points (1 inch = 72 pts; total ~468 pts for letter margins)
    const colWidths = [25, 45, 120, 50, 65, 75, 88]; // Step, Role, Approvers, Type, Status, DateTime, Comments
    
    // Style header row
    const headerRow = table.getRow(0);
    for (let c = 0; c < headerRow.getNumCells(); c++) {
      const cell = headerRow.getCell(c);
      cell.setBackgroundColor('#1a1a2e'); // Dark navy header
      const para = cell.getChild(0).asParagraph();
      para.setAttributes({
        [DocumentApp.Attribute.BOLD]: true,
        [DocumentApp.Attribute.FOREGROUND_COLOR]: '#ffffff',
        [DocumentApp.Attribute.FONT_SIZE]: 8,
        [DocumentApp.Attribute.FONT_FAMILY]: 'Arial'
      });
      try { cell.setWidth(colWidths[c]); } catch(e) {}
    }
    
    // Style data rows
    for (let r = 1; r < table.getNumRows(); r++) {
      const row = table.getRow(r);
      const step = steps[r - 1];
      const cfg = statusConfig[step.status] || statusConfig['Configured'];
      const rowBg = (r % 2 === 0) ? '#f9f9f9' : '#ffffff'; // alternating rows
      
      for (let c = 0; c < row.getNumCells(); c++) {
        const cell = row.getCell(c);
        // Status column gets the status color, others get alternating white/light-grey
        const bgColor = (c === 4) ? cfg[1] : rowBg;
        cell.setBackgroundColor(bgColor);
        const para = cell.getChild(0).asParagraph();
        const textColor = (c === 4) ? cfg[2] : '#333333';
        para.setAttributes({
          [DocumentApp.Attribute.BOLD]: (c === 4),
          [DocumentApp.Attribute.FOREGROUND_COLOR]: textColor,
          [DocumentApp.Attribute.FONT_SIZE]: 8,
          [DocumentApp.Attribute.FONT_FAMILY]: 'Arial'
        });
        try { cell.setWidth(colWidths[c]); } catch(e) {}
      }
    }
    
    // Set table border
    table.setBorderWidth(0.5);
    table.setBorderColor('#cccccc');
    
    // The marker paragraph has already been inserted above the table.
    
    doc.saveAndClose();
    try {
        file.setName(originalName);
    } catch(err) {
        console.warn("Failed to restore filename: " + err.message);
    }
  } catch (e) {
    console.error('appendRoutingTimelineToDoc_ error: ' + e.message);
  }
}

/**
 * Writes or replaces the routing timeline at the TOP of the primary Google Sheet.
 * @param {string} docId - The Google Sheet file ID.
 * @param {Array}  steps - Array of workflow step objects with status.
 * @param {string} itemId - The item ID for display purposes.
 * @param {string} itemTitle - The item title for display.
 */
function appendRoutingTimelineToSheet_(docId, steps, itemId, itemTitle) {
  try {
    if (!docId) return;
    const file = DriveApp.getFileById(docId);
    const originalName = file.getName();
    
    // Unlock document if locked by a native approval
    if (typeof unlockDocument_ === 'function') {
        try { unlockDocument_(docId); } catch(e) {}
    }
    
    const ss = SpreadsheetApp.openById(docId);
    
    const SHEET_NAME = 'Routing Timeline';
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    // Always recreate the sheet to clear old data
    if (sheet) {
        ss.deleteSheet(sheet);
    }
    
    if (!steps || steps.length === 0) {
      ss.saveAndClose && ss.saveAndClose();
      try { file.setName(originalName); } catch(e) {}
      return;
    }
    
    sheet = ss.insertSheet(SHEET_NAME, 0); // Insert at position 0
    
    // Setup Table Data
    const statusConfig = {
      'Approved':     ['✅ Approved',         '#e6f4ea', '#137333'],
      'FYI_Complete': ['ℹ️ Notified (FYI)',   '#e8f0fe', '#1a73e8'],
      'Pending':      ['⏳ Pending',           '#fef7e0', '#b06000'],
      'Declined':     ['❌ Declined',          '#fce8e6', '#c5221f'],
      'Returned':     ['↩️ Returned',          '#fff3e0', '#e65100'],
      'Removed':      ['🚫 Skipped',          '#f1f3f4', '#5f6368'],
      'Configured':   ['⚪ Queued',            '#f1f3f4', '#5f6368']
    };
    
    const formatDateTime = (iso) => {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
      } catch(e) { return ''; }
    };
    
    // Build Headers
    const headers = ['Step', 'Role', 'Approver(s)', 'Type', 'Status', 'Date / Time', 'Comments'];
    const rowData = [headers];
    const statusRows = [];
    
    steps.forEach((step, idx) => {
      let approversDisplay = '';
      if (Array.isArray(step.approvers)) {
          const approvedByList = Array.isArray(step.approvedBy) ? step.approvedBy : [];
          approversDisplay = step.approvers.map(a => {
              const cleanA = a.toLowerCase().replace(/<[^>]+>/g, '').trim();
              const isApproved = approvedByList.some(app => app.toLowerCase().replace(/<[^>]+>/g, '').trim() === cleanA);
              return (isApproved || step.status === 'Approved' || step.status === 'FYI_Complete') ? `✅ ${a}` : `⏳ ${a}`;
          }).join('\n');
      } else {
          approversDisplay = step.approvers || '';
      }

      const cfg = statusConfig[step.status] || statusConfig['Configured'];
      let dateTime = '';
      if (step.status === 'Approved' || step.status === 'FYI_Complete') {
          if (step.approvedAt) dateTime = (step.status === 'FYI_Complete' ? 'Notified: ' : 'Approved: ') + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Removed') {
          if (step.approvedAt) dateTime = 'Removed: ' + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Declined') {
          const ts = step.declinedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Declined: ' + formatDateTime(ts);
      } else if (step.status === 'Returned') {
          const ts = step.returnedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Returned: ' + formatDateTime(ts);
      } else if (step.status === 'Pending') {
          if (step.sentAt) dateTime = 'Requested: ' + formatDateTime(step.sentAt);
      }
      
      const roleStr = typeof step.role === 'string' ? step.role : 
                      (step.role && step.role.name ? step.role.name : "Approver");
      
      let typeStr = step.type || 'Sequential';
      if (typeStr === 'Parallel' && step.quorum) {
          typeStr += ` (Needs ${step.quorum})`;
      }
      
      rowData.push([
          (idx + 1).toString(),
          roleStr,
          approversDisplay,
          typeStr,
          cfg[0],
          dateTime,
          step.notes || ''
      ]);
      
      statusRows.push({
          bg: cfg[1],
          text: cfg[2]
      });
    });
    
    // Add title
    sheet.getRange(1, 1).setValue("Approval Routing Timeline");
    sheet.getRange(1, 1, 1, 7).merge();
    sheet.getRange(1, 1).setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center").setBackground("#f8f9fa");
    
    // Write data starting at row 3
    const range = sheet.getRange(3, 1, rowData.length, headers.length);
    range.setValues(rowData);
    
    // Format headers
    const headerRange = sheet.getRange(3, 1, 1, headers.length);
    headerRange.setFontWeight("bold").setBackground("#e0e0e0").setBorder(true, true, true, true, true, true);
    
    // Format data rows
    if (rowData.length > 1) {
        const dataRange = sheet.getRange(4, 1, rowData.length - 1, headers.length);
        dataRange.setVerticalAlignment("top").setWrap(true).setBorder(true, true, true, true, true, true);
        
        // Apply status colors to the Status column (Column 5)
        for (let i = 0; i < statusRows.length; i++) {
            const rowIdx = i + 4;
            const statusCell = sheet.getRange(rowIdx, 5);
            statusCell.setBackground(statusRows[i].bg).setFontColor(statusRows[i].text).setFontWeight("bold");
        }
    }
    
    // Adjust column widths
    sheet.setColumnWidth(1, 50);  // Step
    sheet.setColumnWidth(2, 120); // Role
    sheet.setColumnWidth(3, 200); // Approvers
    sheet.setColumnWidth(4, 100); // Type
    sheet.setColumnWidth(5, 120); // Status
    sheet.setColumnWidth(6, 160); // Date/Time
    sheet.setColumnWidth(7, 250); // Comments
    
    SpreadsheetApp.flush();
    
  } catch (e) {
    console.error('appendRoutingTimelineToSheet_ error: ' + e.message);
  }
}

/**
 * Writes or replaces the routing timeline at the TOP of the primary Google Slides presentation.
 * @param {string} docId - The Google Slide file ID.
 * @param {Array}  steps - Array of workflow step objects with status.
 * @param {string} itemId - The item ID for display purposes.
 * @param {string} itemTitle - The item title for display.
 */
function appendRoutingTimelineToSlide_(docId, steps, itemId, itemTitle) {
  try {
    if (!docId) return;
    const file = DriveApp.getFileById(docId);
    const originalName = file.getName();
    
    // Unlock document if locked by a native approval
    if (typeof unlockDocument_ === 'function') {
        try { unlockDocument_(docId); } catch(e) {}
    }
    
    const presentation = SlidesApp.openById(docId);
    
    // Search for existing routing timeline slide and remove it
    const MARKER_TEXT = "Approval Routing Timeline";
    const slides = presentation.getSlides();
    let markerIdx = -1;
    
    for (let i = 0; i < slides.length; i++) {
        const elements = slides[i].getPageElements();
        for (let j = 0; j < elements.length; j++) {
            const el = elements[j];
            if (el.getPageElementType() === SlidesApp.PageElementType.SHAPE) {
                const text = el.asShape().getText().asString();
                if (text.includes(MARKER_TEXT)) {
                    markerIdx = i;
                    break;
                }
            }
        }
        if (markerIdx >= 0) break;
    }
    
    if (markerIdx >= 0) {
        slides[markerIdx].remove();
    }
    
    if (!steps || steps.length === 0) {
      presentation.saveAndClose();
      try { file.setName(originalName); } catch(e) {}
      return;
    }
    
    // Insert new slide at position 0
    const slide = presentation.insertSlide(0);
    const titleShape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, 50, 20, 620, 40);
    const titleText = titleShape.getText();
    titleText.setText(MARKER_TEXT);
    titleText.getTextStyle().setBold(true).setFontSize(18);
    titleText.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    
    // Setup Table Data
    const statusConfig = {
      'Approved':     ['✅ Approved',         '#e6f4ea', '#137333'],
      'FYI_Complete': ['ℹ️ Notified (FYI)',   '#e8f0fe', '#1a73e8'],
      'Pending':      ['⏳ Pending',           '#fef7e0', '#b06000'],
      'Declined':     ['❌ Declined',          '#fce8e6', '#c5221f'],
      'Returned':     ['↩️ Returned',          '#fff3e0', '#e65100'],
      'Removed':      ['🚫 Skipped',          '#f1f3f4', '#5f6368'],
      'Configured':   ['⚪ Queued',            '#f1f3f4', '#5f6368']
    };
    
    const formatDateTime = (iso) => {
      if (!iso) return '';
      try {
        const d = new Date(iso);
        return d.toLocaleString('en-US', {
            timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
        });
      } catch(e) { return ''; }
    };
    
    // Build Headers
    const headers = ['Step', 'Role', 'Approver(s)', 'Type', 'Status', 'Date / Time', 'Comments'];
    const rowData = [headers];
    
    steps.forEach((step, idx) => {
      let approversDisplay = '';
      if (Array.isArray(step.approvers)) {
          const approvedByList = Array.isArray(step.approvedBy) ? step.approvedBy : [];
          approversDisplay = step.approvers.map(a => {
              const cleanA = a.toLowerCase().replace(/<[^>]+>/g, '').trim();
              const isApproved = approvedByList.some(app => app.toLowerCase().replace(/<[^>]+>/g, '').trim() === cleanA);
              return (isApproved || step.status === 'Approved' || step.status === 'FYI_Complete') ? `✅ ${a}` : `⏳ ${a}`;
          }).join('\n');
      } else {
          approversDisplay = step.approvers || '';
      }

      const cfg = statusConfig[step.status] || statusConfig['Configured'];
      let dateTime = '';
      if (step.status === 'Approved' || step.status === 'FYI_Complete') {
          if (step.approvedAt) dateTime = (step.status === 'FYI_Complete' ? 'Notified: ' : 'Approved: ') + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Removed') {
          if (step.approvedAt) dateTime = 'Removed: ' + formatDateTime(step.approvedAt);
          else if (step.sentAt) dateTime = formatDateTime(step.sentAt);
      } else if (step.status === 'Declined') {
          const ts = step.declinedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Declined: ' + formatDateTime(ts);
      } else if (step.status === 'Returned') {
          const ts = step.returnedAt || step.approvedAt || step.sentAt;
          if (ts) dateTime = 'Returned: ' + formatDateTime(ts);
      } else if (step.status === 'Pending') {
          if (step.sentAt) dateTime = 'Requested: ' + formatDateTime(step.sentAt);
      }
      
      const roleStr = typeof step.role === 'string' ? step.role : 
                      (step.role && step.role.name ? step.role.name : "Approver");
                      
      let typeStr = step.type || 'Sequential';
      if (typeStr === 'Parallel' && step.quorum) {
          typeStr += ` (Needs ${step.quorum})`;
      }
      
      rowData.push([
          (idx + 1).toString(),
          roleStr,
          approversDisplay,
          typeStr,
          cfg[0],
          dateTime,
          (step.notes || '').substring(0, 50) + (step.notes && step.notes.length > 50 ? '...' : '') // Truncate notes for slides
      ]);
    });
    
    // Insert Table
    const table = slide.insertTable(rowData.length, headers.length, 50, 70, 620, rowData.length * 30);
    
    // Fill and format table
    for (let r = 0; r < rowData.length; r++) {
        for (let c = 0; c < headers.length; c++) {
            const cell = table.getCell(r, c);
            const textRange = cell.getText();
            textRange.setText(rowData[r][c] || "");
            
            textRange.getTextStyle().setFontSize(10).setFontFamily("Arial");
            
            if (r === 0) {
                // Header format
                textRange.getTextStyle().setBold(true);
                cell.getFill().setSolidFill("#e0e0e0");
            } else {
                // Status column coloring
                if (c === 4) { // Status column
                    const stepStat = steps[r-1].status;
                    const cfg = statusConfig[stepStat] || statusConfig['Configured'];
                    cell.getFill().setSolidFill(cfg[1]);
                    textRange.getTextStyle().setForegroundColor(cfg[2]).setBold(true);
                } else {
                    cell.getFill().setSolidFill("#ffffff");
                }
            }
        }
    }
    
    presentation.saveAndClose();
    
  } catch (e) {
    console.error('appendRoutingTimelineToSlide_ error: ' + e.message);
  }
}
