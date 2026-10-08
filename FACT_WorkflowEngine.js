// ==========================================
// WORKFLOW & APPROVALS ENGINE
// ==========================================

function isNonBlockingFYI_(type) {
  const t = (type || '').toLowerCase().trim();
  return t === 'fyi' || t === 'fyi awareness' || t === 'fyi_awareness';
}

function isBlockingFYI_(type) {
  const t = (type || '').toLowerCase().trim();
  return t === 'fyi_prep' || t === 'fyi executive prep' || t === 'fyi prep';
}

function isAnyFYI_(type) {
  return isNonBlockingFYI_(type) || isBlockingFYI_(type);
}

/**
 * Grants editor access to the routed document for a set of workflow participants
 * and records the outcome on the item.
 *
 * Every approval path calls this, so an approver cannot be emailed an Approve
 * button for a document they cannot open. Sharing is attempted at workflow
 * start, on every step advance, and on delegation — a later approver is not
 * known at start time, and a delegate is not known until an admin reassigns.
 *
 * Failures are surfaced, not swallowed: a note is written to the item so the
 * owner can see which participants still lack access. This is deliberately
 * non-fatal — a sharing failure must not block the approval itself, because the
 * document may be owned outside the organization or live on a Shared Drive the
 * deploying account cannot administer.
 *
 * @param {string} itemId       The item ID, for the audit note.
 * @param {string} primaryDoc   Drive URL or ID of the routed document.
 * @param {Array<string>} identifiers Names and/or emails, any supported format.
 * @param {string} context      Short phrase naming the trigger, for the log.
 * @returns {{granted: Array<string>, failed: Array<string>}}
 * @private
 */
function shareDocWithParticipants_(itemId, primaryDoc, identifiers, context) {
  const outcome = { granted: [], failed: [] };
  if (!primaryDoc || !identifiers || identifiers.length === 0) return outcome;
  if (typeof grantDocAccessFast_ !== 'function') {
    console.error(`shareDocWithParticipants_: grantDocAccessFast_ unavailable (${context})`);
    return outcome;
  }

  try {
    const result = grantDocAccessFast_(primaryDoc, identifiers);
    outcome.granted = result.granted || [];
    outcome.failed = result.failed || [];

    if (outcome.granted.length > 0) {
      console.log(`Doc access granted (${context}) for ${itemId}: ${outcome.granted.join(', ')}`);
    }

    if (outcome.failed.length > 0) {
      const msg = `⚠️ Could not grant document access to: ${outcome.failed.join(', ')}. ` +
                  `They will be prompted to request access. Share the document manually, ` +
                  `or confirm the deploying account can manage sharing on it. (${context})`;
      console.error(`Doc access FAILED (${context}) for ${itemId}: ${outcome.failed.join(', ')}`);
      try {
        if (typeof addNote === 'function') addNote(itemId, msg, 'System.Drive');
      } catch(noteErr) {
        console.warn("Could not log doc-access failure note: " + noteErr.message);
      }
    }
  } catch(e) {
    // Non-fatal by design — see the note above. Logged, never silent.
    console.error(`shareDocWithParticipants_ threw (${context}) for ${itemId}: ${e.message}`);
  }

  return outcome;
}

/**
 * Public endpoint called by google.script.run from the UI.
 * @param {string} itemId The item ID to advance
 * @param {string} actionType 'Approve', 'Decline', or 'Return'
 * @param {string} notes Required for Decline/Return, optional for Approve
 */
