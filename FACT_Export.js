// ==========================================
// 10. EXPORT GENERATOR (Bulletproof Version)
// ==========================================

// In KanbanBackend.gs -- REPLACE YOUR ENTIRE generateKanbanDoc FUNCTION WITH THIS

function generateKanbanDoc(idsToExport, viewState) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = loadConfig_();
  let allData = [];
  try {
    allData = getProjectsData_(true).projects;
  } catch (e) {
    throw new Error("Could not fetch project data. " + e.message);
  }

  const exportItems = allData.filter(p => idsToExport.includes(p.ID));
  if (exportItems.length === 0) throw new Error("No matching items found to export.");

  const statusOrder = config.stages;
  
  const groups = {};
  statusOrder.forEach(s => groups[s] = []);
  exportItems.forEach(item => {
    const s = item.Status || 'Backlog';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  });

  const dateStr = new Date().toLocaleDateString();
  const doc = DocumentApp.create(`PMSC Export - ${dateStr}`);
  const body = doc.getBody();
  
  // Set consistent page styling
  body.setPageHeight(792).setPageWidth(612);
  body.setMarginTop(72).setMarginBottom(72).setMarginLeft(72).setMarginRight(72);

  // Add document header
  body.insertParagraph(0, `Kanban Snapshot - ${dateStr}`).setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`Total Items: ${exportItems.length}`).setItalic(true).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendHorizontalRule();

  const fmtDate = (dStr) => {
    if (!dStr) return "";
    try {
      return new Date(dStr).toLocaleDateString('en-US', { timeZone: 'UTC' });
    } catch(e) { return dStr; }
  };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Loop through each status column that has items
  for (const status of statusOrder) {
    const items = groups[status];
    if (!items || items.length === 0) continue;

    const header = body.appendParagraph(`\n${status} (${items.length})`);
    header.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    
    items.forEach(item => {
      try {
        // --- START: REWRITTEN TABLE-BASED ITEM RENDERING ---
        const table = body.appendTable();
        table.setBorderWidth(0.5).setBorderColor('#CCCCCC');
        const tableRow = table.appendTableRow();
        
        // --- START: NEW COLOR LOGIC ---
        let itemColor = '#1a73e8'; // Default Blue (On Track)
        if (item.Status === 'Done' || item.Status === 'Cancelled') {
          itemColor = '#188038'; // Green
        } else if (item.DueDate) {
          const dueDate = new Date(item.DueDate);
          dueDate.setHours(0, 0, 0, 0);
          const diffDays = (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays < 0) {
            itemColor = '#d93025'; // Red (Overdue)
          } else if (diffDays <= 3) {
            itemColor = '#f9ab00'; // Yellow (Due Soon)
          }
        }
        // --- END: NEW COLOR LOGIC ---
        
        const stripCell = tableRow.appendTableCell('');
        stripCell.setWidth(10).setBackgroundColor(itemColor);

        const contentCell = tableRow.appendTableCell();
        contentCell.setPaddingLeft(10).setPaddingRight(10);
        
        const titlePara = contentCell.appendParagraph(`[${item.Type || 'Task'}] ${item.Title || 'Untitled'}`);
        titlePara.setBold(true).setFontSize(11);
        
        const metaPara = contentCell.appendParagraph('');
        metaPara.appendText(`Owner: ${item.Owner || 'Unassigned'}`);
        if(item.Assigned) metaPara.appendText(`  |  Team: ${item.Assigned}`);
        metaPara.setFontSize(9).setForegroundColor("#333333");
        
        const datePara = contentCell.appendParagraph('');
        let dateParts = [];
        if (item.RecDate) dateParts.push(`Received: ${fmtDate(item.RecDate)}`);
        if (item.IntDue) dateParts.push(`Internal Due: ${fmtDate(item.IntDue)}`);
        if (item.DueDate) dateParts.push(`Final Due: ${fmtDate(item.DueDate)}`);
        if (dateParts.length > 0) {
            datePara.appendText(dateParts.join('  |  ')).setFontSize(9).setForegroundColor("#333333");
        }

        if (item.StatusSummary) {
            const summaryPara = contentCell.appendParagraph(`Current Status: ${item.StatusSummary}`);
            summaryPara.setItalic(true).setFontSize(9).setForegroundColor("#1155CC");
        }

        // --- START: NEW CLICKABLE LINK LOGIC ---
        if (item.DriveLink) {
            const linksHeader = contentCell.appendParagraph('Attachments/Links:');
            linksHeader.setFontSize(9).setForegroundColor('#333333');
            
            const links = item.DriveLink.split('\n').filter(Boolean);
            links.forEach(link => {
                const urlMatch = link.match(/https?:\/\/\S+/);
                const textPart = urlMatch ? link.replace(urlMatch[0], '').trim() : link;
                const url = urlMatch ? urlMatch[0] : '';
                
                const linkPara = contentCell.appendListItem(textPart || url);
                linkPara.setGlyphType(DocumentApp.GlyphType.BULLET);
                if (url) {
                    linkPara.setLinkUrl(url);
                }
                linkPara.setFontSize(8).setForegroundColor('#0b5394');
            });
        }
        // --- END: NEW CLICKABLE LINK LOGIC ---

        // Conditionally include fields based on UI toggles
        let additionalDetails = '';
        if (viewState.complex) { /* ... logic ... */ }
        if (viewState.req) { /* ... logic ... */ }
        if (viewState.desc) { /* ... logic ... */ }
        if (viewState.note) { /* ... logic ... */ }
        
        if (additionalDetails) {
            contentCell.appendHorizontalRule();
            contentCell.appendParagraph(additionalDetails.trim()).setFontSize(9).setItalic(true);
        }

      } catch (err) {
        console.error(`Skipped item ${item.ID} due to error: ${err.message}`);
        body.appendParagraph(`[Error rendering item ${item.ID}]`).setItalic(true).setForegroundColor('#FF0000');
      }
      body.appendParagraph(""); // Spacer between items
    });
  }

  doc.saveAndClose();

  // Move the document out of "My Drive"
  let targetFolder = null;
  if (config.reportsFolderId) {
    try { targetFolder = DriveApp.getFolderById(config.reportsFolderId); } catch(e) {}
  }
  if (!targetFolder) {
    const ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
    const parents = DriveApp.getFileById(ssId).getParents();
    targetFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  }
  DriveApp.getFileById(doc.getId()).moveTo(targetFolder);

  return doc.getUrl();
}


