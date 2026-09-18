// ==========================================
// FACT DRIVE SERVICE
// ==========================================

/**
 * Creates or updates a Task, Project, or Sub-Task.
 * Orchestrates drive automation, notifications, and logging.
 * @param {object} form The form data object from the frontend.
 * @param {string[]} changeLog Array of change description strings.
 * @returns {{success: boolean, id: string}}
 */
function saveItem(form, changeLog) {
  // ARCH-03: Note - This function currently performs multiple independent operations 
  // without transaction rollback. If a later step fails (e.g. folder creation), 
  // earlier steps (e.g. row update) are not reverted. Full transactional refactor is future work.
  const isNew = (!form.ID || String(form.ID).trim() === '' || form.ID === 'New Item');

  // 1. Find existing row (if editing); also detects cross-sheet type changes
  const { sheetName, row, oldOwner, oldDriveLink, folderId: existingFolderId, sourceSheetName, sourceRow } =
    findExistingRow_(form, isNew);

  // Detect if this is a cross-sheet type migration (e.g. Project → Task)
  const isTypeMigration = !isNew && sourceSheetName && sourceRow > 0;

  // 2. Generate ID
  // For type migrations, generate a brand-new ID with the correct prefix for the new type.
  // The old ID is retired; all references (notes, audit log) carry the old ID but the record
  // itself gets a new canonical ID in the destination sheet.
  let finalId;
  if (isNew) {
    finalId = generateItemId_(form.Type);
  } else if (isTypeMigration) {
    finalId = generateItemId_(form.Type);
    // Log the migration so there's a paper trail linking old ID to new ID
    console.log(`Type migration: ${form.ID} (${sourceSheetName}) → ${finalId} (${sheetName})`);
    changeLog = changeLog || [];
    changeLog.push(`Type changed from ${sourceSheetName.replace('s','').replace('_Tasks','Sub-Task')} to ${form.Type}. Old ID: ${form.ID} → New ID: ${finalId}`);
  } else {
    finalId = String(form.ID).trim();
  }

  // 3. Drive folder provisioning (new items only, or migrations that need a folder)
  const { driveLink, folderId } = provisionDriveFolder_(
    form, finalId, isNew || isTypeMigration, isTypeMigration ? '' : existingFolderId
  );

  // 4. Intake artifact processing (new items promoted from intake)
  const { driveLink: driveLink2, folderId: folderId2 } = processIntakeArtifacts_(
    form, finalId, isNew, driveLink, folderId
  );

  // 5. Shortcut creation (existing items with new links added)
  if (!isNew && !isTypeMigration && folderId2) {
    createLinkShortcuts_(folderId2, oldDriveLink, driveLink2);
  }

  // 5.1 Clone files from originator source Drive folder/files (if specified)
  let copiedFilesCount = 0;
  let finalFolderId = folderId2;
  let finalDriveLink = driveLink2;

  if (form.SourceDriveLink && finalFolderId) {
    try {
      const cloneResult = cloneSourceFilesToFolder_(form.SourceDriveLink, finalFolderId, finalId);
      if (cloneResult && cloneResult.success && cloneResult.count > 0) {
        copiedFilesCount = cloneResult.count;
        const newFileLinks = cloneResult.files.map(f => f.url).filter(Boolean);
        if (newFileLinks.length > 0) {
          finalDriveLink = `${finalDriveLink}\n${newFileLinks.join('\n')}`.trim();
        }
        changeLog = changeLog || [];
        changeLog.push(`Cloned ${cloneResult.count} file(s) from originator source folder into system folder.`);
        try {
          addNote(finalId, `📁 Cloned ${cloneResult.count} file(s) from originator source into system folder:\n${cloneResult.files.map(f => '• ' + f.name).join('\n')}`, 'System.Drive', form.Title);
        } catch(noteErr) {
          console.warn("Could not log clone note: " + noteErr.message);
        }
      } else if (cloneResult && !cloneResult.success && cloneResult.error) {
        changeLog = changeLog || [];
        changeLog.push(`Warning: Source file cloning failed: ${cloneResult.error}`);
        try {
          addNote(finalId, `⚠️ Warning: Could not clone files from originator source: ${cloneResult.error}`, 'System.Drive', form.Title);
        } catch(noteErr) {}
      }
    } catch(cloneErr) {
      console.error(`SourceDriveLink processing failed for ${finalId}: ${cloneErr.message}`);
    }
  }

  // 5.4 For type migrations: rename & move the existing Drive folder to the new type's base folder
  if (isTypeMigration && existingFolderId) {
    try {
      const migrationResult = migrateItemFolder_(existingFolderId, form.ID, finalId, form.Title, form.Type, oldDriveLink);
      if (migrationResult.folderId) finalFolderId = migrationResult.folderId;
      if (migrationResult.driveLink) finalDriveLink = migrationResult.driveLink;
    } catch(e) {
      console.error(`Folder migration failed: ${e.message}`);
      // Non-fatal: keep old folder reference
      finalFolderId = existingFolderId;
      finalDriveLink = oldDriveLink;
    }
  }

  // 5.5 Grant Folder Access to Owner and Assigned Team
  if (finalFolderId) {
    grantFolderAccessFast_(finalFolderId, [form.Owner || '', ...(form.Assigned || '').split(',')]);
  }

  // 5.8 Primary Doc handling
  if (finalFolderId && form.Primary_Doc_ID) {
    handlePrimaryDoc_(finalFolderId, form.Primary_Doc_ID);
  }

  // 5.9 For type migrations: delete the old row from the source sheet BEFORE writing the new one
  if (isTypeMigration) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSh = ss.getSheetByName(sourceSheetName);
    if (sourceSh) {
      sourceSh.deleteRow(sourceRow);
    }
  }

  // 6. Write to sheet (for migrations, row=-1 so it appends as new row)
  writeItemToSheet_(form, finalId, sheetName, row, isNew || isTypeMigration, finalDriveLink, finalFolderId);

  // 7. Assignment notification (only for true owner changes on non-migration edits)
  if (!isNew && !isTypeMigration && oldOwner.trim() !== (form.Owner || '').trim() && form.Owner) {
    sendAssignmentNotification_(finalId, form.Title, form.Owner);
  }

  // 8. Finalize: notes, logging, intake cleanup
  finalizeItem_(form, finalId, isNew || isTypeMigration, sheetName, changeLog);

  // 9. Stakeholder auto-registration
  try {
    ensureStakeholdersRegistered_([
      form.Owner || '',
      form.Assigned || '',
      form.Requestor || ''
    ]);
  } catch (e) {
    console.error(`Stakeholder registration failed during saveItem: ${e.message}`);
  }

  // 10. Federation Sync (Opt-in)
  if (form.promoteToMaster) {
    try {
      syncToMaster_(finalId, form, SpreadsheetApp.getActiveSpreadsheet().getId());
    } catch (e) {
      console.error(`Federation sync failed: ${e.message}`);
    }
  }

  return { 
    success: true, 
    id: finalId, 
    folderId: finalFolderId, 
    driveLink: finalDriveLink, 
    copiedFilesCount: copiedFilesCount 
  };
}