function advanceWorkflow(itemId, actionType, notes) {
  try {
    advanceWorkflow_(itemId, actionType, notes);
    return { success: true };
  } catch (e) {
    console.error("advanceWorkflow error: " + e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Public endpoint to start an advanced workflow.
 */
function startAdvancedWorkflow(itemId, workflowSteps, notes, delayVal, delayUnit, primaryDoc) {
  try {
    // Strip empty steps
    workflowSteps = (workflowSteps || []).filter(step => step.approvers && step.approvers.length > 0 && step.approvers.some(a => a.trim()));
    if (workflowSteps.length === 0) throw new Error("No valid steps specified with approvers.");
    
        const ts = formatEasternTimestamp_();
    const currentUser = Session.getActiveUser().getEmail().split('@')[0];
    
    // Auto-advance through consecutive non-blocking FYI steps at start
    let firstStepIdx = 0;
    let firstStep = workflowSteps[firstStepIdx];
    
    while (firstStep && isNonBlockingFYI_(firstStep.type)) {
        firstStep.status = 'FYI_Complete';
        firstStep.sentAt = new Date().toISOString();
        firstStep.approvedAt = new Date().toISOString();
        firstStepIdx++;
        firstStep = workflowSteps[firstStepIdx];
    }
    
    let nextAssigned = '';
    let initialLog = '';
    
    if (firstStep) {
        firstStep.status = 'Pending';
        firstStep.sentAt = new Date().toISOString();
        nextAssigned = firstStep.approvers.join(', ');
        initialLog = `[${ts}] ${currentUser} started routing for review via ${nextAssigned} with comment: ${notes}`;
    } else {
        // All steps were FYI and are now complete!
        initialLog = `[${ts}] ${currentUser} started routing (all FYI steps complete) with comment: ${notes}`;
    }
    
    let itemTitle = itemId;
    let ownerStr = '';
    let assignedStr = '';
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    
    let foundSheet = null;
    let foundRowIdx = -1;
    let headers = [];
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       headers = data[0];
       let found = false;
       for(let i=1; i<data.length; i++) {
          if(String(data[i][0]) === String(itemId)) {
             itemTitle = data[i][headers.indexOf('Title')] || itemId;
             ownerStr = data[i][headers.indexOf('Owner')] || '';
             assignedStr = data[i][headers.indexOf('Assigned')] || '';
             foundSheet = sh;
             foundRowIdx = i+1;
             found = true;
             break;
          }
       }
       if(found) break;
    }
    
    if(!foundSheet) throw new Error("Item not found");

    let history = [];
    const wfColIdx = headers.indexOf('WorkflowStep');
    if (wfColIdx >= 0) {
        const existingWfVal = foundSheet.getRange(foundRowIdx, wfColIdx + 1).getValue() || '';
        if (existingWfVal.startsWith('[') || existingWfVal.startsWith('{')) {
            try {
                const parsed = JSON.parse(existingWfVal);
                history = parsed.history || [];
            } catch(e) {}
        }
    }

    const workflowObj = {
       steps: workflowSteps,
       log: [initialLog],
       originalAssigned: assignedStr,
       history: history
    };
    
    // If there is a comment period delay, we store it in the JSON so client can display it
    let waitMs = 0;
    if (firstStep && delayVal && delayVal > 0) {
        if (delayUnit === 'Days') waitMs = delayVal * 24 * 60 * 60 * 1000;
        else if (delayUnit === 'Hours') waitMs = delayVal * 60 * 60 * 1000;
    }
    
    if (waitMs > 0) {
        workflowObj.delayUntil = new Date(new Date().getTime() + waitMs).toISOString();
    }
    
    const workflowStr = JSON.stringify(workflowObj);
    
    // Determine overall ExecStatus
    let targetExecStatus = 'Routing';
    if (!firstStep) {
        targetExecStatus = 'Approved';
    } else if (waitMs > 0) {
        targetExecStatus = 'Comment Period';
    }
    
    const updates = {
      WorkflowStep: workflowStr,
      ExecStatus: targetExecStatus,
      Primary_Doc_ID: primaryDoc || ''
    };
    
    // Ensure Primary_Doc_ID column exists before writing
    if (headers.indexOf('Primary_Doc_ID') === -1) {
        const newCol = foundSheet.getMaxColumns() + 1;
        foundSheet.insertColumnsAfter(foundSheet.getMaxColumns(), 1);
        foundSheet.getRange(1, newCol).setValue('Primary_Doc_ID');
        headers.push('Primary_Doc_ID');
    }
    
    Object.keys(updates).forEach(key => {
        const colIdx = headers.indexOf(key);
        if (colIdx >= 0) foundSheet.getRange(foundRowIdx, colIdx+1).setValue(updates[key]);
    });
    
    addNote(itemId, notes, "System");
    if (typeof logActivity_ === 'function') {
        logActivity_(Session.getActiveUser().getEmail(), itemId, itemTitle, "Workflow Started", initialLog);
    }
    
    // Collect all stakeholders
    let stakeholders = [];
    if(ownerStr) stakeholders = stakeholders.concat(ownerStr.split(',').map(s=>s.trim()));
    if(assignedStr) stakeholders = stakeholders.concat(assignedStr.split(',').map(s=>s.trim()));
    workflowSteps.forEach(step => {
       if(step.approvers) stakeholders = stakeholders.concat(step.approvers.map(s=>s.trim()));
    });
    stakeholders = [...new Set(stakeholders)].filter(s => s);
    
    // Grant every workflow participant editor access to the routed document.
    //
    // This previously hand-rolled its own Drive call and passed each identifier
    // straight through as `emailAddress`. The approver fields use an
    // autocomplete that writes "First Last <email@gsa.gov>", so the API received
    // a display string, rejected it with HTTP 400, and — because the request set
    // muteHttpExceptions with no response-code check inside a console-only catch
    // — the failure was invisible. Approvers then hit "Request access".
    //
    // grantDocAccessFast_ reuses the same identifier resolution as folder
    // sharing (angle brackets, bare emails, Stakeholders name lookup), passes
    // supportsAllDrives, and reports which addresses failed.
    if (primaryDoc) {
        shareDocWithParticipants_(itemId, primaryDoc, stakeholders, 'workflow start');
    }
    
    // Send FYI emails for any start-time auto-completed FYI steps
    let currentIdx = 0;
    while (currentIdx < firstStepIdx) {
        if (typeof sendApprovalActionEmail_ === 'function') {
            sendApprovalActionEmail_(itemId, itemTitle, workflowSteps[currentIdx], workflowSteps[currentIdx].approvers, primaryDoc, workflowStr);
        }
        currentIdx++;
    }
    
    // Send Unified FACT Email Notification (FYI to everyone)
    if (typeof sendUnifiedWorkflowStartNotification_ === 'function') {
        sendUnifiedWorkflowStartNotification_(itemId, itemTitle, workflowSteps, stakeholders, primaryDoc, delayVal, delayUnit);
    }
    
    // Send 1-Click Action Email to the FIRST blocking step approver(s)
    if (firstStep) {
        if (waitMs > 0) {
            const ts = new Date().getTime();
            const propKey = 'wfStep1Job_' + ts;
            PropertiesService.getScriptProperties().setProperty(propKey, JSON.stringify({
                itemId: itemId,
                itemTitle: itemTitle,
                step: firstStep,
                approvers: firstStep.approvers,
                primaryDoc: primaryDoc,
                workflowStr: workflowStr
            }));
            ScriptApp.newTrigger('processAsyncWorkflowStep1_')
                .timeBased()
                .after(waitMs)
                .create();
        } else {
            if (typeof sendApprovalActionEmail_ === 'function') {
                sendApprovalActionEmail_(itemId, itemTitle, firstStep, firstStep.approvers, primaryDoc, workflowStr);
            }
        }
    
        if (primaryDoc && typeof stampRoutingTimeline_ === 'function') {
            const match = String(primaryDoc).match(/[-\w]{25,}/);
            if (match) {
                // Initial stamping has been disabled per user request.
                // We will wait until the workflow finishes to stamp the final log.
            }
        }
    }
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Public endpoint to override an approver in a workflow step.
 */
function overrideAdvancedWorkflow(itemId, stepIndex, newEmail, oldEmail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    let found = false;
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       const headers = data[0];
       const wfCol = headers.indexOf('WorkflowStep');
       if(wfCol < 0) continue;
       
       for(let i=1; i<data.length; i++) {
          if(String(data[i][0]) === String(itemId)) {
              let wfStr = data[i][wfCol];
              if (wfStr.startsWith('[') || wfStr.startsWith('{')) {
                  let parsed = JSON.parse(wfStr);
                  let steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                  let log = Array.isArray(parsed) ? [] : (parsed.log || []);
                  let originalAssigned = Array.isArray(parsed) ? '' : (parsed.originalAssigned || '');
                  let history = Array.isArray(parsed) ? [] : (parsed.history || []);
                  
                  if (steps[stepIndex]) {
                      const isPending = (steps[stepIndex].status === 'Pending');
                      
                      if (oldEmail) {
                          const oldEmailLower = oldEmail.toLowerCase().trim();
                          const idx = steps[stepIndex].approvers.map(a => a.toLowerCase().trim()).indexOf(oldEmailLower);
                          if (idx >= 0) {
                              steps[stepIndex].approvers[idx] = newEmail;
                          } else {
                              steps[stepIndex].approvers.push(newEmail);
                          }
                          // If they approved under the old email, swap that email in approvedBy too so their approval carries over
                          if (steps[stepIndex].approvedBy) {
                              const approveIdx = steps[stepIndex].approvedBy.map(a => a.toLowerCase().trim()).indexOf(oldEmailLower);
                              if (approveIdx >= 0) {
                                  steps[stepIndex].approvedBy[approveIdx] = newEmail;
                              }
                          }
                      } else if (steps[stepIndex].type === 'Sequential' || steps[stepIndex].approvers.length === 1) {
                          steps[stepIndex].approvers = [newEmail];
                      } else {
                          steps[stepIndex].approvers.push(newEmail);
                      }
                      
                      const noteText = oldEmail ? `Admin overridden step ${stepIndex+1} approver ${oldEmail} to ${newEmail}.` : `Admin overridden step ${stepIndex+1} approver to ${newEmail}.`;
                      addNote(itemId, noteText, "System");
                      

                      // Append override action to log
                      const ts = formatEasternTimestamp_();
                      const actor = Session.getActiveUser().getEmail().split('@')[0];
                      const logMsg = `Admin ${actor} overridden step ${stepIndex+1} to ${newEmail}`;
                      log.unshift(`[${ts}] ${logMsg}`);
                      
                      // Map rowData to object for helper
                      const rowIndex = i + 1;
                      const rowData = {};
                      for(let c=0; c<headers.length; c++) {
                          rowData[headers[c]] = data[i][c];
                      }
                      
                      if (typeof logActivity_ === 'function') {
                          const user = typeof userEmail !== 'undefined' ? userEmail : Session.getActiveUser().getEmail();
                          logActivity_(user, itemId, rowData['Title'] || itemId, "Delegated", logMsg);
                      }
                      
                      const newWfStr = JSON.stringify({
                          steps: steps,
                          log: log,
                          originalAssigned: originalAssigned,
                          history: history
                      });
                      sh.getRange(rowIndex, wfCol + 1).setValue(newWfStr);
                      SpreadsheetApp.flush();
                      
                      // If the step is Pending, notify the new delegate only
                      if (isPending) {
                          // A delegate was unknown at workflow start, so nothing
                          // has ever shared the document with them. Share before
                          // notifying.
                          if (rowData['Primary_Doc_ID']) {
                              shareDocWithParticipants_(
                                  itemId,
                                  rowData['Primary_Doc_ID'],
                                  [newEmail],
                                  'approver delegation'
                              );
                          }

                          if (typeof sendApprovalActionEmail_ === 'function') {
                              sendApprovalActionEmail_(
                                  itemId,
                                  rowData['Title'] || itemId,
                                  steps[stepIndex],
                                  [newEmail],
                                  rowData['Primary_Doc_ID'] || '',
                                  newWfStr
                              );
                          }
                      }
                  }
              }
              found = true;
              break;
          }
       }
       if(found) break;
    }
    
    if(!found) throw new Error("Item not found");
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * Public endpoint to remove an approver from a step.
 */
function removeWorkflowApprover(itemId, stepIndex, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    let found = false;
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       const headers = data[0];
       const wfCol = headers.indexOf('WorkflowStep');
       if(wfCol < 0) continue;
       
       for(let i=1; i<data.length; i++) {
          if(String(data[i][0]) === String(itemId)) {
              let wfStr = data[i][wfCol];
              if (wfStr.startsWith('[') || wfStr.startsWith('{')) {
                  let parsed = JSON.parse(wfStr);
                  let steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                  let log = Array.isArray(parsed) ? [] : (parsed.log || []);
                  let originalAssigned = Array.isArray(parsed) ? '' : (parsed.originalAssigned || '');
                  let history = Array.isArray(parsed) ? [] : (parsed.history || []);
                  
                  if (steps[stepIndex]) {
                      const idx = steps[stepIndex].approvers.indexOf(email);
                      if (idx >= 0) {
                          steps[stepIndex].approvers.splice(idx, 1);
                      }
                      // Also remove from approvedBy if they approved
                      if (steps[stepIndex].approvedBy && steps[stepIndex].approvedBy.includes(email)) {
                          const approveIdx = steps[stepIndex].approvedBy.indexOf(email);
                          if (approveIdx >= 0) steps[stepIndex].approvedBy.splice(approveIdx, 1);
                      }
                      
                      const ts = formatEasternTimestamp_();
                      const actor = Session.getActiveUser().getEmail().split('@')[0];
                      log.unshift(`[${ts}] ${actor} removed approver ${email} from step ${stepIndex+1}`);
                      
                      addNote(itemId, `Admin removed step ${stepIndex+1} approver ${email}.`, "System");
                      
                      // Map rowData to object for helper
                      const rowIndex = i + 1;
                      const rowData = {};
                      for(let c=0; c<headers.length; c++) {
                          rowData[headers[c]] = data[i][c];
                      }
                      
                      // Stamp Document Signature Log that the approver was removed
                      const primaryDocUrl = rowData['Primary_Doc_ID'];
                      if (primaryDocUrl) {
                          const match = String(primaryDocUrl).match(/[-\w]{25,}/);
                          // Legacy signature stamping has been removed.
                      }
                      
                      // Re-evaluate step completion and save/advance state!
                      saveAndAdvanceWorkflowState_(itemId, sh, rowData, rowIndex, steps, log);
                  }
              }
              found = true;
              break;
          }
       }
       if(found) break;
    }
    
    if(!found) throw new Error("Item not found");
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * Shared helper to evaluate step completion, execute transitions, trigger emails,
 * sync permissions, copy documents, and commit all updates to the spreadsheet.
 */
function saveAndAdvanceWorkflowState_(itemId, sheet, rowData, rowIndex, steps, log, explicitUserEmail) {
    let nextExecStatus = rowData['ExecStatus'] || '';
    
    let originalAssigned = '';
    let history = [];
    if (rowData['WorkflowStep'] && (rowData['WorkflowStep'].startsWith('[') || rowData['WorkflowStep'].startsWith('{'))) {
        try {
            const parsed = JSON.parse(rowData['WorkflowStep']);
            if (!Array.isArray(parsed)) {
                originalAssigned = parsed.originalAssigned || '';
                history = parsed.history || [];
            }
        } catch(e) {}
    }

    let nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
    
    let activeStepIdx = steps.findIndex(s => s.status === 'Pending');
    if (activeStepIdx >= 0) {
        let currentStep = steps[activeStepIdx];
        if (!currentStep.approvedBy) currentStep.approvedBy = [];
        
        let stepComplete = false;
        const extractEmail = (str) => {
            const match = str.match(/<([^>]+)>/);
            return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
        };
        
        const typeLower = (currentStep.type || '').toLowerCase().trim();
        const validApprovers = (currentStep.approvers || []).filter(a => a.trim()).map(extractEmail);
        const actualApprovers = (currentStep.approvedBy || []).map(extractEmail);
        
        if (typeLower !== 'parallel') {
            const anyApproved = validApprovers.some(a => actualApprovers.includes(a));
            if (anyApproved || validApprovers.length === 0) stepComplete = true;
        } else {
            const allApproved = validApprovers.every(a => actualApprovers.includes(a));
            if (allApproved || validApprovers.length === 0) stepComplete = true;
        }
        
        if (stepComplete) {
            if (validApprovers.length === 0 && actualApprovers.length === 0) {
                currentStep.status = 'Removed';
            } else {
                currentStep.status = isNonBlockingFYI_(currentStep.type) ? 'FYI_Complete' : 'Approved';
            }
            currentStep.approvedAt = new Date().toISOString();
            
            const primaryDocUrl = rowData['Primary_Doc_ID'] || '';
            
            if (activeStepIdx < steps.length - 1) {
                let nextStepIdx = activeStepIdx + 1;
                let nextStep = steps[nextStepIdx];
                
                // Auto-advance through FYI steps
                while (nextStep && isNonBlockingFYI_(nextStep.type)) {
                    nextStep.status = 'FYI_Complete';
                    nextStep.sentAt = new Date().toISOString();
                    nextStep.approvedAt = new Date().toISOString();
                    if (typeof sendApprovalActionEmail_ === 'function') {
                        sendApprovalActionEmail_(itemId, rowData['Title'] || itemId, nextStep, nextStep.approvers, primaryDocUrl, JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history}));
                    }
                    nextStepIdx++;
                    nextStep = steps[nextStepIdx];
                }
                
                if (nextStep) {
                    nextStep.status = 'Pending';
                    nextStep.sentAt = new Date().toISOString();
                    nextExecStatus = 'Routing';
                    
                    // Share the document with the step we are about to notify.
                    // Start-time sharing cannot cover this: a later approver may
                    // have been added, delegated, or changed since then. Share
                    // BEFORE the email goes out so the Approve button never
                    // arrives ahead of access.
                    if (primaryDocUrl) {
                        shareDocWithParticipants_(
                            itemId,
                            primaryDocUrl,
                            nextStep.approvers || [],
                            `step ${nextStep.step || nextStepIdx + 1} activation`
                        );
                    }

                    if (typeof sendApprovalActionEmail_ === 'function') {
                        sendApprovalActionEmail_(itemId, rowData['Title'] || itemId, nextStep, nextStep.approvers, primaryDocUrl, JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history}));
                    }
                    nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
                } else {
                    nextExecStatus = 'Approved';
                    nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
                }
            } else {
                nextExecStatus = 'Approved';
                nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
            }
            
            if (nextExecStatus === 'Approved') {
                const folderId = rowData['FolderID'];
                if (primaryDocUrl) {
                    const match = String(primaryDocUrl).match(/[-\w]{25,}/);
                    if (match) {
                        // First, stamp the original document with the detailed routing table (must happen before downgrading permissions!)
                        if (typeof stampRoutingTimeline_ === 'function') {
                            try {
                                stampRoutingTimeline_(match[0], steps, itemId, rowData['Title'] || itemId);
                            } catch (e) {
                                console.error("stampRoutingTimeline_ failed: " + e.message);
                            }
                        }
                        
                        // Wait 3 seconds for Google Drive's backend to fully sync the slide/doc changes
                        // before making a copy, otherwise the copy might be of an older version.
                        Utilities.sleep(3000);
                        
                        // User explicitly requested to KEEP permissions as they are, no downgrading to commenters.
                        
                        // Then, create the archived copy (which will now inherit the detailed table)
                        if (typeof createApprovedDocumentCopy_ === 'function') {
                            createApprovedDocumentCopy_(match[0], folderId, rowData['Title'], steps, log);
                        }
                    }
                }
                
                if (typeof sendChatNotification_ === 'function') {
                    const msg = `*APPROVAL COMPLETE:* ${itemId} - ${rowData['Title']} has been fully approved.`;
                    sendChatNotification_(msg);
                }
                
                if (typeof sendWorkflowCompletionNotification_ === 'function') {
                    const completionOwners = [];
                    if(rowData['Owner']) rowData['Owner'].split(',').forEach(e => { if(e.trim()) completionOwners.push(e.trim()); });
                    if(originalAssigned) originalAssigned.split(',').forEach(e => { if(e.trim()) completionOwners.push(e.trim()); });
                    sendWorkflowCompletionNotification_(itemId, rowData['Title'], [...new Set(completionOwners)], primaryDocUrl, steps, log);
                }
            }
            
        } else {
            nextExecStatus = 'Routing';
            nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
        }
    }
    
    // Write back to sheet (We need column indices)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const updates = {
       'ExecStatus': nextExecStatus,
       'WorkflowStep': nextWorkflowStep
    };
    
    Object.keys(updates).forEach(key => {
        const colIdx = headers.indexOf(key);
        if (colIdx >= 0) {
            sheet.getRange(rowIndex, colIdx + 1).setValue(updates[key]);
        }
    });
    
    SpreadsheetApp.flush();
}


