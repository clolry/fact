// ==========================================
// FACT NOTIFICATION SERVICE
// ==========================================

/**
/**
 * Writes all form data to the appropriate sheet row.
 * Handles Tasks, Projects, and Sub_Tasks.
 * PERF-01: Update path now uses a single read + single write (setValues) instead of
 * one getRange().setValue() call per field. This reduces ~26 API calls per Task save
 * and ~16 calls per Project save down to 2 each (one read, one write).
 * @private
 */
function writeItemToSheet_(form, finalId, sheetName, row, isNew, driveLink, folderId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found.`);

  const rank = form.Rank || Date.now();
  const now = new Date();

  if (sheetName === 'Tasks') {
    if (isNew) {
      sheet.appendRow([
        finalId, form.Title, form.Type, form.ParentID, form.Owner,
        form.DueDate, form.Status, form.Desc, form.Complexity, form.Urgency,
        form.ExecStatus, form.ThreadID, driveLink, folderId,
        form.RecDate, form.IntDue, form.DC_No || form.DataCallNo || '', form.Requestor, rank,
        form.CompletedDate, form.Archived, form.StatusSummary, form.Assigned,
        form.NotificationSchedule, '',
        form.ApprovalType, form.PriorApprover, form.Background,
        form.FCA_Approval, form.FCA_Notes, form.FCB_Approval, form.FCB_Notes,
        form.FCC_Approval, form.FCC_Notes, form.AC_Approval, form.AC_Notes,
        '', form.Primary_Doc_ID, form.StatusSummaryLog
      ]);
    } else {
      // Batch update: read existing row once, mutate in-memory, write back in one call.
      const numCols = sheet.getMaxColumns();
      const existingRow = sheet.getRange(row, 1, 1, numCols).getValues()[0];

      const headerRowForUpdates = sheet.getRange(1, 1, 1, numCols).getValues()[0];
      const setVal = (colName, val) => {
          if (val === undefined) return;
          const idx = headerRowForUpdates.indexOf(colName);
          if (idx >= 0) {
              existingRow[idx] = val;
          }
      };

      setVal('Title', form.Title);
      setVal('Type', form.Type);
      setVal('Owner', form.Owner);
      setVal('DueDate', form.DueDate);
      setVal('Status', form.Status);
      setVal('Description', form.Desc);
      setVal('Desc', form.Desc);
      setVal('Complexity', form.Complexity);
      setVal('Urgency', form.Urgency);
      setVal('ExecStatus', form.ExecStatus);
      setVal('ThreadID', form.ThreadID);
      setVal('DriveLink', driveLink);
      setVal('FolderID', folderId);
      setVal('RecDate', form.RecDate);
      setVal('IntDue', form.IntDue);
      setVal('DC_No', form.DC_No || form.DataCallNo);
      setVal('DataCallNo', form.DataCallNo || form.DC_No);
      setVal('Requestor', form.Requestor);
      setVal('CompletedDate', form.CompletedDate);
      setVal('Archived', form.Archived);
      setVal('StatusSummary', form.StatusSummary);
      setVal('Assigned', form.Assigned);
      setVal('NotificationSchedule', form.NotificationSchedule);
      setVal('ApprovalType', form.ApprovalType);
      setVal('PriorApprover', form.PriorApprover);
      setVal('Background', form.Background);
      setVal('FCA_Approval', form.FCA_Approval);
      setVal('FCA_Notes', form.FCA_Notes);
      setVal('FCB_Approval', form.FCB_Approval);
      setVal('FCB_Notes', form.FCB_Notes);
      setVal('FCC_Approval', form.FCC_Approval);
      setVal('FCC_Notes', form.FCC_Notes);
      setVal('AC_Approval', form.AC_Approval);
      setVal('AC_Notes', form.AC_Notes);
      if (form.WorkflowStep !== undefined) setVal('WorkflowStep', form.WorkflowStep);

      // Ensure headers exist for these dynamic columns if missing
      const headerRow = sheet.getRange(1, 1, 1, Math.max(numCols, 39)).getValues()[0];
      let headersUpdated = false;
      let pdocIdx = headerRow.indexOf('Primary_Doc_ID');
      let slogIdx = headerRow.indexOf('StatusSummaryLog');
      let intDueIdx = headerRow.indexOf('IntDue');
      if (intDueIdx === -1) intDueIdx = headerRow.indexOf('Internal_Due_Date');
      
      // Fallback: If not found, assign them to the end (minimum 37 and 38)
      if (pdocIdx === -1) {
          pdocIdx = Math.max(37, headerRow.length);
          headerRow[pdocIdx] = 'Primary_Doc_ID';
          headersUpdated = true;
      }
      if (slogIdx === -1) {
          slogIdx = Math.max(38, headerRow.length);
          headerRow[slogIdx] = 'StatusSummaryLog';
          headersUpdated = true;
      }
      if (intDueIdx === -1) {
          intDueIdx = Math.max(39, headerRow.length);
          headerRow[intDueIdx] = 'IntDue';
          headersUpdated = true;
      }

      if (headersUpdated) {
          if (sheet.getMaxColumns() < headerRow.length) {
              sheet.insertColumnsAfter(sheet.getMaxColumns(), headerRow.length - sheet.getMaxColumns());
          }
          sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
      }

      existingRow[pdocIdx] = form.Primary_Doc_ID;
      existingRow[slogIdx] = form.StatusSummaryLog;
      existingRow[intDueIdx] = form.IntDue;

      // Pad existingRow and replace undefined with empty string
      for (let i = 0; i < headerRow.length; i++) {
          if (existingRow[i] === undefined) existingRow[i] = '';
      }

      sheet.getRange(row, 1, 1, Math.max(numCols, headerRow.length)).setValues([existingRow]);
    }

  } else if (sheetName === 'Projects') {
    if (isNew) {
      sheet.appendRow([
        finalId, form.Title, 'Project', form.Owner, now, form.DueDate,
        form.Status, form.Desc, form.ExecStatus, form.Complexity, form.Urgency,
        form.ThreadID, driveLink, folderId,
        '','','','','','','','','','','','','','','','','',
        rank, form.CompletedDate, form.StatusSummary, form.Assigned,
        '', form.NotificationSchedule, '', '', '', '', '', '', '', '', '', '', '', form.Primary_Doc_ID, form.StatusSummaryLog, form.IntDue
      ]);
    } else {
      // Batch update: read existing row once, mutate in-memory, write back in one call.
      const numCols = sheet.getMaxColumns();
      const existingRow = sheet.getRange(row, 1, 1, numCols).getValues()[0];

      const headerRowForUpdates = sheet.getRange(1, 1, 1, numCols).getValues()[0];
      const setVal = (colName, val) => {
          if (val === undefined) return;
          const idx = headerRowForUpdates.indexOf(colName);
          if (idx >= 0) {
              existingRow[idx] = val;
          }
      };

      setVal('Title', form.Title);
      setVal('Owner', form.Owner);
      setVal('DueDate', form.DueDate);
      setVal('IntDue', form.IntDue);
      setVal('Status', form.Status);
      setVal('Description', form.Desc);
      setVal('Desc', form.Desc);
      setVal('ExecStatus', form.ExecStatus);
      setVal('Complexity', form.Complexity);
      setVal('Urgency', form.Urgency);
      setVal('ThreadID', form.ThreadID);
      setVal('DriveLink', driveLink);
      setVal('FolderID', folderId);
      setVal('Archived', form.Archived);
      setVal('CompletedDate', form.CompletedDate);
      setVal('StatusSummary', form.StatusSummary);
      setVal('Assigned', form.Assigned);
      setVal('NotificationSchedule', form.NotificationSchedule);
      if (form.WorkflowStep !== undefined) setVal('WorkflowStep', form.WorkflowStep);
      // Ensure headers exist for these dynamic columns if missing
      const headerRow = sheet.getRange(1, 1, 1, Math.max(numCols, 39)).getValues()[0];
      let headersUpdated = false;
      let pdocIdx = headerRow.indexOf('Primary_Doc_ID');
      let slogIdx = headerRow.indexOf('StatusSummaryLog');
      let intDueIdx = headerRow.indexOf('IntDue');
      if (intDueIdx === -1) intDueIdx = headerRow.indexOf('Internal_Due_Date');
      
      // Fallback: If not found, assign them to the end (minimum 37 and 38)
      if (pdocIdx === -1) {
          pdocIdx = Math.max(37, headerRow.length);
          headerRow[pdocIdx] = 'Primary_Doc_ID';
          headersUpdated = true;
      }
      if (slogIdx === -1) {
          slogIdx = Math.max(38, headerRow.length);
          headerRow[slogIdx] = 'StatusSummaryLog';
          headersUpdated = true;
      }
      if (intDueIdx === -1) {
          intDueIdx = Math.max(39, headerRow.length);
          headerRow[intDueIdx] = 'IntDue';
          headersUpdated = true;
      }

      if (headersUpdated) {
          if (sheet.getMaxColumns() < headerRow.length) {
              sheet.insertColumnsAfter(sheet.getMaxColumns(), headerRow.length - sheet.getMaxColumns());
          }
          sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
      }

      existingRow[pdocIdx] = form.Primary_Doc_ID;
      existingRow[slogIdx] = form.StatusSummaryLog;
      existingRow[intDueIdx] = form.IntDue;

      // Pad existingRow and replace undefined with empty string
      for (let i = 0; i < headerRow.length; i++) {
          if (existingRow[i] === undefined) existingRow[i] = '';
      }

      sheet.getRange(row, 1, 1, Math.max(numCols, headerRow.length)).setValues([existingRow]);
    }

  } else {
    // Sub_Tasks
    if (isNew) {
      sheet.appendRow([
        finalId, form.Title, 'Sub-Task', form.ParentID,
        form.Owner, form.DueDate, form.Status, form.Desc, rank, form.Assigned
      ]);
    } else {
      // Batch update: single setValues instead of two separate setValue calls.
      const existingRow = sheet.getRange(row, 1, 1, 10).getValues()[0];
      existingRow[1] = form.Title;
      existingRow[4] = form.Owner;
      sheet.getRange(row, 1, 1, 10).setValues([existingRow]);
    }
  }
}

/**
 * Sends an email and chat notification when a task's owner changes.
 * @param {string} finalId The item ID.
 * @param {string} title The item title.
 * @param {string} newOwner The new owner's name or email.
 * @private
 */
function sendAssignmentNotification_(finalId, title, newOwner) {
  try {
    const recipientEmails = resolveRecipientEmails_([newOwner]);
    if (recipientEmails.length === 0) return;

    const currentUser = Session.getActiveUser().getEmail().split('@')[0];
    const subject = `New Task Assignment: ${title}`;
    const appUrl = ScriptApp.getService().getUrl() + '?id=' + finalId;
    const emailBody = `You have been assigned a task by ${currentUser}:\n\nID: ${finalId}\nTitle: ${title}\n\nPlease review it on the WAT board: ${appUrl}`;
    const chatMessage = `*New Assignment*: Task *${title}* (${finalId}) has been assigned to *${newOwner}* by ${currentUser}.\n<${appUrl}|View Task>`;

    sendMaskedEmail_({ to: recipientEmails.join(','), subject: subject, htmlBody: emailBody.replace(/\n/g, '<br>') });
    sendToChat_(chatMessage, 'notification');
  } catch (e) {
    console.error(`Assignment notification failed for ${finalId}: ${e.message}`);
  }
}

/**
 * Sends a notification when a workflow action occurs (Approve, Decline, Return).
 * @param {string} itemId
 * @param {string} itemTitle
 * @param {string} actionType
 * @param {string} nextAssigned Email of the next person assigned (if any)
 * @param {string} notes
 */
/**
 * Sends a clear "Declined" email to the item's owners/assigned team only.
 */

/**
 * Helper to fetch the Owner of an item from the spreadsheet.
 */
function getItemOwner_(itemId) {
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        for (const sName of ['Tasks', 'Projects', 'Sub_Tasks']) {
            const sh = ss.getSheetByName(sName);
            if (!sh) continue;
            const data = sh.getDataRange().getValues();
            const headers = data[0];
            const idCol = headers.indexOf('ID');
            const ownerCol = headers.indexOf('Owner');
            if (idCol < 0 || ownerCol < 0) continue;
            
            const row = data.find(r => String(r[idCol]) === String(itemId));
            if (row) {
                const rawOwner = row[ownerCol] || '';
                // The owner usually has format: "John Doe - CODE <email@gsa.gov>"
                // Try to extract just the name part before the dash or brackets
                let name = rawOwner.split('<')[0].split('-')[0].trim();
                return name || rawOwner || 'Unknown Owner';
            }
        }
    } catch(e) {
        console.warn("Could not fetch owner for " + itemId + ": " + e.message);
    }
    return 'Unknown Owner';
}

function sendDeclineNotification_(itemId, itemTitle, declinedBy, notes, steps, primaryDocUrl, owners) {
  try {
    if (!owners || owners.length === 0) return;
    const resolvedEmails = resolveRecipientEmails_(owners);
    if (resolvedEmails.length === 0) return;
    
    const subject = `Routing Declined: ${itemId} - ${itemTitle}`;
    const baseUrl = ScriptApp.getService().getUrl();
    const appUrl = baseUrl + '?id=' + itemId;
    
    let docUrl = primaryDocUrl;
    if (docUrl && !docUrl.startsWith('http')) docUrl = 'https://docs.google.com/document/d/' + docUrl;
    const docLinkHtml = docUrl ? `<p><strong>Document:</strong> <a href="${docUrl}">View Document</a></p>` : '';
    
    const timelineHtml = (steps && steps.length > 0) ? generateRoutingTimelineHtml_(steps) : '';
    
    const body = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 650px;">
        <h2 style="color: #d93025;">❌ Approval Routing Declined</h2>
        <p>The approval routing for the following item has been <strong>declined</strong> and the workflow has been cancelled.</p>
        <p><strong>Item:</strong> <a href="${appUrl}">${itemId} - ${itemTitle}</a></p>
        <p><strong>Item Owner:</strong> ${getItemOwner_(itemId)}</p>
        <p><strong>Declined By:</strong> ${declinedBy}</p>
        <p><strong>Notes / Reason:</strong> ${notes || 'No reason provided.'}</p>
        ${docLinkHtml}
        ${timelineHtml ? '<h3>Routing History at Time of Decline:</h3>' + timelineHtml : ''}
        <p style="color: #666; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 15px;">
          The item has been returned to Draft status. The owner may restart the routing process after making revisions.
        </p>
      </div>
    `;
    
    sendMaskedEmail_({ to: resolvedEmails.join(','), subject: subject, htmlBody: body });
  } catch (e) {
    console.error('sendDeclineNotification_ failed: ' + e.message);
  }
}

