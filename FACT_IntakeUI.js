// ==========================================
// 4. INTAKE UI HANDLERS (Unchanged)
// ==========================================

function promoteIntake(rowIndex, formObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Intake_Queue');
  
  // 1. Get Thread ID from Intake row (Col I / Index 9)
  const threadId = sh.getRange(rowIndex, 9).getValue();
  formObj.ThreadID = threadId;
  formObj.IntakeRowIndex = rowIndex;

  // 2. Create the Item (Project or Task)
  const result = saveItem(formObj); // <--- CHANGED: Uses saveItem now
  
  // 3. Mark Intake as Converted
  sh.getRange(rowIndex, 7).setValue('Converted'); 
  sh.getRange(rowIndex, 1, 1, 9).setBackground('#E6F4EA');
  
  return result;
}

function getStandupData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. ICEBREAKER LOGIC (Unchanged)
  let question = "How are you today?";
  try {
    const qSheet = ss.getSheetByName('Icebreakers');
    if (qSheet && qSheet.getLastRow() > 1) {
       const range = qSheet.getRange(2, 1, qSheet.getLastRow() - 1, 2);
       const data = range.getValues();
       const todayStr = new Date().toDateString();
       let foundToday = false;

       for (let i = 0; i < data.length; i++) {
          const rowDate = data[i][1];
          if (rowDate instanceof Date && rowDate.toDateString() === todayStr) {
             question = data[i][0];
             foundToday = true;
             break;
          }
       }
       if (!foundToday) {
          let targetIndex = -1;
          for (let i = 0; i < data.length; i++) {
             if (!data[i][1]) {
                question = data[i][0];
                targetIndex = i;
                break;
             }
          }
          if (targetIndex !== -1) {
             qSheet.getRange(targetIndex + 2, 2).setValue(new Date());
          }
       }
    }
  } catch(e) { console.error("Icebreaker Error: " + e.message); }

  // 2. TEAM LOG LOGIC (Unchanged)
  let log = [];
  try {
    const logSh = ss.getSheetByName('Team_Log');
    if (logSh && logSh.getLastRow() > 1) {
       const todayStr = new Date().toLocaleDateString();
       const data = logSh.getRange(2, 1, logSh.getLastRow()-1, 7).getValues();
       log = data.filter(r => new Date(r[0]).toLocaleDateString() === todayStr).map(r => ({
          email: r[1], time: new Date(r[2]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          status: r[3], answer: r[4], note: r[5], blocker: r[6]
       }));
    }
  } catch(e) {}

  // Default to null. Let UI handle fallback!
  let whiteboard = null;
  
  try {
    const wbSheet = ss.getSheetByName('Daily_Brief');
    if(wbSheet && wbSheet.getLastRow() > 1) {
        const data = wbSheet.getRange(2, 1, wbSheet.getLastRow() - 1, 6).getValues();
        const todayStr = new Date().toDateString();
        
        // Find EXACT match for today
        const selectedRow = data.find(r => r[0] instanceof Date && r[0].toDateString() === todayStr);
        
        // Only overwrite the error if we found a match
        if (selectedRow) {
           whiteboard = { 
              tip: selectedRow[1], 
              strategy: selectedRow[2], 
              fact: selectedRow[3], 
              history: selectedRow[4], 
              chuckle: selectedRow[5] 
           };
        }
    }
  } catch(e) { console.error("Whiteboard Error: " + e.message); }

  // 4. OUT OF OFFICE LOGIC (Unchanged)
  let outOffice = [];
  try {
     const config = loadConfig_();
     if (config.calendarId) {
        const cal = CalendarApp.getCalendarById(config.calendarId);
        if (cal) {
           const events = cal.getEventsForDay(new Date());
           outOffice = events.map(e => ({ title: e.getTitle() }));
        }
     }
  } catch(e) {}

  return { question, log, outOffice, whiteboard }; 
}