/**
 * Returns a formatted Eastern Time timestamp string.
 */
function formatEasternTimestamp_() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

function sendApprovalReminderBackend(itemId, stepIndex) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    let found = false;
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       const headers = data[0];
       const wfCol = headers.indexOf('WorkflowStep');
       const titleCol = headers.indexOf('Title');
       const docCol = headers.indexOf('Primary_Doc_ID');
       if(wfCol < 0) continue;
       
       for(let i=1; i<data.length; i++) {
          if(String(data[i][0]) === String(itemId)) {
              let wfStr = data[i][wfCol];
              let title = titleCol >= 0 ? data[i][titleCol] : itemId;
              let primaryDocUrl = docCol >= 0 ? data[i][docCol] : '';
              if (wfStr.startsWith('[') || wfStr.startsWith('{')) {
                  let parsed = JSON.parse(wfStr);
                  let steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                  
                   if (steps[stepIndex] && steps[stepIndex].status === 'Pending') {
                       const stepObj = steps[stepIndex];
                       
                       if (typeof sendApprovalActionEmail_ === 'function') {
                           // A reminder is often sent precisely because the
                           // approver could not act. Re-assert sharing so the
                           // reminder does not repeat an inaccessible link.
                           if (primaryDocUrl) {
                               shareDocWithParticipants_(
                                   itemId,
                                   primaryDocUrl,
                                   stepObj.approvers || [],
                                   `reminder for step ${stepIndex + 1}`
                               );
                           }

                           sendApprovalActionEmail_(itemId, title, stepObj, stepObj.approvers, primaryDocUrl, JSON.stringify({steps: steps, log: []}), true);
                           addNote(itemId, `Admin sent a reminder for step ${stepIndex+1}.`, "System");
                       }
                   } else {
                      throw new Error("Step not pending or invalid step index.");
                  }
              }
              found = true;
              break;
          }
       }
       if(found) break;
    }
    
    if(!found) throw new Error("Item not found");
    return {success: true};
  } catch(e) {
    return {success: false, error: e.message};
  }
}