/**
 * Maps a record type to its canonical sheet name.
 * @param {string} type The record Type value.
 * @returns {string}
 * @private
 */
function typeToSheetName_(type) {
  if (type === 'Project') return 'Projects';
  if (type === 'Sub-Task') return 'Sub_Tasks';
  return 'Tasks';
}

/**
 * Searches for an existing item across Tasks and Projects sheets.
 * Detects cross-sheet type changes (e.g. Project → Task) and returns
 * migration metadata so saveItem can delete the old row.
 * @param {object} form The form data.
 * @param {boolean} isNew Whether this is a new item.
 * @returns {{sheetName: string, row: number, oldOwner: string, oldDriveLink: string, folderId: string, sourceSheetName: string, sourceRow: number}}
 * @private
 */
function findExistingRow_(form, isNew) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = String(form.ID || '').trim();
  let sheetName = '';
  let row = -1;
  let oldOwner = '';
  let oldDriveLink = '';
  let folderId = form.FolderID || '';

  // For cross-sheet migration tracking
  let sourceSheetName = '';
  let sourceRow = -1;

  if (!isNew) {
    const searchOrder = ['Tasks', 'Projects', 'Sub_Tasks'];
    for (const name of searchOrder) {
      const sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) continue;

      // PERF-04: Fixed: Only fetching ID column to reduce payload and memory usage
      const allIds = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      const rowIndex = allIds.findIndex(row => String(row[0]).trim() === id);
      if (rowIndex !== -1) {
          const foundRow = rowIndex + 2;
          const oldData = sh.getRange(foundRow, 1, 1, 14).getValues()[0];
          const ownerColIndex = (name === 'Projects') ? 3 : 4;
          oldOwner = oldData[ownerColIndex] || '';
          oldDriveLink = oldData[12] || '';
          folderId = oldData[13] || form.FolderID || '';

          // Determine the sheet the record SHOULD live in based on the new type
          const targetSheet = typeToSheetName_(form.Type);

          if (targetSheet !== name) {
            // TYPE CHANGE DETECTED: record needs to move sheets
            sourceSheetName = name;   // Where the record currently lives (will be deleted)
            sourceRow = foundRow;
            sheetName = targetSheet;  // Where the record will be written (as a new row)
            row = -1;                 // Force append (isNew path) in writeItemToSheet_
          } else {
            // Normal edit: same sheet
            sheetName = name;
            row = foundRow;
          }
          break;
      }
    }
  }

  // Determine target sheet for brand-new items
  if (!sheetName) {
    sheetName = typeToSheetName_(form.Type);
  }

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Target sheet '${sheetName}' not found.`);

  return { sheetName, row, oldOwner, oldDriveLink, folderId, sourceSheetName, sourceRow };
}

/**
 * Generates a new unique item ID using a global counter in Script Properties.
 * @param {string} type The item type (e.g. 'Project', 'Task', 'Data Call').
 * @returns {string} The new ID (e.g. 'TASK-1042').
 * @private
 */
function generateItemId_(type) {
  const config = loadConfig_();
  let prefix = '';

  // 1. Try to fetch the configured prefix for this specific type
  if (type && config.driveConfig && config.driveConfig[type] && config.driveConfig[type].prefix) {
    prefix = config.driveConfig[type].prefix;
  }
  
  // 2. Fallback if no prefix is explicitly defined
  if (!prefix) {
    prefix = (type || 'TASK').substring(0, 4).toUpperCase().replace(/ /g, '');
    if (!['PROJ', 'TASK', 'SUB-'].includes(prefix)) prefix = 'TASK';
  }

  const prop = PropertiesService.getScriptProperties();
  let count = parseInt(prop.getProperty('GLOBAL_ID') || '1000') + 1;
  prop.setProperty('GLOBAL_ID', count.toString());

  return `${prefix}-${count}`;
}
/**
 * Creates a Drive folder for a new item and copies any template files.
 * @param {object} form The form data.
 * @param {string} finalId The item's ID.
 * @param {boolean} isNew Whether this is a new item.
 * @param {string} existingFolderId Folder ID if already known.
 * @returns {{driveLink: string, folderId: string}}
 * @private
 */
function provisionDriveFolder_(form, finalId, isNew, existingFolderId) {
  let driveLink = form.DriveLink || '';
  let folderId = existingFolderId || '';

  if (!isNew || form.Type === 'Sub-Task') {
    return { driveLink, folderId };
  }

  try {
    const driveConfigMap = getDriveConfigMap_();
    const config = driveConfigMap.get((form.Type || '').trim().toLowerCase());
    if (!config || !config.baseFolderId) {
        const keys = Array.from(driveConfigMap.keys()).join(', ');
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sh = ss.getSheetByName('Drive_Config');
        const rows = sh ? sh.getLastRow() : 'NoSheet';
        driveLink = `ERROR PROVISIONING FOLDER: No config found for type ${(form.Type || '').trim().toLowerCase()}. Available keys: [${keys}]. SheetRows: ${rows}. configObj: ${JSON.stringify(config)}\n${driveLink}`.trim();
        return { driveLink, folderId };
    }
    
    // Auto-extract ID if user pasted a full URL
    let cleanBaseId = config.baseFolderId;
    const baseMatch = cleanBaseId.match(/[-\w]{25,}/);
    if (baseMatch) cleanBaseId = baseMatch[0];

    const parentFolder = DriveApp.getFolderById(cleanBaseId);
    const fiscalYear = getCurrentFiscalYear_();
    const fyFolder = getOrCreateSubfolder_(parentFolder, fiscalYear);
    const newRecordFolder = fyFolder.createFolder(`${finalId}: ${form.Title}`);

    driveLink = `${newRecordFolder.getUrl()}\n${driveLink}`.trim();
    folderId = newRecordFolder.getId();
    
    // Transfer ownership of the newly created folder to the assigned Owner
    let newOwnerEmail = null;
    const extractEmail = (str) => {
        const match = (str || '').match(/<([^>]+)>/);
        return match ? match[1].toLowerCase().trim() : (str || '').toLowerCase().trim();
    };
    if (form.Owner) {
        newOwnerEmail = extractEmail(form.Owner.split(',')[0]);
    } else if (form.Requestor) {
        newOwnerEmail = extractEmail(form.Requestor.split(',')[0]);
    }
    
    if (newOwnerEmail && newOwnerEmail.endsWith('@gsa.gov')) {
        try {
            newRecordFolder.setOwner(newOwnerEmail);
        } catch(e) {
            console.error("Could not transfer folder ownership to " + newOwnerEmail + ": " + e.message);
        }
    }

    if (config.templateFolderId) {
      let cleanTemplateId = config.templateFolderId;
      const tMatch = cleanTemplateId.match(/[-\w]{25,}/);
      if (tMatch) cleanTemplateId = tMatch[0];
      
      // Async offload to prevent UI blocking
      const ts = new Date().getTime();
      const propKey = 'copyJob_' + ts;
      PropertiesService.getScriptProperties().setProperty(propKey, JSON.stringify({
         sourceId: cleanTemplateId,
         targetId: newRecordFolder.getId(),
         ownerEmail: newOwnerEmail
      }));
      ScriptApp.newTrigger('processAsyncTemplateCopy_').timeBased().after(1).create();
    }
  } catch (e) {
    console.error(`Drive folder provisioning error for ${finalId}: ${e.message}`);
    driveLink = `ERROR PROVISIONING FOLDER: ${e.message}\n${driveLink}`.trim();
  }

  return { driveLink, folderId };
}

/**
 * Processes email attachments and links for items promoted from the intake queue.
 * @param {object} form The form data.
 * @param {string} finalId The item's ID.
 * @param {boolean} isNew Whether this is a new item.
 * @param {string} driveLink Current drive link string.
 * @param {string} folderId Current folder ID.
 * @returns {{driveLink: string, folderId: string}}
 * @private
 */
function processIntakeArtifacts_(form, finalId, isNew, driveLink, folderId) {
  if (!form.IntakeRowIndex || !isNew || !form.ThreadID) {
    return { driveLink, folderId };
  }

  try {
    let targetFolderId = folderId;

    if (!targetFolderId) {
      const config = loadConfig_();
      if (config.destinationFolderId) {
        const fallbackFolder = DriveApp.getFolderById(config.destinationFolderId);
        const tempFolder = fallbackFolder.createFolder(`[INTAKE] ${finalId} - ${form.Title}`);
        targetFolderId = tempFolder.getId();
        driveLink = `${tempFolder.getUrl()}\n${driveLink}`.trim();
        folderId = targetFolderId;
      }
    }

    if (targetFolderId) {
      const thread = GmailApp.getThreadById(form.ThreadID);
      if (thread) {
        const firstMessage = thread.getMessages()[0];
        const newLinks = processAndSaveArtifacts_(targetFolderId, firstMessage);
        if (newLinks.length > 0) {
          driveLink = `${driveLink}\n${newLinks.join('\n')}`.trim();
        }
      }
    }
  } catch (e) {
    console.error(`Intake artifact processing error for ${finalId}: ${e.message}`);
  }

  return { driveLink, folderId };
}

/**
 * Creates Drive shortcuts for any newly added links on an existing item.
 * @param {string} folderId The item's Drive folder ID.
 * @param {string} oldDriveLink The previous drive link string.
 * @param {string} newDriveLink The updated drive link string.
 * @private
 */
function createLinkShortcuts_(folderId, oldDriveLink, newDriveLink) {
  if (!folderId || newDriveLink === oldDriveLink) return;

  try {
    const recordFolder = DriveApp.getFolderById(folderId);
    const oldLinks = new Set((oldDriveLink || '').split('\n').filter(l => l.trim()));
    const addedLinks = (newDriveLink || '')
      .split('\n')
      .filter(l => l.trim() && !oldLinks.has(l.trim()));

    addedLinks.forEach(link => {
      const urlMatch = link.match(/https?:\/\/\S+/);
      if (!urlMatch) return;
      const url = urlMatch[0];
      let title = link.replace(url, '').trim();
      if (!title) {
        const titleMatch = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/);
        title = (titleMatch && titleMatch[1]) ? titleMatch[1] : 'External Link';
      }

      try {
        const driveFileIdMatch = url.match(/\/d\/([\w-]+)/);
        const driveFolderIdMatch = url.match(/\/drive\/folders\/([\w-]+)/);

        if (driveFileIdMatch?.[1]) {
          DriveApp.getFileById(driveFileIdMatch[1]);
          recordFolder.createShortcut(driveFileIdMatch[1]);
        } else if (driveFolderIdMatch?.[1]) {
          DriveApp.getFolderById(driveFolderIdMatch[1]);
          recordFolder.createShortcut(driveFolderIdMatch[1]);
        } else {
          const doc = DocumentApp.create(`[WEB LINK] ${title}`);
          doc.getBody().appendParagraph(url).setLinkUrl(url);
          doc.saveAndClose();
          DriveApp.getFileById(doc.getId()).moveTo(recordFolder);
        }
      } catch (linkError) {
        console.error(`Could not process link "${link}": ${linkError.message}`);
      }
    });
  } catch (e) {
    console.error(`createLinkShortcuts_ error: ${e.message}`);
  }
}

/**
 * Moves the primary document into the item's folder, or creates a shortcut if it lacks move permissions.
 * @param {string} folderId The item's Drive folder ID.
 * @param {string} newDocUrl The Primary_Doc URL.
 * @private
 */
function handlePrimaryDoc_(folderId, newDocUrl) {
    if (!folderId || !newDocUrl) return;
    try {
        const driveFileIdMatch = newDocUrl.match(/\/d\/([\w-]+)/);
        if (!driveFileIdMatch || !driveFileIdMatch[1]) return;
        const fileId = driveFileIdMatch[1];
        
        const recordFolder = DriveApp.getFolderById(folderId);
        
        // Check if file or shortcut is already in this folder
        const files = recordFolder.getFiles();
        let alreadyInFolder = false;
        while(files.hasNext()) {
            const f = files.next();
            if (f.getId() === fileId || (f.getMimeType() === MimeType.SHORTCUT && f.getTargetId() === fileId)) {
                alreadyInFolder = true;
                break;
            }
        }
        if (alreadyInFolder) return;

        const file = DriveApp.getFileById(fileId);
        try {
            file.moveTo(recordFolder);
        } catch(e) {
            // Fallback to shortcut if we lack move permissions or it's a shared drive boundary
            recordFolder.createShortcut(fileId);
        }
    } catch(e) {
        console.warn("Could not process primary doc handling: " + e.message);
    }
}

/**
 * Copies all files from the specified originator Google Drive folder or file link(s)
 * directly into our system-created destination folder.
 * This guarantees our organization owns the copies and downstream assignees immediately
 * have access without waiting for external permissions.
 *
 * @param {string} sourceLinks Single URL or multiline string of Drive URLs.
 * @param {string} destinationFolderId The system item folder ID where copies should be placed.
 * @param {string} finalId The item ID (e.g. TASK-1001).
 * @returns {{success: boolean, count: number, files: Array<{name: string, url: string, id: string}>, error?: string}}
 */
function cloneSourceFilesToFolder_(sourceLinks, destinationFolderId, finalId) {
  if (!sourceLinks || !destinationFolderId) {
    return { success: false, count: 0, files: [] };
  }

  const copiedFiles = [];
  let destinationFolder;
  try {
    destinationFolder = DriveApp.getFolderById(destinationFolderId);
  } catch (e) {
    console.error(`cloneSourceFilesToFolder_: Destination folder ${destinationFolderId} not accessible: ${e.message}`);
    return { success: false, count: 0, files: [], error: `Destination folder not accessible: ${e.message}` };
  }

  const rawLines = sourceLinks.split(/[\r\n,]+/).map(l => l.trim()).filter(Boolean);
  
  rawLines.forEach(line => {
    try {
      // 1. Check for Drive Folder URL
      const folderMatch = line.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
      if (folderMatch) {
        const sourceFolderId = folderMatch[1];
        try {
          const sourceFolder = DriveApp.getFolderById(sourceFolderId);
          copyFolderContentsRecursively_(sourceFolder, destinationFolder, copiedFiles);
        } catch (fErr) {
          console.error(`Failed to copy from source folder ${sourceFolderId}: ${fErr.message}`);
          throw new Error(`Could not access source folder: ${fErr.message}`);
        }
        return;
      }

      // 2. Check for Drive File URL (Doc, Sheet, Slide, generic file)
      const fileMatch = line.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || line.match(/id=([a-zA-Z0-9_-]{20,})/);
      if (fileMatch) {
        const sourceFileId = fileMatch[1];
        try {
          const sourceFile = DriveApp.getFileById(sourceFileId);
          const copy = sourceFile.makeCopy(sourceFile.getName(), destinationFolder);
          copiedFiles.push({ name: copy.getName(), url: copy.getUrl(), id: copy.getId() });
        } catch (fileErr) {
          console.error(`Failed to copy source file ${sourceFileId}: ${fileErr.message}`);
          throw new Error(`Could not access source file: ${fileErr.message}`);
        }
        return;
      }

      console.warn(`cloneSourceFilesToFolder_: Unrecognized Google Drive URL: ${line}`);
    } catch (err) {
      console.error(`Error processing link ${line}: ${err.message}`);
    }
  });

  return {
    success: true,
    count: copiedFiles.length,
    files: copiedFiles
  };
}

/**
 * Recursively copies all files in sourceFolder into targetFolder.
 * @private
 */
function copyFolderContentsRecursively_(sourceFolder, targetFolder, copiedFiles) {
  const files = sourceFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    try {
      const copy = file.makeCopy(file.getName(), targetFolder);
      copiedFiles.push({ name: copy.getName(), url: copy.getUrl(), id: copy.getId() });
    } catch (err) {
      console.warn(`Could not copy file ${file.getName()}: ${err.message}`);
    }
  }

  const subfolders = sourceFolder.getFolders();
  while (subfolders.hasNext()) {
    const subfolder = subfolders.next();
    try {
      const targetSubfolder = targetFolder.createFolder(subfolder.getName());
      copyFolderContentsRecursively_(subfolder, targetSubfolder, copiedFiles);
    } catch (err) {
      console.warn(`Could not copy subfolder ${subfolder.getName()}: ${err.message}`);
    }
  }
}


/**
 * Requests a native Google Docs approval on a document.
 * @param {string} itemId The item ID (e.g. TASK-1234)
 * @param {string} fileId The Google Drive file ID
 * @param {string[]} approverEmails Array of approver email addresses
 * @param {string} instructions Message to include
 * @param {string} dueDate ISO date string
 */

/**
 * Unlocks a document that was locked by a previous native approval.
 * @param {string} fileId
 */
function unlockDocument_(fileId) {
  try {
    if (!fileId) return;
    const file = DriveApp.getFileById(fileId);
    if (file.isLocked()) {
      file.setLocked(false);
      console.log("Successfully unlocked document via DriveApp: " + fileId);
    }
  } catch(e) {
    console.warn("Could not unlock document via DriveApp: " + e.message);
    
    // Fallback: try patching metadata via REST API
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
      const payload = { "contentHints": { "readOnly": false } };
      UrlFetchApp.fetch(url, {
        method: 'patch',
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch(err) {
      console.warn("REST API unlock fallback also failed: " + err.message);
    }
  }
}

function requestDocApproval(itemId, fileId, approverEmails, instructions, dueDate) {
  try {
    const approvalConfig = {
      approvers: approverEmails.map(email => ({ emailAddress: email })),
      message: instructions || 'Please review and approve this document.',
      dueDate: dueDate || null
    };

    // Call the Drive Approvals API
    const response = Drive.Approvals.create(approvalConfig, fileId);

    // Store the approval request ID in Approval_Tracking sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let trackingSheet = ss.getSheetByName('Approval_Tracking');
    if (!trackingSheet) {
      trackingSheet = ss.insertSheet('Approval_Tracking');
      trackingSheet.appendRow(['Item_ID', 'File_ID', 'Approval_ID', 'Approvers', 'Requested_Date', 'Status', 'Completed_Date', 'Result']);
    }
    
    trackingSheet.appendRow([
      itemId, fileId, response.id, approverEmails.join(', '), new Date(), 'Pending', '', ''
    ]);

    return { success: true, approvalId: response.id };
  } catch (e) {
    console.error(`requestDocApproval failed for ${itemId}: ${e.message}`);
    throw e;
  }
}

/**
 * Updates a native Google Docs approval decision.
 */
function updateNativeApproval_(fileLink, decision) {
  try {
    const fileIdMatch = fileLink.match(/[-\w]{25,}/);
    if (!fileIdMatch) return;
    const fileId = fileIdMatch[0];
    // Native update via Drive.Approvals requires specific approval IDs. 
    // This serves as a placeholder to be fully integrated with Approval_Tracking.
    console.log(`Native approval update triggered for file ${fileId} with decision: ${decision}`);
  } catch(e) {
    console.error(`updateNativeApproval_ failed: ${e.message}`);
  }
}


/**
 * Background trigger to copy template files asynchronously.
 */
function processAsyncTemplateCopy_(e) {
  // Clean up trigger
  if (e && e.triggerUid) {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
      if (t.getUniqueId() === e.triggerUid) ScriptApp.deleteTrigger(t);
    });
  }

  const props = PropertiesService.getScriptProperties();
  const allKeys = props.getKeys();
  
  for (let key of allKeys) {
    if (key.startsWith('copyJob_')) {
      const jobRaw = props.getProperty(key);
      if (!jobRaw) continue;
      
      try {
        const job = JSON.parse(jobRaw);
        const templateFolder = DriveApp.getFolderById(job.sourceId);
        const targetFolder = DriveApp.getFolderById(job.targetId);
        
        const files = templateFolder.getFiles();
        while (files.hasNext()) {
          const file = files.next();
          const copiedFile = file.makeCopy(file.getName(), targetFolder);
          
          // Transfer ownership of copied templates to silence deployer notifications
          if (job.ownerEmail && job.ownerEmail.endsWith('@gsa.gov')) {
              try {
                  copiedFile.setOwner(job.ownerEmail);
              } catch(e) {
                  console.error("Could not transfer file ownership to " + job.ownerEmail + ": " + e.message);
              }
          }
        }
      } catch (err) {
        console.error("Error in processAsyncTemplateCopy_: " + err.message);
      } finally {
        // Always delete the job so we don't infinitely retry a broken one
        props.deleteProperty(key);
      }
    }
  }
}

/**
 * Grants editor access to a Drive folder for a list of names/emails using parallel batch processing.
 * Supports "First Last <email@gsa.gov>", plain emails, and comma-separated lists.
 */
function grantFolderAccessFast_(folderId, identifiers) {
    if(!identifiers || identifiers.length === 0 || !folderId) return;
    
    // 1. Get Stakeholders Map
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let stkSh = ss.getSheetByName('Stakeholders');
    const emailMap = new Map();
    if (stkSh && stkSh.getLastRow() > 1) {
        const stkData = stkSh.getRange(2, 1, stkSh.getLastRow() - 1, 2).getValues();
        stkData.forEach(r => {
            if (r[0] && r[1]) emailMap.set(r[0].toString().trim().toLowerCase(), r[1].toString().trim().toLowerCase());
        });
    }

    // 2. Resolve identifiers to clean emails
    let emails = [];
    identifiers.forEach(id => {
        if (!id) return;
        const str = String(id).trim();
        // Check for angle brackets: Name <email@gsa.gov>
        const angleMatch = str.match(/<([^>]+@[^>]+)>/g);
        if (angleMatch) {
            angleMatch.forEach(m => {
                const clean = m.replace(/[<>]/g, '').trim().toLowerCase();
                if (clean.includes('@')) emails.push(clean);
            });
        } else {
            // Check for plain emails
            const plainMatches = str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
            if (plainMatches) {
                plainMatches.forEach(m => emails.push(m.trim().toLowerCase()));
            } else {
                // Name lookup
                const cleanName = str.toLowerCase();
                if (emailMap.has(cleanName)) {
                    emails.push(emailMap.get(cleanName));
                }
            }
        }
    });

    const validEmails = [...new Set(emails.filter(e => e.includes('@')))];
    if(validEmails.length === 0) return;
    
    // 3. Check existing permissions first to prevent duplicate grants and notification spam
    const alreadyHasAccess = new Set();
    try {
        if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.list) {
            const permList = Drive.Permissions.list(folderId, {
                supportsAllDrives: true,
                fields: 'permissions(id,emailAddress,role)'
            });
            if (permList && permList.permissions) {
                permList.permissions.forEach(p => {
                    if (p.emailAddress && (p.role === 'writer' || p.role === 'owner' || p.role === 'organizer' || p.role === 'fileOrganizer')) {
                        alreadyHasAccess.add(p.emailAddress.toLowerCase());
                    }
                });
            }
        }
    } catch(e) {
        console.warn("Drive.Permissions.list check failed: " + e.message);
    }

    // Fallback: check DriveApp editors / owner if alreadyHasAccess is empty
    if (alreadyHasAccess.size === 0) {
        try {
            const folder = DriveApp.getFolderById(folderId);
            try {
                const owner = folder.getOwner();
                if (owner && owner.getEmail()) alreadyHasAccess.add(owner.getEmail().toLowerCase());
            } catch(e) {}
            try {
                folder.getEditors().forEach(u => {
                    if (u && u.getEmail()) alreadyHasAccess.add(u.getEmail().toLowerCase());
                });
            } catch(e) {}
        } catch(e) {
            console.warn("DriveApp check existing editors failed: " + e.message);
        }
    }

    // Filter out users who already have writer/owner access
    const toGrant = validEmails.filter(e => !alreadyHasAccess.has(e));
    if (toGrant.length === 0) {
        // Everyone already has editor access! No-op: zero API calls, zero notification emails.
        return;
    }

    // 4. Grant access silently (sendNotificationEmail: false)
    const stillNeedFallback = [];
    toGrant.forEach(email => {
        let granted = false;
        try {
            if (typeof Drive !== 'undefined' && Drive.Permissions && Drive.Permissions.create) {
                Drive.Permissions.create(
                    { role: 'writer', type: 'user', emailAddress: email },
                    folderId,
                    { sendNotificationEmail: false, supportsAllDrives: true }
                );
                granted = true;
            }
        } catch(err) {
            console.warn(`Drive.Permissions.create failed for ${email}: ${err.message}`);
        }
        if (!granted) {
            stillNeedFallback.push(email);
        }
    });

    // 5. REST API fallback if Drive.Permissions.create was unavailable
    if (stillNeedFallback.length > 0) {
        const token = ScriptApp.getOAuthToken();
        const requests = stillNeedFallback.map(email => ({
            url: `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: "Bearer " + token },
            payload: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
            muteHttpExceptions: true
        }));
        
        try {
            const responses = UrlFetchApp.fetchAll(requests);
            responses.forEach((res, idx) => {
                const code = res.getResponseCode();
                if (code >= 400) {
                    console.warn(`Drive REST API permission grant for ${stillNeedFallback[idx]} returned ${code}: ${res.getContentText()}`);
                    try {
                        DriveApp.getFolderById(folderId).addEditor(stillNeedFallback[idx]);
                    } catch(fallbackErr) {
                        console.error(`DriveApp fallback failed for ${stillNeedFallback[idx]}: ${fallbackErr.message}`);
                    }
                }
            });
        } catch(e) {
            console.error("Failed to batch grant folder access via UrlFetch: " + e.message);
            try {
                const folder = DriveApp.getFolderById(folderId);
                stillNeedFallback.forEach(email => {
                    try { folder.addEditor(email); } catch(err) {}
                });
            } catch(fallbackAllErr) {}
        }
    }
}