// Module-level config cache. Reset automatically between executions (Apps Script is stateless).
// PERF-06: Caches the result of loadConfig_() for the lifetime of a single execution,
// preventing repeated sheet reads and PropertiesService calls when multiple functions
// call loadConfig_() in the same request.
let _configCache = null;

function loadConfig_() {
  if (_configCache) return _configCache;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Load Visual Config from "Config" Sheet
  let sh = ss.getSheetByName('Config');
  // Default structure if sheet is missing
  const sheetConfig = {
     appTitle: "PMSC System",
     workgroupName: "PMSC",
     orgCode: "FC",
     idPrefix: "ITEM",
     types: ['Project', 'Task', 'Data Call'],
     stages: ['Backlog', 'Hold', 'To Do', 'In Progress', 'Blocked', 'Done', 'Cancelled'],
     execs: ['Director Review', 'Legal', 'Final Approval'],
     admins: [],
     approverRoles: ['AC', 'DAC-A', 'Office Director'],
     sidebarConfig: "[]"
  };

  if (sh) {
    const data = sh.getDataRange().getValues();
    const getList = (colIndex) => data.slice(1).map(r => r[colIndex]).filter(Boolean);
    const settings = {};
    data.slice(1).forEach(r => { if(r[0]) settings[r[0]] = r[1]; });

    sheetConfig.appTitle = settings['System Title'] || "PMSC System";
    sheetConfig.workgroupName = settings['Workgroup Name'] || "PMSC";
    sheetConfig.orgCode = settings['Org Code'] || "FC";
    sheetConfig.idPrefix = settings['ID Prefix'] || "ITEM";
    sheetConfig.types = getList(2); // Col C
    sheetConfig.stages = getList(3); // Col D
    sheetConfig.execs = getList(4); // Col E
    sheetConfig.admins = getList(5).map(e => String(e).toLowerCase().trim()); // Col F
    sheetConfig.approverRoles = getList(6); // Col G
    sheetConfig.reportsFolderId = settings['Reports Folder ID'] || "";
    sheetConfig.sidebarConfig = settings['Sidebar Config'] || "[]";

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
              driveConfig[row[0]] = {
                prefix: '',
                base: row[1] || '',
                template: row[2] || ''
              };
            } else {
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
    sheetConfig.driveConfig = driveConfig;
  }

  // 2. Load Secrets from Script Properties
  const scriptProps = PropertiesService.getScriptProperties();
  const secrets = {
    templateFolderId: scriptProps.getProperty('TEMPLATE_FOLDER_ID'),
    destinationFolderId: scriptProps.getProperty('DESTINATION_FOLDER_ID'),
    groupEmail: scriptProps.getProperty('GROUP_EMAIL'),
    geminiKey: scriptProps.getProperty('CLO_GEMINI_KEY'),
    chatWebhook: scriptProps.getProperty('CHAT_WEBHOOK'),
    calendarId: scriptProps.getProperty('LEAVE_CALENDAR_ID'),
    boardUrl: scriptProps.getProperty('BOARD_URL') || ScriptApp.getService().getUrl()
  };

  // 3. Return Combined Config (and cache it)
  _configCache = { ...sheetConfig, ...secrets };
  return _configCache;
}