/**
 * Main state machine logic for advancing workflow.
 */
function advanceWorkflow_(itemId, actionType, notes, explicitUserEmail) {
    // 1. Fetch current item details
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet, rowData, rowIndex;
    
    // Quick search for the item
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       for(let i=1; i<data.length; i++) {
          if(String(data[i][0]) === String(itemId)) {
             sheet = sh;
             rowIndex = i + 1;
             
             // Map row data to object
             const headers = data[0];
             rowData = {};
             for(let c=0; c<headers.length; c++) {
                 rowData[headers[c]] = data[i][c];
             }
             break;
          }
       }
       if(sheet) break;
    }
    
    if(!sheet) throw new Error("Item not found");
    
    let nextExecStatus = rowData['ExecStatus'] || '';
    let nextStatus = rowData['Status'] || '';
    let nextAssigned = rowData['Assigned'] || '';
    let nextWorkflowStep = rowData['WorkflowStep'] || '';
    
    // Load Workflow Template
    const template = getWorkflowTemplate_(rowData['Type']);
    const steps = template ? template.steps : [];
    
    const extractEmail = (str) => {
        if (!str) return '';
        const match = str.match(/<([^>]+)>/);
        return match ? match[1].toLowerCase().trim() : str.toLowerCase().trim();
    };
    
    // Robust comparison for Name vs Email
    const isSameUser = (savedUser, currentUserEmail) => {
        if (!savedUser || !currentUserEmail) return false;
        let s = savedUser.toLowerCase();
        let c = currentUserEmail.toLowerCase();
        if (s === c) return true;
        // Check prefix match
        let prefix = c.split('@')[0];
        if (s.includes(prefix)) return true;
        if (s.includes(prefix.replace('.', ' '))) return true;
        if (s.includes(prefix.replace('.', ''))) return true;
        return false;
    };

    const rawUserEmail = (explicitUserEmail || Session.getActiveUser().getEmail() || '');
    const activeEmail = extractEmail(rawUserEmail);
    const sessionEmail = Session.getActiveUser().getEmail();

    if (actionType === 'Decline') {
        nextExecStatus = 'Closed';
        let declineSteps = [];
        if (rowData['WorkflowStep'] && (rowData['WorkflowStep'].startsWith('[') || rowData['WorkflowStep'].startsWith('{'))) {
            let parsed = JSON.parse(rowData['WorkflowStep']);
            declineSteps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
            let log = Array.isArray(parsed) ? [] : (parsed.log || []);
            let originalAssigned = Array.isArray(parsed) ? '' : (parsed.originalAssigned || '');
            let history = Array.isArray(parsed) ? [] : (parsed.history || []);
            
            let activeStepIdx = declineSteps.findIndex(s => s.status === 'Pending');
            if(activeStepIdx >= 0) {
                const currentStep = declineSteps[activeStepIdx];
                const validApprovers = (currentStep.approvers || []).map(extractEmail);
                if (!validApprovers.some(a => isSameUser(a, sessionEmail))) {
                    throw new Error("You are not authorized to decline this step.");
                }
                const approvedBy = (currentStep.approvedBy || []).map(extractEmail);
                if (approvedBy.some(a => isSameUser(a, sessionEmail))) {
                    throw new Error("You have already approved this step. You cannot decline it now.");
                }
                currentStep.status = 'Declined';
                currentStep.declinedAt = new Date().toISOString();
                if (!currentStep.approverComments) currentStep.approverComments = [];
                if (notes) currentStep.approverComments.push(`[${activeEmail.split('@')[0]}]: ${notes}`);
            } else {
                throw new Error("No active workflow step pending approval.");
            }
            nextWorkflowStep = JSON.stringify({steps: declineSteps, log: log, originalAssigned: originalAssigned, history: history});
        } else {
            nextWorkflowStep = 'Declined';
        }
        // Notify owners/assigned that routing was declined
        const declinedBy = explicitUserEmail || Session.getActiveUser().getEmail();
        const declineOwners = [];
        if(rowData['Owner']) rowData['Owner'].split(',').forEach(e => { if(e.trim()) declineOwners.push(e.trim()); });
        if(rowData['Assigned']) rowData['Assigned'].split(',').forEach(e => { if(e.trim()) declineOwners.push(e.trim()); });
        if (typeof sendDeclineNotification_ === 'function') {
            sendDeclineNotification_(itemId, rowData['Title'], declinedBy, notes, declineSteps, rowData['Primary_Doc_ID'], [...new Set(declineOwners)]);
        }
    } else if (actionType === 'Return') {
        nextExecStatus = 'Draft';
        
        let returnSteps = [];
        if (rowData['WorkflowStep'] && (rowData['WorkflowStep'].startsWith('[') || rowData['WorkflowStep'].startsWith('{'))) {
            let parsed = JSON.parse(rowData['WorkflowStep']);
            returnSteps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
            let log = Array.isArray(parsed) ? [] : (parsed.log || []);
            let originalAssigned = Array.isArray(parsed) ? '' : (parsed.originalAssigned || '');
            let history = Array.isArray(parsed) ? [] : (parsed.history || []);
            
            let activeStepIdx = returnSteps.findIndex(s => s.status === 'Pending');
            if(activeStepIdx >= 0) {
                const currentStep = returnSteps[activeStepIdx];
                const validApprovers = (currentStep.approvers || []).map(extractEmail);
                if (!validApprovers.some(a => isSameUser(a, sessionEmail))) {
                    throw new Error("You are not authorized to return this step.");
                }
                const approvedBy = (currentStep.approvedBy || []).map(extractEmail);
                if (approvedBy.some(a => isSameUser(a, sessionEmail))) {
                    throw new Error("You have already approved this step. You cannot return it now.");
                }
                currentStep.status = 'Returned';
                currentStep.returnedAt = new Date().toISOString();
                if (!currentStep.approverComments) currentStep.approverComments = [];
                if (notes) currentStep.approverComments.push(`[${activeEmail.split('@')[0]}]: ${notes}`);
            } else {
                throw new Error("No active workflow step pending approval.");
            }
            nextWorkflowStep = JSON.stringify({steps: returnSteps, log: log, originalAssigned: originalAssigned, history: history});
        } else {
            nextWorkflowStep = 'Returned';
        }
        // Notify owners/assigned that routing was returned
        const returnedBy = explicitUserEmail || Session.getActiveUser().getEmail();
        const returnOwners = [];
        if(rowData['Owner']) rowData['Owner'].split(',').forEach(e => { if(e.trim()) returnOwners.push(e.trim()); });
        if(rowData['Assigned']) rowData['Assigned'].split(',').forEach(e => { if(e.trim()) returnOwners.push(e.trim()); });
        if (typeof sendReturnNotification_ === 'function') {
            sendReturnNotification_(itemId, rowData['Title'], returnedBy, notes, returnSteps, rowData['Primary_Doc_ID'], [...new Set(returnOwners)]);
        }
    } else if (actionType === 'Approve') {
        const wfStr = rowData['WorkflowStep'];
        
        if (wfStr && (wfStr.startsWith('[') || wfStr.startsWith('{'))) {
            let parsed = {steps: [], log: []};
            try { 
                let jsonParsed = JSON.parse(wfStr);
                parsed.steps = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.steps || []);
                parsed.log = Array.isArray(jsonParsed) ? [] : (jsonParsed.log || []);
            } catch(e) {}
            
            let steps = parsed.steps;
            let log = parsed.log;
            
            let activeStepIdx = steps.findIndex(s => s.status === 'Pending');
            
            if (activeStepIdx >= 0) {
                let currentStep = steps[activeStepIdx];
                const validApprovers = (currentStep.approvers || []).map(extractEmail);
                if (!validApprovers.some(a => isSameUser(a, sessionEmail))) {
                    throw new Error("You are not authorized to approve this step.");
                }
                if (!currentStep.approvedBy) currentStep.approvedBy = [];
                if (currentStep.approvedBy.some(a => isSameUser(extractEmail(a), sessionEmail))) {
                    throw new Error("You have already approved this step.");
                }
                
                currentStep.approvedBy.push(activeEmail);
                if (!currentStep.approverComments) currentStep.approverComments = [];
                if (notes) currentStep.approverComments.push(`[${activeEmail.split('@')[0]}]: ${notes}`);
                
                // Legacy signature stamping has been removed as per user request.
                // Append notes to the log (this used to be at the end, now we do it here)
                const ts = formatEasternTimestamp_();
                const author = activeEmail.split('@')[0] || "Unknown User";
                let actionLogStr = `[${ts}] ${author} (Email: ${activeEmail}) marked as ${actionType}`;
                if (notes) actionLogStr += ` with comment: ${notes}`;
                log.unshift(actionLogStr);
                
                // Also add to the system Audit Log (Activity_Log)
                if (typeof logActivity_ === 'function') {
                    logActivity_(activeEmail, itemId, rowData['Title'] || itemId, `Approval ${actionType}`, (notes ? `Comment: ${notes}` : 'No comment provided'));
                }
                
                saveAndAdvanceWorkflowState_(itemId, sheet, rowData, rowIndex, steps, log, explicitUserEmail);
                return { success: true };
            }
        }
    }
    
    // Append notes to the Workflow log
    if (nextWorkflowStep && (nextWorkflowStep.startsWith('[') || nextWorkflowStep.startsWith('{'))) {
        let parsed = JSON.parse(nextWorkflowStep);
        let log = Array.isArray(parsed) ? [] : (parsed.log || []);
        let steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
        let originalAssigned = parsed.originalAssigned || '';
        let history = parsed.history || [];
        
        const ts = formatEasternTimestamp_();
        const author = activeEmail.split('@')[0] || "Unknown User";
        let actionLogStr = `[${ts}] ${author} (Email: ${activeEmail}) marked as ${actionType}`;
        if (notes) actionLogStr += ` with comment: ${notes}`;
        
        // Ensure log array exists, unshift puts latest action at the front or we can push to end. We'll unshift so it's top-down in UI
        log.unshift(actionLogStr);
        
        // Also add to the system Audit Log (Activity_Log)
        if (typeof logActivity_ === 'function') {
            logActivity_(activeEmail, itemId, rowData['Title'] || itemId, `Approval ${actionType}`, (notes ? `Comment: ${notes}` : 'No comment provided'));
        }
        
        nextWorkflowStep = JSON.stringify({steps: steps, log: log, originalAssigned: originalAssigned, history: history});
    }
    
    // Write back to sheet (We need column indices)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const updates = {
       'ExecStatus': nextExecStatus,
       'WorkflowStep': nextWorkflowStep
    };
    
    Object.keys(updates).forEach(key => {
        const colIdx = headers.indexOf(key);
        if (colIdx >= 0) {
            sheet.getRange(rowIndex, colIdx + 1).setValue(updates[key]);
        }
    });

    // Note: Targeted notification emails (Decline, Return, Completion) are sent
    // within the action branches above. No generic notification needed here.
    // Document Stamping for Declined, Returned, or Closed (Approved is handled above before copy)
    const primaryDocUrl = rowData['Primary_Doc_ID'];
    const isFailedEndState = ['Declined', 'Returned', 'Closed'].includes(nextExecStatus);
    
    if (primaryDocUrl && isFailedEndState) {
        const match = String(primaryDocUrl).match(/[-\w]{25,}/);
        if (match) {
            if (typeof stampRoutingTimeline_ === 'function' &&
                nextWorkflowStep && (nextWorkflowStep.startsWith('[') || nextWorkflowStep.startsWith('{'))) {
                try {
                    let parsed = JSON.parse(nextWorkflowStep);
                    let finalSteps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                    stampRoutingTimeline_(match[0], finalSteps, itemId, rowData['Title'] || itemId);
                } catch(e) {
                    console.error("stampRoutingTimeline_ failed: " + e.message + "\n" + e.stack);
                }
            }
        }
    }
    
    // Flush to ensure UI fetches fresh data
    SpreadsheetApp.flush();
    
    return { success: true };
}