/**
 * Sends a "Returned for Revision" email to the item's owners/assigned team only.
 */
function sendReturnNotification_(itemId, itemTitle, returnedBy, notes, steps, primaryDocUrl, owners) {
  try {
    if (!owners || owners.length === 0) return;
    const resolvedEmails = resolveRecipientEmails_(owners);
    if (resolvedEmails.length === 0) return;
    
    const subject = `Routing Returned for Revision: ${itemId} - ${itemTitle}`;
    const baseUrl = ScriptApp.getService().getUrl();
    const appUrl = baseUrl + '?id=' + itemId;
    
    let docUrl = primaryDocUrl;
    if (docUrl && !docUrl.startsWith('http')) docUrl = 'https://docs.google.com/document/d/' + docUrl;
    const docLinkHtml = docUrl ? `<p><strong>Document:</strong> <a href="${docUrl}">View Document</a></p>` : '';
    
    const timelineHtml = (steps && steps.length > 0) ? generateRoutingTimelineHtml_(steps) : '';
    
    const body = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 650px;">
        <h2 style="color: #e37400;">↩️ Approval Routing Returned for Revision</h2>
        <p>The following item has been <strong>returned to the owner</strong> for revision. The routing workflow has been paused.</p>
        <p><strong>Item:</strong> <a href="${appUrl}">${itemId} - ${itemTitle}</a></p>
        <p><strong>Item Owner:</strong> ${getItemOwner_(itemId)}</p>
        <p><strong>Returned By:</strong> ${returnedBy}</p>
        <p><strong>Notes / Reason:</strong> ${notes || 'No reason provided.'}</p>
        ${docLinkHtml}
        ${timelineHtml ? '<h3>Routing History at Time of Return:</h3>' + timelineHtml : ''}
        <p style="color: #666; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 15px;">
          The item is now in Draft status. Once revisions are complete, the owner may restart the approval routing.
        </p>
      </div>
    `;
    
    sendMaskedEmail_({ to: resolvedEmails.join(','), subject: subject, htmlBody: body });
  } catch (e) {
    console.error('sendReturnNotification_ failed: ' + e.message);
  }
}

/**
 * Sends a unified email to all stakeholders when an advanced workflow starts.
 */
function sendUnifiedWorkflowStartNotification_(itemId, itemTitle, workflowSteps, allStakeholders, primaryDocUrl, delayVal, delayUnit) {
  try {
    if (!allStakeholders || allStakeholders.length === 0) return;
    
    const subject = `${itemTitle} Approval Routing`;
    const appUrl = ScriptApp.getService().getUrl() + '?id=' + itemId;
    const timelineHtml = generateRoutingTimelineHtml_(workflowSteps);
    
    let docUrl = primaryDocUrl;
    if (docUrl && !docUrl.startsWith('http')) docUrl = 'https://docs.google.com/document/d/' + docUrl;
    const docLinkHtml = docUrl ? `<p><strong>Document Link:</strong> <a href="${docUrl}">View Document</a></p>` : '';
    
    let delayText = '';
    if (delayVal && delayVal > 0) {
        let calcDate = new Date();
        if (delayUnit === 'Days') calcDate.setDate(calcDate.getDate() + parseInt(delayVal));
        else calcDate.setHours(calcDate.getHours() + parseInt(delayVal));
        delayText = `<div style="background-color: #fff3cd; color: #856404; padding: 10px; margin: 15px 0; border: 1px solid #ffeeba; border-radius: 4px;">
          <strong>Open for Comments:</strong> This document is open for comments before official routing begins. The first approver will receive their action email around ${calcDate.toLocaleString()}.
        </div>`;
    }
    
    const body = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 650px;">
        <h2>Approval Routing Initiated</h2>
        ${delayText}
        <p>The task <strong>${itemId} - ${itemTitle}</strong> has begun the final approval routing workflow.</p>
        
        <h3>Routing Sequence:</h3>
        ${timelineHtml}
        
        ${docLinkHtml}
        
        <p><strong>FACT Dashboard:</strong> <a href="${appUrl}">Click here to view the task and track approval status</a></p>
        
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">
          * Note: You will receive action emails from FACT when it is your turn to approve.
          You can track the live status at any time via the FACT Dashboard link above.
        </p>
      </div>
    `;
    
    const resolvedEmails = resolveRecipientEmails_(allStakeholders);
    if (resolvedEmails.length === 0) return;

    sendMaskedEmail_({
      to: resolvedEmails.join(','),
      subject: subject,
      htmlBody: body
    });
    
  } catch (e) {
    console.error("Unified notification failed: " + e.message);
  }
}


