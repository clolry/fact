// ==========================================
// FEDERATED HUB-AND-SPOKE ARCHITECTURE
// ==========================================

function getMasterId_() {
  return PropertiesService.getScriptProperties().getProperty('MASTER_SS_ID');
}

/**
 * Resolves an organization's Spoke Spreadsheet ID from the Master's Org_Registry.
 */
function getSpokeIdForOrg_(orgCode) {
  const masterId = getMasterId_();
  if (!masterId) return null;
  try {
    const masterSS = SpreadsheetApp.openById(masterId);
    let registry = masterSS.getSheetByName('Org_Registry');
    if (!registry) return null;
    const data = registry.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orgCode) return data[i][3]; // Col D = Spoke_SS_ID
    }
  } catch (e) {
    console.error("Error looking up Spoke ID: " + e.message);
  }
  return null;
}

/**
 * Registers this spoke with the Master Hub.
 */
function registerSpoke_(orgCode, appUrl) {
    const masterId = getMasterId_();
    if (!masterId) throw new Error("Master ID not configured.");
    const masterSS = SpreadsheetApp.openById(masterId);
    let registry = masterSS.getSheetByName('Org_Registry');
    if (!registry) {
        registry = masterSS.insertSheet('Org_Registry');
        registry.appendRow(['OrgCode', 'AdminEmail', 'AppUrl', 'SpreadsheetId', 'LastPing']);
    }
    
    const data = registry.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === orgCode) {
            rowIndex = i + 1;
            break;
        }
    }
    
    const rowData = [
        orgCode,
        Session.getActiveUser().getEmail(),
        appUrl || ScriptApp.getService().getUrl(),
        SpreadsheetApp.getActiveSpreadsheet().getId(),
        new Date()
    ];
    
    if (rowIndex === -1) {
        registry.appendRow(rowData);
    } else {
        registry.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
    }
    return true;
}

/**
 * Syncs a task payload to the Master Hub for the Global Dashboard.
 */
function syncToMaster_(itemId, itemData, spokeId) {
  const masterId = getMasterId_();
  if (!masterId) return;
  
  // Create JSON payload for robust cross-org syncing
  const payload = {
      action: 'SYNC_TASK',
      itemId: itemId,
      title: itemData.Title || '',
      status: itemData.Status || '',
      owner: itemData.Owner || '',
      orgCode: itemData.OrgCode || '',
      spokeId: spokeId || SpreadsheetApp.getActiveSpreadsheet().getId(),
      workflowStep: itemData.WorkflowStep || '[]',
      timestamp: new Date().toISOString()
  };

  try {
      // In a real multi-org setup, this would be a UrlFetchApp POST to the Hub's App URL.
      // Since this IS the PMSC Hub or running within the same domain permissions, we can write directly:
      const masterSS = SpreadsheetApp.openById(masterId);
      let crossOrgSheet = masterSS.getSheetByName('Cross_Org_Items');
      if (!crossOrgSheet) {
          crossOrgSheet = masterSS.insertSheet('Cross_Org_Items');
          crossOrgSheet.appendRow(['Item_ID', 'Title', 'Spoke_ID', 'Status', 'Owner', 'OrgCode', 'WorkflowStep', 'Last_Sync']);
      }

      const data = crossOrgSheet.getDataRange().getValues();
      let rowIndex = -1;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === itemId) {
          rowIndex = i + 1;
          break;
        }
      }

      const rowData = [
        payload.itemId,
        payload.title,
        payload.spokeId,
        payload.status,
        payload.owner,
        payload.orgCode,
        payload.workflowStep,
        new Date()
      ];

      if (rowIndex === -1) {
        crossOrgSheet.appendRow(rowData);
      } else {
        crossOrgSheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
      }
  } catch (e) {
    console.error("Error syncing to Master: " + e.message);
  }
}

/**
 * Fetches all cross-org data for the Executive Visibility Dashboard.
 */
function fetchGlobalDashboardData_() {
    try {
        const masterId = getMasterId_();
        if (!masterId) throw new Error("Not configured as a Hub");
        const masterSS = SpreadsheetApp.openById(masterId);
        const crossOrgSheet = masterSS.getSheetByName('Cross_Org_Items');
        if (!crossOrgSheet) return [];
        
        const data = crossOrgSheet.getDataRange().getValues();
        const headers = data[0];
        const rows = [];
        for (let i = 1; i < data.length; i++) {
            const obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = data[i][j];
            }
            rows.push(obj);
        }
        return rows;
    } catch(e) {
        console.error("Error fetching global data: " + e.message);
        return [];
    }
}

/**
 * Escalates a specific task from UI to the Hub.
 */
function escalateTask_(taskId) {
    const dataService = typeof getItemById_ === 'function' ? getItemById_(taskId) : null;
    if (!dataService) {
        // Fallback or read from active sheet
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Tasks');
        const data = sheet.getDataRange().getValues();
        let headers = data[0];
        let row = data.find(r => r[0] === taskId);
        if (row) {
            let itemData = {};
            headers.forEach((h, i) => itemData[h] = row[i]);
            syncToMaster_(taskId, itemData, ss.getId());
            return true;
        }
        throw new Error("Task not found");
    } else {
        syncToMaster_(taskId, dataService, SpreadsheetApp.getActiveSpreadsheet().getId());
        return true;
    }
}