function getAllWorkflowTemplates() {
  const templates = [];

  // 1. Fetch Local (Spoke) Templates
  try {
    const localSS = SpreadsheetApp.getActiveSpreadsheet();
    const localSheet = localSS.getSheetByName('Workflow_Templates');
    if (localSheet && localSheet.getLastRow() > 1) {
      const data = localSheet.getRange(2, 1, localSheet.getLastRow() - 1, 5).getValues();
      data.forEach(row => {
        if (row[0]) {
          try {
            const parsed = JSON.parse(row[3]); // Steps_JSON
            templates.push({
              id: String(row[0]),
              name: String(row[1]),
              appliesTo: String(row[2]).split(',').map(s => s.trim()),
              steps: parsed,
              scope: row[4] ? String(row[4]) : 'Local'
            });
          } catch(e) { console.warn("Failed to parse Local JSON for " + row[0]); }
        }
      });
    }
  } catch (e) {
    console.warn("Failed fetching local templates: " + e.message);
  }

  // 2. Fetch Global (Master) Templates
  try {
    const masterId = PropertiesService.getScriptProperties().getProperty('MASTER_SS_ID');
    if (masterId) {
      const masterSS = SpreadsheetApp.openById(masterId);
      const masterSheet = masterSS.getSheetByName('Workflow_Templates');
      if (masterSheet && masterSheet.getLastRow() > 1) {
        const data = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 5).getValues();
        data.forEach(row => {
          if (row[0] && row[4] === 'Global') {
            try {
              const parsed = JSON.parse(row[3]);
              // Don't overwrite local overrides if ID matches
              if (!templates.find(t => t.id === row[0])) {
                templates.push({
                  id: String(row[0]),
                  name: String(row[1]),
                  appliesTo: String(row[2]).split(',').map(s => s.trim()),
                  steps: parsed,
                  scope: 'Global'
                });
              }
            } catch(e) { console.warn("Failed to parse Global JSON for " + row[0]); }
          }
        });
      }
    }
  } catch (e) {
    console.warn("Failed fetching global templates: " + e.message);
  }

  return templates;
}