function postCheckIn(form) {
  const result = { success: true, status: 'new', chatSent: false };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSh = ss.getSheetByName('Team_Log');
    const userEmail = Session.getActiveUser().getEmail();
    
    // Format Name
    let name = userEmail;
    if (userEmail.includes('@')) {
      name = userEmail.split('@')[0].split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }

    const now = new Date();
    
    // --- 1. ROBUST DATE CHECK ---
    const data = logSh.getDataRange().getValues();
    let rowIndex = -1;
    
    for (let i = 1; i < data.length; i++) {
      const rowDate = new Date(data[i][0]);
      
      // Compare strictly by Year, Month, Day (Ignores Time/Timezone issues)
      const isSameDay = 
        rowDate.getFullYear() === now.getFullYear() &&
        rowDate.getMonth() === now.getMonth() &&
        rowDate.getDate() === now.getDate();

      if (isSameDay && data[i][1] === userEmail) {
        rowIndex = i + 1; // Store the Sheet Row Number (1-based)
        break;
      }
    }

    // --- 2. DUPLICATE INTERCEPTOR ---
    // If we found a row AND the user hasn't confirmed an overwrite yet:
    if (rowIndex > 0 && !form.forceUpdate) {
       return { success: false, status: 'duplicate' };
    }

    // Clean inputs
    const status = form.status || "Unknown";
    const answer = form.answer || "";
    const note = form.note || "";
    const blocker = form.blocker || "";

    // --- 3. SAVE TO SHEET ---
    if (rowIndex > 0) {
      // OVERWRITE EXISTING ROW (Columns 3, 4, 5, 6, 7 -> Time, Status, Answer, Note, Blocker)
      // Note: We update the "Time" (Col 3) to "now" to show the latest update time
      logSh.getRange(rowIndex, 3, 1, 5).setValues([[now, status, answer, note, blocker]]);
      result.status = 'updated';
    } else {
      // APPEND NEW ROW
      logSh.appendRow([now, userEmail, now, status, answer, note, blocker]);
      result.status = 'new';
    }

    // --- 4. SEND TO CHAT ---
    try {
      let icon = "❓";
      if (status.includes('Duty')) icon = "🏢"; 
      else if (status.includes('Telework')) icon = "🏠"; 
      else if (status.includes('Leave')) icon = "🌴"; 
      else if (status.includes('Customer')) icon = "💼";

      const updateTag = (result.status === 'updated') ? " *(Updated)*" : "";

      const chatMessageText = `*${name}* checked in${updateTag}:\n${icon} ${status}` + 
            (blocker ? `\n🚨 *Blockers:* ${blocker}` : "") + 
            (note ? `\n📝 ${note}` : "") +
            (answer ? `\n🧊 *Icebreaker:* ${answer}` : "");
      
      // ARCH-04: Consolidate duplicate sendToChat to sendToChat_
      sendToChat_(chatMessageText);
      result.chatSent = true;
      
    } catch (chatError) {
      console.error("Chat Error: " + chatError.message);
    }

    return result;

  } catch (e) { 
    return { success: false, error: e.message }; 
  }
}

function getSupervisorReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName('Team_Log');
  if (!logSh || logSh.getLastRow() < 2) return [];

  const rawData = logSh.getRange(2, 1, logSh.getLastRow()-1, 7).getValues();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14); 

  let report = rawData.filter(r => new Date(r[0]) >= cutoff).map(r => {
      let nameParts = r[1].split('@')[0].split('.');
      let name = nameParts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      return { date: new Date(r[0]).toLocaleDateString(), name: name, time: new Date(r[2]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), status: r[3], note: r[5] };
    });

  report.sort((a, b) => (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0));
  return report;
}

function getWhiteboardData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Daily_Brief');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(sheet.getLastRow(), 2, 1, 5).getValues()[0];
  return { tip: data[0], strategy: data[1], fact: data[2], history: data[3], chuckle: data[4] };
}

function dismissIntake(rowIndex) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Intake_Queue');
  
  if (!sh) throw new Error("Sheet 'Intake_Queue' not found");

  // Safety Check: Ensure rowIndex is a number and valid
  const idx = parseInt(rowIndex);
  if (isNaN(idx) || idx < 2 || idx > sh.getLastRow()) {
     throw new Error("Invalid Row Index: " + rowIndex);
  }

  try {
    // DELETE the row directly
    sh.deleteRow(idx);
    
    // Check if queue is now empty to update badge count immediately
    const remaining = sh.getLastRow() - 1; 
    return { success: true, remaining: remaining > 0 ? remaining : 0 };
    
  } catch(e) {
    throw new Error("Delete Failed: " + e.message);
  }
}
/**
 * AUTOMATION: Auto-Archive 'Done' items
 * Run this via Time-Driven Trigger (Weekly)
 */
function autoArchiveDoneItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Configuration: Source Tab -> Destination Tab
  const moves = [
    { source: 'Tasks', dest: 'Tasks_Archive', statusCol: 7 },        // Col G
    { source: 'Projects', dest: 'Projects_Archive', statusCol: 7 },  // Col G
    
    // --- ADDED THIS LINE ---
    { source: 'Sub_Tasks', dest: 'Sub_Tasks_Archive', statusCol: 7 } // Col G
    // -----------------------
  ];

  let totalMoved = 0;

  moves.forEach(m => {
    const srcSheet = ss.getSheetByName(m.source);
    const destSheet = ss.getSheetByName(m.dest);

    if (!srcSheet || !destSheet) return;

    const lastRow = srcSheet.getLastRow();
    if (lastRow < 2) return;

    const numCols = srcSheet.getLastColumn();
    const headers = srcSheet.getRange(1, 1, 1, numCols).getValues()[0];
    const statusColIdx = headers.indexOf('Status');
    const statusIdx = (statusColIdx !== -1) ? statusColIdx : (m.statusCol - 1);

    // Get all data
    const range = srcSheet.getRange(2, 1, lastRow - 1, numCols);
    const values = range.getValues();
    
    const toKeep = [];
    const toArchive = [];

    for (let i = 0; i < values.length; i++) {
      const status = values[i][statusIdx]; 
      
      if (status === 'Done' || status === 'Cancelled') {
         toArchive.push(values[i]);
      } else {
         toKeep.push(values[i]);
      }
    }

    if (toArchive.length > 0) {
       // Ensure destSheet has enough columns
       if (destSheet.getMaxColumns() < numCols) {
         destSheet.insertColumnsAfter(destSheet.getMaxColumns(), numCols - destSheet.getMaxColumns());
       }

       // Append to Archive
       destSheet.getRange(destSheet.getLastRow() + 1, 1, toArchive.length, numCols).setValues(toArchive);
       
       // Clear Source and Rewrite Keepers
       srcSheet.getRange(2, 1, lastRow - 1, numCols).clearContent();
       
       if (toKeep.length > 0) {
         srcSheet.getRange(2, 1, toKeep.length, numCols).setValues(toKeep);
       }
       
       totalMoved += toArchive.length;
       console.log(`Moved ${toArchive.length} items from ${m.source} to ${m.dest}`);
    }
  });
  
  console.log(`Archiving Complete. Total moved: ${totalMoved}`);
}

// ==========================================
// 12. COMBINE INTAKE (MERGE THREADS + COPY NOTE)
// ==========================================
function combineIntakeToTask(intakeRowIndex, targetId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const intakeSh = ss.getSheetByName('Intake_Queue');
  const taskSh = ss.getSheetByName('Tasks'); 
  
  if (!intakeSh || !taskSh) return { success: false, error: "Sheets missing" };

  const idx = parseInt(intakeRowIndex);
  
  // 1. Get Intake Data (ThreadID, Body, Subject, Sender)
  // Col B(2)=Sender, C(3)=Subject, D(4)=Body, I(9)=ThreadID
  const rowData = intakeSh.getRange(idx, 1, 1, 9).getValues()[0];
  const sender = rowData[1];
  const subject = rowData[2];
  const body = rowData[3];
  const threadIdToAdd = rowData[8]; // Index 8 = Col I

  if (!threadIdToAdd) return { success: false, error: "No Thread ID found on intake item." };

  // 2. Find the Target Task
  const cleanId = String(targetId).trim();
  const data = taskSh.getDataRange().getValues();
  let taskRow = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === cleanId) {
       taskRow = i + 1; 
       break;
    }
  }

  if (taskRow === -1) return { success: false, error: "Task ID not found." };

  // 3. Update the Task's ThreadID (Col L / Column 12)
  const currentThreadVal = taskSh.getRange(taskRow, 12).getValue();
  let newVal = "";
  
  if (String(currentThreadVal).trim() === "") {
     newVal = threadIdToAdd;
  } else {
     if (String(currentThreadVal).includes(threadIdToAdd)) {
        newVal = currentThreadVal; 
     } else {
        newVal = currentThreadVal + ", " + threadIdToAdd;
     }
  }
  taskSh.getRange(taskRow, 12).setValue(newVal);

  // --- NEW STEP 4: SAVE THE CURRENT EMAIL AS A NOTE ---
  if (body) {
      const noteText = `📧 MERGED EMAIL\nFrom: ${sender}\nSubject: ${subject}\n\n${body}`;
      addNote(cleanId, noteText);
  }
  // ----------------------------------------------------

  // 5. Mark Intake as Converted
  intakeSh.getRange(idx, 7).setValue('Converted'); 
  intakeSh.getRange(idx, 1, 1, 9).setBackground('#f3f3f3'); 

  return { success: true, targetId: cleanId };
}