/**
 * FACT-Native: Sends an email to approvers with 1-click action buttons.
 * For FYI steps, sends an informational email WITHOUT Approve/Decline buttons.
 */
function sendApprovalActionEmail_(itemId, itemTitle, stepObj, approvers, primaryDocUrl, fullStepsArray, isReminder = false) {
  try {
    if (!approvers || approvers.length === 0) return;
    
    // FIX 6: Use case-insensitive type checks instead of strict equality
    const typeLower = (stepObj.type || '').toLowerCase().trim();
    const isNonBlockingFyi = (typeLower === 'fyi' || typeLower === 'fyi awareness' || typeLower === 'fyi_awareness');
    const isBlockingFyi = (typeLower === 'fyi executive prep' || typeLower === 'fyi_executive_prep' || typeLower === 'fyi prep' || typeLower === 'fyi_prep');
    const isAnyFyi = isNonBlockingFyi || isBlockingFyi;
    
    const prefix = isReminder ? "REMINDER: " : "";
    const subject = isAnyFyi
      ? `${prefix}FYI / Awareness: ${itemId} Approval Routing (${stepObj.role})`
      : `${prefix}Action Required: ${itemId} Approval (${stepObj.role})`;
    const baseUrl = ScriptApp.getService().getUrl();
    const appUrl = baseUrl + '?id=' + itemId;
    
    let docUrl = primaryDocUrl;
    if (docUrl && !docUrl.startsWith('http')) docUrl = 'https://docs.google.com/document/d/' + docUrl;
    const docLinkHtml = docUrl ? `<p><strong>Review Document:</strong> <a href="${docUrl}">Click here to view</a></p>` : '';
    
    // Build a live routing timeline to embed in the email
    // FIX 7/8: Accept both JSON strings and arrays for fullStepsArray
    let timelineHtml = '';
    let stepsForTimeline = [];
    if (fullStepsArray) {
        if (typeof fullStepsArray === 'string' && (fullStepsArray.startsWith('[') || fullStepsArray.startsWith('{'))) {
            try {
                const parsed = JSON.parse(fullStepsArray);
                stepsForTimeline = Array.isArray(parsed) ? parsed : (parsed.steps || []);
            } catch(e) {}
        } else if (Array.isArray(fullStepsArray)) {
            stepsForTimeline = fullStepsArray;
        }
    }
    if (stepsForTimeline.length > 0) {
        timelineHtml = generateRoutingTimelineHtml_(stepsForTimeline);
    } else {
        try {
          const ss = SpreadsheetApp.getActiveSpreadsheet();
      for (const sName of ['Tasks', 'Projects', 'Sub_Tasks']) {
        const sh = ss.getSheetByName(sName);
        if (!sh) continue;
        const data = sh.getDataRange().getValues();
        const headers = data[0];
        const wfCol = headers.indexOf('WorkflowStep');
        const idCol = headers.indexOf('ID');
        if (wfCol < 0 || idCol < 0) continue;
        const row = data.find(r => String(r[idCol]) === String(itemId));
        if (!row) continue;
        const wfStr = String(row[wfCol] || '');
        if (wfStr.startsWith('[') || wfStr.startsWith('{')) {
          const parsed = JSON.parse(wfStr);
          const steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
          timelineHtml = generateRoutingTimelineHtml_(steps);
        }
        break;
      }
    } catch(e) {
      console.warn('Could not build timeline for email: ' + e.message);
    }
    }
    
    approvers.forEach(approver => {
        if (!approver.trim()) return;
        
        // FIX 6: Button logic by type
        let actionButtonsHtml = '';
        if (!isAnyFyi) {
          // Normal Sequential/Parallel: Approve + Decline buttons
          const u = encodeURIComponent(approver.trim());
          const approveUrl = baseUrl + `?page=action&id=${itemId}&action=Approve&u=${u}`;
          const declineUrl = baseUrl + `?page=action&id=${itemId}&action=Decline&u=${u}`;
          actionButtonsHtml = `
            <div style="margin-top: 30px;">
              <a href="${approveUrl}" style="background-color: #0f9d58; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin-right: 15px;">Approve</a>
              <a href="${declineUrl}" style="background-color: #d93025; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Decline / Return</a>
            </div>`;
        } else if (isBlockingFyi) {
          // FYI Executive Prep: Accept-only button (no Decline)
          const u = encodeURIComponent(approver.trim());
          const acceptUrl = baseUrl + `?page=action&id=${itemId}&action=Approve&u=${u}`;
          actionButtonsHtml = `
            <div style="margin-top: 30px;">
              <a href="${acceptUrl}" style="background-color: #1a73e8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Accept / Acknowledge</a>
            </div>`;
        }
        // FYI Awareness: no buttons at all
        
        const fyiBannerHtml = isAnyFyi ? `
          <div style="background:#e8f0fe; border-left:4px solid #4285f4; padding:12px 16px; margin:15px 0; border-radius:0 4px 4px 0;">
            <strong style="color:#1a73e8;">ℹ️ ${isBlockingFyi ? 'FYI / Executive Prep — Action Required' : 'FYI / Awareness Only'}</strong><br>
            <span style="color:#555; font-size:0.95em;">${isBlockingFyi ? 'Please review and accept/acknowledge this item before routing continues.' : 'This is an informational notification. No further action is required from you at this step.'}</span>
          </div>` : '';
        
        const introText = isReminder
          ? (isAnyFyi ? 'REMINDER: You are being reminded of the following item in the approval routing process:' : 'REMINDER: You are requested to review and approve the following item:')
          : (isAnyFyi ? 'You are being notified that the following item is in the approval routing process:' : 'You are requested to review and approve the following item:');

        const body = `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 650px;">
            <h2 style="color: ${isAnyFyi ? '#4285f4' : '#1a73e8'}">${isReminder ? 'REMINDER: ' : ''}${isAnyFyi ? 'FYI: Approval Routing Update' : 'Approval Required'}</h2>
            ${fyiBannerHtml}
            <p>${isReminder ? '<strong>' + introText + '</strong>' : introText}</p>
            <p><strong>Item:</strong> ${itemId} - ${itemTitle}</p>
        <p><strong>Item Owner:</strong> ${getItemOwner_(itemId)}</p>
            <p><strong>Your Role:</strong> ${stepObj.role}</p>
            
            ${docLinkHtml}
            
            ${timelineHtml ? '<h3 style="margin-top:20px;">Approval Routing Status:</h3>' + timelineHtml : ''}
            
            ${actionButtonsHtml}
            
            <p style="margin-top: 30px; font-size: 0.9em; color: #666;">View full details on the <a href="${appUrl}">FACT Dashboard</a>.</p>
          </div>
        `;
        
        sendMaskedEmail_({
          to: approver.trim(),
          subject: subject,
          htmlBody: body
        });
    });
    
  } catch (e) {
    console.error("Action email failed: " + e.message);
  }
}