function getWorkflowTemplate_(itemType) {
  const allTemplates = getAllWorkflowTemplates();
  // Find first template that applies to this type
  const match = allTemplates.find(t => t.appliesTo.includes(itemType) || t.appliesTo.includes('All'));
  return match || null;
}

/**
 * Saves a workflow template to the appropriate sheet.
 */
function saveWorkflowTemplate(templateObj, isGlobal) {
  try {
    let targetSS;
    if (isGlobal) {
      const masterId = PropertiesService.getScriptProperties().getProperty('MASTER_SS_ID');
      if (!masterId) throw new Error("No Master Hub configured for Global templates.");
      targetSS = SpreadsheetApp.openById(masterId);
    } else {
      targetSS = SpreadsheetApp.getActiveSpreadsheet();
    }

    let sheet = targetSS.getSheetByName('Workflow_Templates');
    if (!sheet) {
      sheet = targetSS.insertSheet('Workflow_Templates');
      sheet.appendRow(['Template_ID', 'Name', 'Applies_To', 'Steps_JSON', 'Scope']);
    }

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === templateObj.id) {
        rowIndex = i + 1;
        break;
      }
    }

    const appliesToStr = Array.isArray(templateObj.appliesTo) ? templateObj.appliesTo.join(', ') : templateObj.appliesTo;
    const stepsJson = typeof templateObj.steps === 'string' ? templateObj.steps : JSON.stringify(templateObj.steps);
    const scope = isGlobal ? 'Global' : 'Local';

    const rowData = [templateObj.id, templateObj.name, appliesToStr, stepsJson, scope];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
    } else {
      sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    return { success: true };
  } catch (e) {
    console.error("Save template error: " + e.message);
    return { success: false, error: e.message };
  }
}