/**
 * Renames an existing Drive folder to match the new item ID and moves it to the
 * correct base folder for the new type as configured in Drive_Config.
 * Called during a cross-sheet type migration (e.g. Project → Task).
 *
 * @param {string} folderId    The existing Drive folder ID.
 * @param {string} oldId       The old item ID (e.g. "PROJ-1234").
 * @param {string} newId       The new item ID (e.g. "TASK-1067").
 * @param {string} title       The item title.
 * @param {string} newType     The new item type (e.g. "Task").
 * @param {string} oldDriveLink The old DriveLink string (to update the folder URL line).
 * @returns {{folderId: string, driveLink: string}}
 * @private
 */
function migrateItemFolder_(folderId, oldId, newId, title, newType, oldDriveLink) {
  const folder = DriveApp.getFolderById(folderId);

  // 1. Rename to new ID format
  const newFolderName = `${newId}: ${title}`;
  folder.setName(newFolderName);

  // 2. Move to the correct base folder for the new type
  try {
    const driveConfigMap = getDriveConfigMap_();
    const config = driveConfigMap.get((newType || '').trim().toLowerCase());
    if (config && config.baseFolderId) {
      let cleanBaseId = config.baseFolderId;
      const baseMatch = cleanBaseId.match(/[-\w]{25,}/);
      if (baseMatch) cleanBaseId = baseMatch[0];

      const fiscalYear = getCurrentFiscalYear_();
      const destBase = DriveApp.getFolderById(cleanBaseId);
      const fyFolder = getOrCreateSubfolder_(destBase, fiscalYear);

      // Move folder: remove from all current parents, add to new parent
      const currentParents = folder.getParents();
      folder.moveTo(fyFolder);

      console.log(`Folder ${folderId} moved to ${newType} base folder (${fyFolder.getName()})`);
    }
  } catch(e) {
    console.error(`Could not move folder to new base: ${e.message}`);
    // Non-fatal — folder was renamed but stays in place
  }

  // 3. Build the updated driveLink: replace the old folder URL line with the new one
  const newFolderUrl = folder.getUrl();
  let newDriveLink = oldDriveLink || '';
  // Replace the old folder URL if it's there; otherwise prepend the new one
  const folderUrlPattern = /https:\/\/drive\.google\.com\/drive\/folders\/[^\s\n]+/;
  if (folderUrlPattern.test(newDriveLink)) {
    newDriveLink = newDriveLink.replace(folderUrlPattern, newFolderUrl);
  } else {
    newDriveLink = `${newFolderUrl}\n${newDriveLink}`.trim();
  }

  return { folderId: folder.getId(), driveLink: newDriveLink };
}

/**
 * Reads the Drive_Config sheet and returns a Map mapping item types to their base/template folder configs.
 * @returns {Map<string, {baseFolderId: string, templateFolderId: string}>}
 * @private
 */

function getDriveConfigMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = new Map();
  const sh = ss.getSheetByName('Drive_Config');
  if (!sh || sh.getLastRow() < 2) return map;
  
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  data.forEach(r => {
    if (r[0]) {
      map.set(r[0].toString().trim().toLowerCase(), {
        baseFolderId: r[1] ? r[1].toString().trim() : '',
        templateFolderId: r[2] ? r[2].toString().trim() : ''
      });
    }
  });
  return map;
}

/**
 * Returns a short-lived OAuth2 token for the currently executing user.
 * Called by the client-side Google Drive Picker via google.script.run.
 * @returns {string} The OAuth token string.
 */
function getOAuthToken() {
  return ScriptApp.getOAuthToken();
}