/**
 * Sends a completion notification when the workflow is fully approved.
 * Includes the full routing timeline and action log.
 */
function sendWorkflowCompletionNotification_(itemId, itemTitle, owners, primaryDocUrl, steps, log) {
  try {
    if (!owners || owners.length === 0) return;
    
    const subject = `✅ Approval Complete: ${itemId} - ${itemTitle}`;
    const baseUrl = ScriptApp.getService().getUrl();
    const appUrl = baseUrl + '?id=' + itemId;
    
    let docUrl = primaryDocUrl;
    if (docUrl && !docUrl.startsWith('http')) docUrl = 'https://docs.google.com/document/d/' + docUrl;
    const docLinkHtml = docUrl ? `<p><strong>Approved Document:</strong> <a href="${docUrl}">View Document</a></p>` : '';
    
    const timelineHtml = (steps && steps.length > 0) ? generateRoutingTimelineHtml_(steps) : '';
    
    // Build action log HTML
    let logHtml = '';
    if (log && log.length > 0) {
      logHtml = `<h3 style="margin-top:20px;">Approval Activity Log:</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 650px; font-family: Arial, sans-serif; font-size: 0.85em;">
          <thead>
            <tr style="background-color: #f1f3f4;">
              <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left;">Activity</th>
            </tr>
          </thead>
          <tbody>`;
      log.forEach((entry, i) => {
        const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
        logHtml += `<tr style="background:${bg};"><td style="padding: 8px 12px; border: 1px solid #ddd; color: #333;">${entry}</td></tr>`;
      });
      logHtml += '</tbody></table>';
    }
    
    const body = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 650px;">
        <h2 style="color: #188038;">✅ Approval Routing Complete</h2>
        <p>The following item has been <strong>fully approved</strong> through all routing steps.</p>
        <p><strong>Item:</strong> <a href="${appUrl}">${itemId} - ${itemTitle}</a></p>
        <p><strong>Item Owner:</strong> ${getItemOwner_(itemId)}</p>
        ${docLinkHtml}
        ${timelineHtml ? '<h3>Final Routing Status:</h3>' + timelineHtml : ''}
        ${logHtml}
        <p style="color: #666; font-size: 0.9em; border-top: 1px solid #eee; padding-top: 15px;">
          A stamped copy of the approved document has been automatically saved to the item's Drive folder.
        </p>
      </div>
    `;
    
    const resolvedEmails = resolveRecipientEmails_(owners);
    if (resolvedEmails.length > 0) {
        sendMaskedEmail_({ to: resolvedEmails.join(','), subject: subject, htmlBody: body });
    }
    
    // Chat webhook integration
    const webhookUrl = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK')
      || PropertiesService.getScriptProperties().getProperty('NOTIFICATION_CHAT_WEBHOOK')
      || PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL');
    if (webhookUrl && webhookUrl.trim() !== '') {
        const chatPayload = { "text": `✅ *Workflow Fully Approved*\n*Item:* ${itemId} - ${itemTitle}\n*Link:* ${appUrl}` };
        UrlFetchApp.fetch(webhookUrl, { method: 'post', contentType: 'application/json', payload: JSON.stringify(chatPayload), muteHttpExceptions: true });
    }
    
  } catch (e) {
    console.error("Completion notification failed: " + e.message);
  }
}

/**
 * Sends a chat notification to a Google Chat webhook URL stored in Script Properties.
 * If the property 'CHAT_WEBHOOK_URL' is not set, it logs a warning and exits gracefully.
 * @param {string} message The text message to send to the chat space.
 */
function sendChatNotification_(message) {
  try {
    const webhookUrl = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK')
      || PropertiesService.getScriptProperties().getProperty('NOTIFICATION_CHAT_WEBHOOK')
      || PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK_URL');
    if (!webhookUrl) {
      console.warn("Chat webhook URL is not configured. Skipping chat notification.");
      return;
    }
    
    const payload = {
      text: message
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    UrlFetchApp.fetch(webhookUrl, options);
  } catch (e) {
    console.error("Failed to send chat notification: " + e.message);
  }
}

/**
 * Generates an HTML routing timeline table showing step status with color coding.
 * Used in emails, the approval page, and elsewhere.
 * @param {Array} steps - Array of workflow step objects.
 * @returns {string} - HTML string for the timeline.
 */
function generateRoutingTimelineHtml_(steps) {
  if (!steps || steps.length === 0) return '';
  
  const statusConfig = {
    'Approved':     { color: '#0f9d58', bg: '#e6f4ea', icon: '✅', label: 'Approved' },
    'FYI_Complete': { color: '#4285f4', bg: '#e8f0fe', icon: 'ℹ️', label: 'Notified (FYI)' },
    'Pending':      { color: '#f9ab00', bg: '#fef7e0', icon: '⏳', label: 'Pending Action' },
    'Declined':     { color: '#d93025', bg: '#fce8e6', icon: '❌', label: 'Declined' },
    'Returned':     { color: '#e37400', bg: '#fce8e6', icon: '↩️', label: 'Returned' },
    'Removed':      { color: '#80868b', bg: '#f1f3f4', icon: '🚫', label: 'Removed/Skipped' },
    'Configured':   { color: '#80868b', bg: '#f1f3f4', icon: '⚪', label: 'Queued' }
  };
  
  let html = `<table style="border-collapse: collapse; width: 100%; max-width: 650px; margin: 16px 0; font-family: Arial, sans-serif; font-size: 0.9em;">
    <thead>
      <tr style="background-color: #f1f3f4;">
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Step</th>
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Role</th>
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Approver(s)</th>
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Type</th>
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Status</th>
        <th style="padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-weight: 600; color: #333;">Comments</th>
      </tr>
    </thead>
    <tbody>`;

  steps.forEach((step, idx) => {
    const rawStatus = step.status || 'Configured';
    const cfg = statusConfig[rawStatus] || statusConfig['Configured'];
    const approverList = Array.isArray(step.approvers)
      ? step.approvers.join('<br>')
      : (step.approvers || '');
    
    let approvedAtStr = '';
    if (step.approvedAt) {
      try {
        approvedAtStr = `<br><small style="color:#888;">${new Date(step.approvedAt).toLocaleString()}</small>`;
      } catch(e) {}
    }

    const commentsList = (step.approverComments && step.approverComments.length > 0) 
      ? step.approverComments.join('<br>') 
      : '';
      
    html += `<tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; color: #333;">${idx + 1}</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd; color: #333;">${step.role || ''}</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd; color: #555;">${approverList}</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd; color: #555;">${step.type || ''}</td>
      <td style="padding: 8px 12px; border: 1px solid #ddd; background-color: ${cfg.bg};">
        <span style="color: ${cfg.color}; font-weight: 600;">${cfg.icon} ${cfg.label}</span>${approvedAtStr}
      </td>
      <td style="padding: 8px 12px; border: 1px solid #ddd; color: #555; font-size: 0.9em; max-width: 200px;">${commentsList}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  html += '<p style="color: #666; font-size: 0.82em; font-style: italic; margin-top: 8px;">* Note: This routing timeline table is static and current as of the time this email was sent. It does not reflect subsequent workflow status changes.</p>';
  return html;
}

/**
 * Helper to send email using GmailApp, masking the sender if SYSTEM_EMAIL_ALIAS is set.
 */
function sendMaskedEmail_(options) {
    const to = options.to;
    const subject = options.subject;
    const plainBody = options.body || (options.htmlBody ? options.htmlBody.replace(/<[^>]+>/g, '') : '');
    
    const advancedOptions = { ...options };
    delete advancedOptions.to;
    delete advancedOptions.subject;
    delete advancedOptions.body;
    
    // Force all system emails to come from noreply
    advancedOptions.noReply = true;
    advancedOptions.name = advancedOptions.name || 'FACT System';
    
    // Ensure replies route back to the group email so processGroupEmails can capture them
    if (!advancedOptions.replyTo) {
        try {
            const config = loadConfig_();
            if (config.groupEmail) {
                advancedOptions.replyTo = config.groupEmail.split(',')[0].trim();
            }
        } catch(e) {}
    }
    
    try {
        GmailApp.sendEmail(to, subject, plainBody, advancedOptions);
    } catch(e) {
        console.error("sendMaskedEmail_ failed: " + e.message);
    }
}