function logWorkflowAction_(itemId, stepNumber, stepName, action, comments, fileId, approvalId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Approval_Tracking');
    if (!sheet) return;
    const actorEmail = Session.getActiveUser().getEmail();
    const timestamp = new Date();
    sheet.appendRow([itemId, stepNumber, stepName, action, actorEmail, timestamp, comments || '', fileId || '', approvalId || '']);
  } catch (e) {
    console.error("Failed to log workflow action: " + e.message);
  }
}

function requestDocApproval(itemId, fileId, approvers, notes) {
  try {
    const approval = {
      reviewerEmails: approvers.map(e => e.trim()),
      message: `Please review and approve ${itemId}. Notes: ${notes}`
    };
    
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/approvals:start`;
    const options = {
       method: "post",
       contentType: "application/json",
       headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
       payload: JSON.stringify(approval),
       muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code >= 400) {
       throw new Error(`REST Error ${code}: ` + response.getContentText());
    }
    
    const respObj = JSON.parse(response.getContentText());
    return respObj.id; // Return the Approval ID
  } catch (e) {
    throw new Error("Drive API failed: " + e.message);
  }
}

/**
 * Polling function meant to be run via Time-driven trigger (e.g. every 15 minutes).
 * Queries Drive Approvals API for native approval status and syncs back to FACT.
 */

function approveWorkflowStep(itemId, stepIndex, notes) {
    try {
        return advanceWorkflow_(itemId, 'Approve', notes);
    } catch(err) {
        return { success: false, error: err.toString() };
    }
}

function rejectWorkflowStep(itemId, stepIndex, notes) {
    try {
        return advanceWorkflow_(itemId, 'Return', notes);
    } catch(err) {
        return { success: false, error: err.toString() };
    }
}


/**
 * Background trigger to execute the first workflow step email after a comment period delay.
 */
function processAsyncWorkflowStep1_(e) {
  if (e && e.triggerUid) {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
      if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t);
    });
  }

  const props = PropertiesService.getScriptProperties();
  const allKeys = props.getKeys();
  
  for (let key of allKeys) {
    if (key.startsWith('wfStep1Job_')) {
      const jobRaw = props.getProperty(key);
      if (!jobRaw) continue;
      
      try {
        const job = JSON.parse(jobRaw);
        
        // Update ExecStatus from 'Comment Period' to 'Routing' in spreadsheet
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
        let foundSheet = null;
        let foundRowIdx = -1;
        let headers = [];
        
        for (const sName of sheets) {
           const sh = ss.getSheetByName(sName);
           if (!sh) continue;
           const data = sh.getDataRange().getValues();
           headers = data[0];
           let found = false;
           for (let i = 1; i < data.length; i++) {
              if (String(data[i][0]) === String(job.itemId)) {
                 foundSheet = sh;
                 foundRowIdx = i + 1;
                 found = true;
                 break;
              }
           }
           if (found) break;
        }
        
        if (foundSheet && foundRowIdx >= 0) {
           // Update ExecStatus to Routing
           const execColIdx = headers.indexOf('ExecStatus');
           if (execColIdx >= 0) {
              foundSheet.getRange(foundRowIdx, execColIdx + 1).setValue('Routing');
           }
           
           // FIX 10: Read the LIVE WorkflowStep from the sheet and update the first
           // blocking step to 'Pending' before sending the email. This ensures the
           // email action URL will pass validation in doGet?page=action.
           const wfColIdx = headers.indexOf('WorkflowStep');
           let liveWorkflowStr = job.workflowStr;
           if (wfColIdx >= 0) {
               const liveWfRaw = foundSheet.getRange(foundRowIdx, wfColIdx + 1).getValue();
               if (liveWfRaw && (liveWfRaw.startsWith('[') || liveWfRaw.startsWith('{'))) {
                   try {
                       const liveParsed = JSON.parse(liveWfRaw);
                       const liveSteps = Array.isArray(liveParsed) ? liveParsed : (liveParsed.steps || []);
                       const liveLog = Array.isArray(liveParsed) ? [] : (liveParsed.log || []);
                       
                       // Find the first non-completed blocking step and mark it Pending
                       const firstBlockingIdx = liveSteps.findIndex(s => 
                           s.status === 'Configured' || s.status === 'Pending');
                       if (firstBlockingIdx >= 0) {
                           liveSteps[firstBlockingIdx].status = 'Pending';
                           liveSteps[firstBlockingIdx].sentAt = new Date().toISOString();
                           liveWorkflowStr = JSON.stringify({steps: liveSteps, log: liveLog});
                           foundSheet.getRange(foundRowIdx, wfColIdx + 1).setValue(liveWorkflowStr);
                           SpreadsheetApp.flush();
                           // Update job.step to use the live version's approvers
                           job.step = liveSteps[firstBlockingIdx];
                           job.approvers = liveSteps[firstBlockingIdx].approvers;
                       }
                   } catch(e) {
                       console.error('processAsyncWorkflowStep1_ live step update failed: ' + e.message);
                   }
               }
           }
        }
        
        if (typeof sendApprovalActionEmail_ === 'function') {
           // Delayed start: the comment-period timer has fired and we are about
           // to notify the first blocking approver. job.step/job.approvers were
           // just re-read from the live sheet above, so share against those
           // rather than the snapshot taken when the trigger was created.
           if (job.primaryDoc) {
               shareDocWithParticipants_(
                   job.itemId,
                   job.primaryDoc,
                   job.approvers || [],
                   'delayed workflow start'
               );
           }

           sendApprovalActionEmail_(job.itemId, job.itemTitle, job.step, job.approvers, job.primaryDoc, liveWorkflowStr || job.workflowStr || JSON.stringify({steps: [job.step], log: []}));
        }
      } catch (err) {
        console.error("Error in processAsyncWorkflowStep1_: " + err.message);
      } finally {
        props.deleteProperty(key);
      }
    }
  }
}

/**
 * Public endpoint to reset a workflow to Draft state and clear Google Doc routing table.
 */
function resetApprovalWorkflowBackend(itemId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    let found = false;
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       const headers = data[0];
       const idCol = headers.indexOf('ID');
       const wfCol = headers.indexOf('WorkflowStep');
       const execCol = headers.indexOf('ExecStatus');
       const statusCol = headers.indexOf('Status');
       const assignCol = headers.indexOf('Assigned');
       const ownerCol = headers.indexOf('Owner');
       const docCol = headers.indexOf('Primary_Doc_ID');
       
       if(idCol < 0) continue;
       
       for(let i=1; i<data.length; i++) {
           if(String(data[i][idCol]) === String(itemId)) {
               // Reset status fields
               if (wfCol >= 0) {
                   const currentWfVal = data[i][wfCol] || '';
                   let newWfVal = '';
                    if (currentWfVal.startsWith('[') || currentWfVal.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(currentWfVal);
                            const steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                            const originalAssigned = parsed.originalAssigned || '';
                            const history = parsed.history || [];
                            steps.forEach(s => {
                                s.status = 'Configured';
                                s.approvedBy = [];
                                s.sentAt = '';
                                s.approvedAt = '';
                                s.approverTimes = {};
                            });
                            newWfVal = JSON.stringify({ steps: steps, log: [], originalAssigned: originalAssigned, history: history });
                        } catch(e) {}
                    }
                    sh.getRange(i+1, wfCol+1).setValue(newWfVal);
                }
                if (execCol >= 0) sh.getRange(i+1, execCol+1).setValue('Draft');
               
               // Clear routing timeline from document
               const primaryDoc = (docCol >= 0) ? data[i][docCol] : '';
               if (primaryDoc && typeof stampRoutingTimeline_ === 'function') {
                   const match = String(primaryDoc).match(/[-\w]{25,}/);
                   if (match) stampRoutingTimeline_(match[0], []);
               }
               
               addNote(itemId, "Approval workflow was reset to Draft.", "System");
               found = true;
               break;
           }
       }
       if(found) break;
    }
    
    if(!found) throw new Error("Item not found");
    SpreadsheetApp.flush();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * Archives the current active routing to the history array inside WorkflowStep,
 * resets the active routing steps/logs, and returns the execution status to Draft.
 * @param {string} itemId
 * @returns {{success: boolean, error?: string}}
 */
function archiveAndResetWorkflowBackend(itemId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ['Tasks', 'Projects', 'Sub_Tasks'];
    let found = false;
    
    for(const sName of sheets) {
       const sh = ss.getSheetByName(sName);
       if(!sh) continue;
       const data = sh.getDataRange().getValues();
       const headers = data[0];
       const idCol = headers.indexOf('ID');
       const wfCol = headers.indexOf('WorkflowStep');
       const execCol = headers.indexOf('ExecStatus');
       
       if(idCol < 0) continue;
       
       for(let i=1; i<data.length; i++) {
           if(String(data[i][idCol]) === String(itemId)) {
               let currentWfVal = data[i][wfCol] || '';
               let newWfVal = '';
               let origAssigned = '';
               
               if (currentWfVal.startsWith('[') || currentWfVal.startsWith('{')) {
                   try {
                       const parsed = JSON.parse(currentWfVal);
                       const steps = Array.isArray(parsed) ? parsed : (parsed.steps || []);
                       const log = Array.isArray(parsed) ? [] : (parsed.log || []);
                       origAssigned = parsed.originalAssigned || '';
                       const history = parsed.history || [];
                       
                       // Only archive if there is an active workflow that was touched
                       if (steps.length > 0) {
                           history.push({
                               completedAt: new Date().toISOString(),
                               status: data[i][execCol] || 'Unknown',
                               steps: steps,
                               log: log
                           });
                       }
                       
                       newWfVal = JSON.stringify({
                           steps: [],
                           log: [],
                           originalAssigned: origAssigned,
                           history: history
                       });
                   } catch(e) {
                       newWfVal = JSON.stringify({ steps: [], log: [], originalAssigned: '', history: [] });
                   }
               } else {
                   newWfVal = JSON.stringify({ steps: [], log: [], originalAssigned: '', history: [] });
               }
               
               sh.getRange(i+1, wfCol+1).setValue(newWfVal);
               if (execCol >= 0) sh.getRange(i+1, execCol+1).setValue('Draft');
               
               addNote(itemId, "Prior approval workflow was archived and reset for a new routing.", "System");
               found = true;
               break;
           }
       }
       if(found) break;
    }
    
    if(!found) throw new Error("Item not found");
    SpreadsheetApp.flush();
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}
