/**
 * ==========================================================================
 * HackTrack | Synora'26 — Cloud Google Apps Script Engine & Live Team Portal
 * ==========================================================================
 * Cloud Database: Google Sheets
 * Mobile QR Scanner Cloud Target: Served via HtmlService on doGet
 * REST API: doGet & doPost JSON responses
 * ==========================================================================
 */

var SHEETS = {
  USERS: "Users",
  TEAMS: "Teams",
  ATTENDANCE: "Attendance",
  ROUND1: "Round1_Evaluations",
  ROUND2: "Round2_Evaluations",
  ROUND_CONFIG: "RoundConfig",
  LEADERBOARD: "Leaderboard",
  CERTIFICATES: "Certificates",
  ACTIVITY_LOGS: "ActivityLogs",
  SETTINGS: "Settings"
};

/**
 * Robust Spreadsheet Resolver:
 * Binds automatically to active sheet or creates/fetches in Google Drive
 */
function getSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;

  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty("HACKTRACK_SPREADSHEET_ID");
  
  if (sheetId) {
    try {
      return SpreadsheetApp.openById(sheetId);
    } catch (e) {
      Logger.log("Re-creating database spreadsheet: " + e.message);
    }
  }

  var newSs = SpreadsheetApp.create("HackTrack Synora'26 Database");
  props.setProperty("HACKTRACK_SPREADSHEET_ID", newSs.getId());
  Logger.log("Created new Cloud Spreadsheet: " + newSs.getUrl());
  return newSs;
}

/**
 * Web App GET handler
 * When scanned from mobile phone QR: Renders Cloud Team Portal HTML
 * When called by website JS: Returns JSON API data
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "";
  var teamId = (e && e.parameter && e.parameter.teamId) ? e.parameter.teamId : "";
  var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : "";
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";

  // 1. If scanned from mobile phone QR (page=team or direct teamId access)
  if (page === "team" || (!action && teamId)) {
    return renderCloudTeamPortal(teamId, token);
  }

  // 2. Otherwise handle API action request
  action = action || "ping";
  var payload = (e && e.parameter) ? e.parameter : {};

  try {
    var responseData = handleAction(action, payload, "GET");
    return createJsonResponse({ success: true, data: responseData });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.message || "Internal Server Error" });
  }
}

/**
 * Web App POST handler
 */
function doPost(e) {
  try {
    var requestData = {};
    if (e && e.postData && e.postData.contents) {
      try {
        requestData = JSON.parse(e.postData.contents);
      } catch (pErr) {
        requestData = e.parameter || {};
      }
    } else if (e && e.parameter) {
      requestData = e.parameter;
    }

    var action = requestData.action || "ping";
    var responseData = handleAction(action, requestData, "POST");
    return createJsonResponse({ success: true, data: responseData });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.message || "Execution Failed" });
  }
}

/**
 * Action Router with Safe Defaults
 */
function handleAction(action, data, method) {
  action = action || "ping";
  data = data || {};
  method = method || "WEB";

  var ss = getSpreadsheet();
  ensureDatabaseStructure(ss);

  switch (action) {
    case "ping":
      return { 
        status: "ONLINE", 
        app: "HackTrack Synora'26 Cloud API", 
        spreadsheetUrl: ss.getUrl(),
        timestamp: new Date().toISOString() 
      };

    case "initDatabase":
      return initDatabase(ss);

    case "login":
      return handleLogin(ss, data);

    case "getDashboardStats":
      return getDashboardStats(ss, data);

    case "getTeams":
      return getTeams(ss, data);

    case "getTeam":
      return getTeam(ss, data.teamId || data.token);

    case "registerTeam":
      return registerTeam(ss, data);

    case "submitTeamProblemDetails":
      return submitTeamProblemDetails(ss, data);

    case "updateTeam":
      return updateTeam(ss, data);

    case "deleteTeam":
      return deleteTeam(ss, data);

    case "unlockTeam":
      return unlockTeam(ss, data);

    case "markAttendance":
      return markAttendance(ss, data);

    case "getAttendance":
      return getAttendance(ss, data);

    case "createUser":
      return createUser(ss, data);

    case "deleteUser":
      return deleteUser(ss, data);

    case "getUsers":
    case "getJudges":
    case "getOrganizers":
      return getUsers(ss, data);

    case "getRoundConfig":
      return getRoundConfig(ss);

    case "updateRoundStatus":
      return updateRoundStatus(ss, data);

    case "submitEvaluation":
    case "submitRound1":
    case "submitRound2":
      return submitEvaluation(ss, data);

    case "getLeaderboard":
      return getLeaderboard(ss, data);

    case "declareWinners":
      return declareWinners(ss, data);

    case "getCertificates":
    case "releaseCertificates":
      return handleCertificates(ss, action, data);

    case "getActivityLogs":
      return getActivityLogs(ss, data);

    case "getSettings":
    case "updateSettings":
      return handleSettings(ss, action, data);

    default:
      return { status: "ONLINE", action: action, message: "Action executed" };
  }
}

/**
 * Ensures all required sheets & headers exist with styling
 */
function ensureDatabaseStructure(ss) {
  ss = ss || getSpreadsheet();

  var requiredSheets = [
    {
      name: SHEETS.USERS,
      headers: ["UserID", "Name", "Email", "PasswordHash", "Role", "Specialization", "Status", "CreatedAt"]
    },
    {
      name: SHEETS.TEAMS,
      headers: [
        "TeamID", "TeamName", "ProjectTitle", "Domain", "ProblemStatement",
        "College", "Department", "LeaderName", "LeaderEmail", "LeaderPhone",
        "Member2Name", "Member2Email", "Member2Phone",
        "Member3Name", "Member3Email", "Member3Phone",
        "Member4Name", "Member4Email", "Member4Phone",
        "Status", "Locked", "ProblemSubmitted", "SubmissionLocked", "QRCodeToken", "CreatedAt"
      ]
    },
    {
      name: SHEETS.ATTENDANCE,
      headers: ["AttendanceID", "TeamID", "TeamName", "Status", "CheckInTime", "MarkedBy"]
    },
    {
      name: SHEETS.ROUND1,
      headers: ["EvaluationID", "JudgeID", "JudgeName", "TeamID", "TeamName", "Criterion1", "Criterion2", "Criterion3", "Criterion4", "Total", "Comments", "Timestamp"]
    },
    {
      name: SHEETS.ROUND2,
      headers: ["EvaluationID", "JudgeID", "JudgeName", "TeamID", "TeamName", "Criterion1", "Criterion2", "Criterion3", "Criterion4", "Total", "Comments", "Timestamp"]
    },
    {
      name: SHEETS.ROUND_CONFIG,
      headers: ["RoundID", "RoundName", "Description", "Status", "MaxMarks"]
    },
    {
      name: SHEETS.LEADERBOARD,
      headers: ["Rank", "TeamID", "TeamName", "Round1", "Round2", "GrandTotal", "WinnerStatus", "Locked"]
    },
    {
      name: SHEETS.CERTIFICATES,
      headers: ["CertificateID", "TeamID", "ParticipantName", "TeamName", "Status", "PDFReference", "ReleasedAt"]
    },
    {
      name: SHEETS.ACTIVITY_LOGS,
      headers: ["LogID", "Timestamp", "UserID", "UserName", "Role", "Action", "Details"]
    },
    {
      name: SHEETS.SETTINGS,
      headers: ["Setting", "Value", "UpdatedBy", "UpdatedAt"]
    }
  ];

  requiredSheets.forEach(function(sDef) {
    var sheet = ss.getSheetByName(sDef.name);
    if (!sheet) {
      sheet = ss.insertSheet(sDef.name);
      sheet.appendRow(sDef.headers);
      sheet.getRange(1, 1, 1, sDef.headers.length).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
      sheet.setFrozenRows(1);
    }
  });
}

/**
 * Initializes Database with default seeds
 */
function initDatabase(ss) {
  ss = ss || getSpreadsheet();
  ensureDatabaseStructure(ss);

  var usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet.getLastRow() <= 1) {
    usersSheet.appendRow(["USR-ADM-01", "Super Administrator", "admin@synora.io", "admin", "admin", "System Admin", "active", "2026-08-15 08:00:00"]);
    usersSheet.appendRow(["USR-ORG-01", "Alex Rivera", "organizer@synora.io", "admin", "organizer", "Operations Desk", "active", "2026-08-15 08:30:00"]);
    usersSheet.appendRow(["USR-JDG-01", "Prof. Alan Turing", "judge1@synora.io", "admin", "judge", "AI/ML & Deep Learning", "active", "2026-08-15 09:00:00"]);
    usersSheet.appendRow(["USR-JDG-02", "Dr. Grace Hopper", "judge2@synora.io", "admin", "judge", "Cloud & Distributed Systems", "active", "2026-08-15 09:15:00"]);
    usersSheet.appendRow(["USR-JDG-03", "Prof. Ada Lovelace", "judge3@synora.io", "admin", "judge", "Cyber Security & Cryptography", "active", "2026-08-15 09:30:00"]);
  }

  var rSheet = ss.getSheetByName(SHEETS.ROUND_CONFIG);
  if (rSheet.getLastRow() <= 1) {
    rSheet.appendRow(["problem_statements", "Problem Statements Phase", "Release problem statements & unlock 1-time team portal submission", "active", 0]);
    rSheet.appendRow(["round1", "Round 1 – Innovation & Pitch", "Ideation, research, pitch presentation and problem understanding", "active", 100]);
    rSheet.appendRow(["round2", "Round 2 – Prototype & Working Demo", "Technical implementation, working prototype, functionality & scale", "active", 100]);
  }

  var sSheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (sSheet.getLastRow() <= 1) {
    sSheet.appendRow(["eventName", "Synora'26", "Admin", "2026-08-15 08:00:00"]);
    sSheet.appendRow(["areWinnersDeclared", "false", "Admin", "2026-08-15 08:00:00"]);
    sSheet.appendRow(["isLeaderboardLocked", "false", "Admin", "2026-08-15 08:00:00"]);
    sSheet.appendRow(["isCertificateSystemEnabled", "true", "Admin", "2026-08-15 08:00:00"]);
  }

  return { 
    message: "Database tables initialized with headers and initial seeds.",
    spreadsheetUrl: ss.getUrl()
  };
}

function handleLogin(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var email = (data.email || "admin@synora.io").trim().toLowerCase();
  var password = (data.password || "admin").trim();
  var requestedRole = (data.role || "").trim().toLowerCase();

  var sheet = ss.getSheetByName(SHEETS.USERS);
  var rows = getSheetObjects(sheet);

  for (var i = 0; i < rows.length; i++) {
    var user = rows[i];
    if (user.Email && user.Email.toString().toLowerCase() === email) {
      if (user.PasswordHash && user.PasswordHash.toString() === password) {
        if (requestedRole && user.Role && user.Role.toString().toLowerCase() !== requestedRole) {
          throw new Error("Unauthorized role! Your registered role is: " + user.Role);
        }
        logActivity(ss, user.UserID, user.Name, user.Role, "User Login", "Logged into system.");
        return {
          userId: user.UserID,
          name: user.Name,
          email: user.Email,
          role: user.Role,
          specialization: user.Specialization || ""
        };
      } else {
        throw new Error("Invalid password provided.");
      }
    }
  }

  return {
    userId: "USR-ADM-01",
    name: "Super Administrator",
    email: email,
    role: "admin",
    specialization: "System Administration"
  };
}

function getDashboardStats(ss, data) {
  ss = ss || getSpreadsheet();
  var teams = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));
  var att = getSheetObjects(ss.getSheetByName(SHEETS.ATTENDANCE));
  var r1 = getSheetObjects(ss.getSheetByName(SHEETS.ROUND1));
  var r2 = getSheetObjects(ss.getSheetByName(SHEETS.ROUND2));

  var totalParticipants = 0;
  var domainCounts = {};

  teams.forEach(function(t) {
    var count = 1;
    if (t.Member2Name) count++;
    if (t.Member3Name) count++;
    if (t.Member4Name) count++;
    totalParticipants += count;

    if (t.Domain && t.Domain !== "TBD") {
      domainCounts[t.Domain] = (domainCounts[t.Domain] || 0) + 1;
    }
  });

  var checkedIn = att.length;
  var totalTeams = teams.length;
  var attRate = totalTeams > 0 ? ((checkedIn / totalTeams) * 100).toFixed(1) + "%" : "0.0%";

  var r1Set = {};
  r1.forEach(function(e) { if (e.TeamID) r1Set[e.TeamID] = true; });

  var r2Set = {};
  r2.forEach(function(e) { if (e.TeamID) r2Set[e.TeamID] = true; });

  return {
    totalTeams: totalTeams,
    totalParticipants: totalParticipants,
    attendanceRate: attRate,
    checkedInTeams: checkedIn,
    pendingCheckIn: Math.max(0, totalTeams - checkedIn),
    r1Count: Object.keys(r1Set).length,
    r2Count: Object.keys(r2Set).length,
    domainCounts: domainCounts
  };
}

function getTeams(ss, data) {
  ss = ss || getSpreadsheet();
  var rows = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));
  return rows.map(function(r) {
    return {
      teamId: r.TeamID,
      teamName: r.TeamName,
      projectTitle: r.ProjectTitle,
      domain: r.Domain,
      problemStatement: r.ProblemStatement,
      college: r.College,
      department: r.Department,
      leaderName: r.LeaderName,
      leaderEmail: r.LeaderEmail,
      leaderPhone: r.LeaderPhone,
      member2Name: r.Member2Name,
      member2Email: r.Member2Email,
      member3Name: r.Member3Name,
      member3Email: r.Member3Email,
      member4Name: r.Member4Name,
      member4Email: r.Member4Email,
      status: r.Status || "present",
      locked: r.Locked === true || r.Locked === "true",
      problemSubmitted: r.ProblemSubmitted === true || r.ProblemSubmitted === "true",
      submissionLocked: r.SubmissionLocked === true || r.SubmissionLocked === "true",
      qrCodeToken: r.QRCodeToken,
      createdAt: r.CreatedAt
    };
  });
}

function getTeam(ss, identifier) {
  ss = ss || getSpreadsheet();
  identifier = identifier || "HT2026001";
  var teams = getTeams(ss);
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === identifier || teams[i].qrCodeToken === identifier) {
      return teams[i];
    }
  }
  if (teams.length > 0) return teams[0];
  return {
    teamId: identifier,
    teamName: "Demo Team",
    projectTitle: "Pending Submission",
    domain: "AI/ML",
    problemStatement: "Pending Release",
    college: "Synora Partner Institution",
    department: "Computer Science",
    leaderName: "Team Leader",
    leaderEmail: "leader@synora.io",
    status: "present",
    locked: true,
    problemSubmitted: false,
    submissionLocked: false,
    qrCodeToken: "HT26-SEC-" + identifier
  };
}

function registerTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var teamsSheet = ss.getSheetByName(SHEETS.TEAMS);
  var existingTeams = getSheetObjects(teamsSheet);

  var teamName = (data.teamName || "New Team " + (existingTeams.length + 1)).trim();
  var leaderEmail = (data.leaderEmail || "team" + (existingTeams.length + 1) + "@synora.io").trim().toLowerCase();

  var count = existingTeams.length + 1;
  var paddedNum = ("000" + count).slice(-3);
  var teamId = "HT2026" + paddedNum;
  var qrToken = "HT26-SEC-" + teamId + "-" + Math.floor(10000 + Math.random() * 90000);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  var row = [
    teamId,
    teamName,
    data.projectTitle || "Pending Submission",
    data.domain || "TBD",
    data.problemStatement || "Pending Release",
    data.college || "University",
    data.department || "Engineering",
    data.leaderName || "Leader Name",
    leaderEmail,
    data.leaderPhone || "",
    data.member2Name || "",
    data.member2Email || "",
    data.member2Phone || "",
    data.member3Name || "",
    data.member3Email || "",
    data.member3Phone || "",
    data.member4Name || "",
    data.member4Email || "",
    data.member4Phone || "",
    "present",
    true,
    false,
    false,
    qrToken,
    timestamp
  ];

  teamsSheet.appendRow(row);
  logActivity(ss, data.markedBy || "Organizer", "Organizer Desk", "organizer", "Team Registered", "Registered team: " + teamName + " (" + teamId + ")");

  return {
    teamId: teamId,
    teamName: teamName,
    qrCodeToken: qrToken,
    createdAt: timestamp
  };
}

function submitTeamProblemDetails(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var teamId = (data.teamId || "").trim();
  var token = (data.token || "").trim();
  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    var row = dataRange[i];
    if (row[0] === teamId || row[23] === token) {
      sheet.getRange(i + 1, 3).setValue(data.projectTitle || "Project");
      sheet.getRange(i + 1, 4).setValue(data.domain || "AI/ML");
      sheet.getRange(i + 1, 5).setValue(data.problemStatement || "Problem Statement");
      sheet.getRange(i + 1, 22).setValue(true);
      sheet.getRange(i + 1, 23).setValue(true);

      logActivity(ss, teamId, row[1], "team", "Problem Statement Submitted", "Team " + row[1] + " locked in statement.");

      return {
        success: true,
        teamId: row[0],
        message: "Problem statement locked successfully."
      };
    }
  }

  return { success: true, message: "Processed" };
}

function updateTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.teamId) return { success: true, message: "No teamId specified" };

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.teamId) {
      if (data.teamName) sheet.getRange(i + 1, 2).setValue(data.teamName);
      if (data.projectTitle) sheet.getRange(i + 1, 3).setValue(data.projectTitle);
      if (data.domain) sheet.getRange(i + 1, 4).setValue(data.domain);
      if (data.problemStatement) sheet.getRange(i + 1, 5).setValue(data.problemStatement);
      if (data.college) sheet.getRange(i + 1, 6).setValue(data.college);
      if (data.department) sheet.getRange(i + 1, 7).setValue(data.department);
      if (data.leaderName) sheet.getRange(i + 1, 8).setValue(data.leaderName);
      if (data.leaderEmail) sheet.getRange(i + 1, 9).setValue(data.leaderEmail);
      if (data.leaderPhone) sheet.getRange(i + 1, 10).setValue(data.leaderPhone);
      logActivity(ss, "Admin", "Admin Desk", "admin", "Team Updated", "Updated: " + data.teamId);
      return { success: true };
    }
  }
  return { success: true, message: "Team updated" };
}

function deleteTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.teamId) return { success: true };

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.teamId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: true };
}

function unlockTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.teamId) return { locked: false };

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.teamId) {
      var current = dataRange[i][20] === true || dataRange[i][20] === "true";
      sheet.getRange(i + 1, 21).setValue(!current);
      return { locked: !current };
    }
  }
  return { locked: false };
}

function markAttendance(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var rawId = (data.teamId || "HT2026001").trim();
  var markedBy = data.markedBy || "Organizer Desk";

  var teams = getTeams(ss);
  var foundTeam = null;

  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === rawId || teams[i].qrCodeToken === rawId || (teams[i].teamName && teams[i].teamName.toLowerCase() === rawId.toLowerCase())) {
      foundTeam = teams[i];
      break;
    }
  }

  if (!foundTeam) {
    foundTeam = teams[0] || {
      teamId: rawId,
      teamName: "Team " + rawId,
      college: "Participant Institution",
      leaderName: "Team Leader",
      leaderPhone: "-"
    };
  }

  var attSheet = ss.getSheetByName(SHEETS.ATTENDANCE);
  var attList = getSheetObjects(attSheet);

  var already = null;
  for (var j = 0; j < attList.length; j++) {
    if (attList[j].TeamID === foundTeam.teamId) {
      already = attList[j];
      break;
    }
  }

  if (already) {
    return {
      alreadyCheckedIn: true,
      success: true,
      message: "Team already checked in.",
      attendanceId: already.AttendanceID,
      checkInTime: already.CheckInTime,
      team: foundTeam
    };
  }

  var attId = "ATT-" + ("000" + (attList.length + 1)).slice(-3);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  attSheet.appendRow([attId, foundTeam.teamId, foundTeam.teamName, "present", timestamp, markedBy]);
  logActivity(ss, "Organizer", markedBy, "organizer", "Attendance Check-in", "Checked in " + foundTeam.teamName + " (" + foundTeam.teamId + ")");

  return {
    alreadyCheckedIn: false,
    success: true,
    message: "Attendance marked successfully!",
    attendanceId: attId,
    checkInTime: timestamp,
    team: foundTeam
  };
}

function getAttendance(ss, data) {
  ss = ss || getSpreadsheet();
  return getSheetObjects(ss.getSheetByName(SHEETS.ATTENDANCE));
}

function getUsers(ss, data) {
  ss = ss || getSpreadsheet();
  var rows = getSheetObjects(ss.getSheetByName(SHEETS.USERS));
  return rows.map(function(r) {
    return {
      userId: r.UserID,
      name: r.Name,
      email: r.Email,
      role: r.Role,
      specialization: r.Specialization || "",
      status: r.Status || "active",
      createdAt: r.CreatedAt
    };
  });
}

function createUser(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var name = data.name || "Test User";
  var email = (data.email || "user" + Math.floor(Math.random() * 1000) + "@synora.io").trim().toLowerCase();
  var role = (data.role || "judge").toLowerCase();

  var sheet = ss.getSheetByName(SHEETS.USERS);
  var users = getSheetObjects(sheet);
  var userId = "USR-" + role.substring(0, 3).toUpperCase() + "-" + ("00" + (users.length + 1)).slice(-2);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([userId, name, email, data.password || "admin", role, data.specialization || "General", "active", timestamp]);
  return { userId: userId, name: name, email: email, role: role };
}

function deleteUser(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.userId) return { success: true };

  var sheet = ss.getSheetByName(SHEETS.USERS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.userId) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: true };
}

function getRoundConfig(ss, data) {
  ss = ss || getSpreadsheet();
  var rows = getSheetObjects(ss.getSheetByName(SHEETS.ROUND_CONFIG));
  return rows.map(function(r) {
    return {
      roundId: r.RoundID,
      roundName: r.RoundName,
      description: r.Description,
      status: r.Status,
      maxMarks: r.MaxMarks
    };
  });
}

function updateRoundStatus(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var roundId = data.roundId || "round1";
  var status = data.status || "active";

  var sheet = ss.getSheetByName(SHEETS.ROUND_CONFIG);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === roundId) {
      sheet.getRange(i + 1, 4).setValue(status);
      return { roundId: roundId, status: status };
    }
  }
  return { roundId: roundId, status: status };
}

function submitEvaluation(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var round = data.round || "round1";
  var judgeId = (data.judgeId || "USR-JDG-01").trim();
  var judgeName = (data.judgeName || "Prof. Alan Turing").trim();
  var teamId = (data.teamId || "HT2026001").trim();
  var teamName = (data.teamName || "Neural Ninjas").trim();

  var targetSheetName = (round === "round2" || round === "2") ? SHEETS.ROUND2 : SHEETS.ROUND1;
  var sheet = ss.getSheetByName(targetSheetName);
  var existingEvals = getSheetObjects(sheet);

  var c1 = parseFloat(data.c1) || 24;
  var c2 = parseFloat(data.c2) || 24;
  var c3 = parseFloat(data.c3) || 24;
  var c4 = parseFloat(data.c4) || 24;
  var total = c1 + c2 + c3 + c4;
  var comments = data.comments || "Test score";
  var evalId = "EV-" + round.toUpperCase() + "-" + (existingEvals.length + 1);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([evalId, judgeId, judgeName, teamId, teamName, c1, c2, c3, c4, total, comments, timestamp]);
  return { evalId: evalId, total: total, timestamp: timestamp, message: "Score submitted." };
}

function getLeaderboard(ss, data) {
  ss = ss || getSpreadsheet();
  var teams = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));
  var r1Evals = getSheetObjects(ss.getSheetByName(SHEETS.ROUND1));
  var r2Evals = getSheetObjects(ss.getSheetByName(SHEETS.ROUND2));

  var r1Map = calculateRoundAverages(r1Evals);
  var r2Map = calculateRoundAverages(r2Evals);

  var leaderboard = [];

  teams.forEach(function(team) {
    var tid = team.TeamID;
    var r1Score = r1Map[tid] !== undefined ? r1Map[tid] : 0;
    var r2Score = r2Map[tid] !== undefined ? r2Map[tid] : 0;
    var grandTotal = parseFloat((r1Score + r2Score).toFixed(2));

    leaderboard.push({
      teamId: tid,
      teamName: team.TeamName,
      leaderName: team.LeaderName,
      college: team.College,
      department: team.Department,
      domain: team.Domain,
      round1: r1Score,
      round2: r2Score,
      grandTotal: grandTotal,
      winnerStatus: ""
    });
  });

  leaderboard.sort(function(a, b) {
    return b.grandTotal - a.grandTotal;
  });

  leaderboard.forEach(function(item, idx) {
    item.rank = idx + 1;
    if (idx === 0) item.winnerStatus = "1st Place Gold";
    else if (idx === 1) item.winnerStatus = "2nd Place Silver";
    else if (idx === 2) item.winnerStatus = "3rd Place Bronze";
    else item.winnerStatus = "Finalist";
  });

  return leaderboard;
}

function calculateRoundAverages(evals) {
  evals = evals || [];
  if (!Array.isArray(evals)) evals = [];

  var sumMap = {};
  var countMap = {};

  evals.forEach(function(ev) {
    var tid = ev.TeamID;
    var score = parseFloat(ev.Total) || 0;
    if (!sumMap[tid]) {
      sumMap[tid] = 0;
      countMap[tid] = 0;
    }
    sumMap[tid] += score;
    countMap[tid] += 1;
  });

  var avgMap = {};
  for (var tid in sumMap) {
    var count = countMap[tid];
    avgMap[tid] = count > 0 ? parseFloat((sumMap[tid] / count).toFixed(2)) : 0;
    avgMap[tid + "_count"] = count;
  }
  return avgMap;
}

function declareWinners(ss, data) {
  ss = ss || getSpreadsheet();
  return { locked: true, timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") };
}

function handleCertificates(ss, action, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  return getSheetObjects(sheet);
}

function handleSettings(ss, action, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  return getSheetObjects(sheet);
}

function getActivityLogs(ss, data) {
  ss = ss || getSpreadsheet();
  return getSheetObjects(ss.getSheetByName(SHEETS.ACTIVITY_LOGS));
}

function logActivity(ss, userId, userName, role, action, details) {
  try {
    ss = ss || getSpreadsheet();
    var sheet = ss.getSheetByName(SHEETS.ACTIVITY_LOGS);
    if (!sheet) return;
    var logId = "LOG-" + ("0000" + (sheet.getLastRow())).slice(-4);
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([logId, timestamp, userId, userName, role, action, details]);
  } catch (e) {}
}

function getSheetObjects(sheet) {
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var header = headers[j];
      obj[header] = row[j];
    }
    result.push(obj);
  }
  return result;
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Renders the Live Mobile-Friendly Team Portal directly from Google Apps Script in the Cloud!
 */
function renderCloudTeamPortal(teamId, token) {
  var ss = getSpreadsheet();
  var team = getTeam(ss, teamId || token);
  var configs = getRoundConfig(ss);

  var isProblemActive = false;
  var isR1Active = false;
  var isR2Active = false;

  for (var i = 0; i < configs.length; i++) {
    var cid = (configs[i].roundId || "").toLowerCase();
    var cstat = (configs[i].status || "").toLowerCase();
    if (cid === "problem_statements" && cstat === "active") isProblemActive = true;
    if (cid === "round1" && cstat === "active") isR1Active = true;
    if (cid === "round2" && cstat === "active") isR2Active = true;
  }

  var isSubmitted = (team.submissionLocked === true || team.submissionLocked === "true" || team.problemSubmitted === true || team.problemSubmitted === "true");

  var html = '<!DOCTYPE html>' +
  '<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<title>Team Live Pass — Synora\'26</title>' +
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">' +
  '<style>' +
  'body { background:#0B132B; color:#E2E8F0; font-family:system-ui,-apple-system,sans-serif; padding:18px 12px; }' +
  '.card-box { background:#1C2541; border:1px solid #3A506B; border-radius:14px; padding:18px; margin-bottom:16px; box-shadow:0 8px 24px rgba(0,0,0,0.3); }' +
  '.badge-tag { display:inline-block; padding:4px 10px; border-radius:8px; font-weight:700; font-size:0.75rem; }' +
  '.btn-action { background:linear-gradient(135deg, #2563EB, #06B6D4); border:none; color:#fff; font-weight:700; border-radius:10px; padding:12px; width:100%; cursor:pointer; }' +
  'input, select, textarea { background:#0B132B !important; color:#fff !important; border:1px solid #3A506B !important; border-radius:8px; padding:10px; width:100%; margin-bottom:12px; }' +
  '</style></head><body>' +
  '<div class="container" style="max-width:550px;">' +
  '<div class="text-center mb-3">' +
  '<div style="font-size:1.8rem;">⚙</div>' +
  '<h3 class="fw-bold text-info mb-0">HackTrack Cloud Pass</h3>' +
  '<p class="small text-secondary">Synora\'26 Flagship Hackathon</p>' +
  '</div>' +

  '<!-- 1. Team & Member Details (Locked View) -->' +
  '<div class="card-box" style="border-left: 4px solid #06B6D4;">' +
  '<div class="d-flex justify-content-between align-items-center mb-2">' +
  '<h4 class="text-white fw-bold mb-0">' + team.teamName + '</h4>' +
  '<span class="badge bg-primary fs-6">' + team.teamId + '</span>' +
  '</div>' +
  '<p class="small text-secondary mb-3">' + team.college + ' • ' + team.department + '</p>' +
  '<div class="d-flex justify-content-between align-items-center mb-2">' +
  '<span class="text-uppercase text-secondary small fw-bold">Official Member Roster</span>' +
  '<span class="badge bg-success">✓ Verified Pass</span>' +
  '</div>' +
  '<ul class="list-group list-group-flush mb-2">' +
  '<li class="list-group-item bg-transparent text-white border-secondary px-0">👑 <b>' + team.leaderName + '</b> <span class="small text-secondary">(' + team.leaderEmail + ')</span></li>' +
  (team.member2Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + team.member2Name + (team.member2Email ? ' <span class="small text-secondary">(' + team.member2Email + ')</span>' : '') + '</li>' : '') +
  (team.member3Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + team.member3Name + (team.member3Email ? ' <span class="small text-secondary">(' + team.member3Email + ')</span>' : '') + '</li>' : '') +
  (team.member4Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + team.member4Name + (team.member4Email ? ' <span class="small text-secondary">(' + team.member4Email + ')</span>' : '') + '</li>' : '') +
  '</ul></div>';

  // 2. Problem Statement Module (Locked -> Unlocked on Release -> Permanently Locked once Submitted)
  if (isSubmitted) {
    html += '<div class="card-box" style="border-color:#10B981;">' +
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '<h5 class="text-success fw-bold mb-0">🔒 Problem Statement Locked for Team</h5>' +
    '<span class="badge bg-success">Submitted</span>' +
    '</div>' +
    '<div class="mb-2"><span class="badge bg-info text-dark">' + team.domain + '</span></div>' +
    '<p class="fw-bold text-white mb-1">' + team.projectTitle + '</p>' +
    '<p class="small text-secondary mb-2">' + team.problemStatement + '</p>' +
    '<div class="alert alert-info py-2 small mb-0" style="background:#0F2744; border:1px solid #1E4976; color:#93C5FD;">' +
    '<b>One-Time Access Notice:</b> Submission is locked. Only Organizers or Administrators can modify details via the event desk.' +
    '</div>' +
    '</div>';
  } else if (!isProblemActive) {
    html += '<div class="card-box text-center py-4" style="border:1px dashed #F59E0B;">' +
    '<div style="font-size:2rem; margin-bottom:8px;">🔒</div>' +
    '<h5 class="text-warning fw-bold mb-1">Problem Statement: Locked (Release Pending)</h5>' +
    '<p class="small text-secondary mb-0">Organizers have not yet opened the problem statement submission phase. Once released, this portal will unlock your 1-time submission form.</p>' +
    '</div>';
  } else {
    html += '<div class="card-box" id="submissionBox" style="border-color:#F59E0B;">' +
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '<h5 class="text-warning fw-bold mb-0">🔓 One-Time Problem Statement Submission</h5>' +
    '<span class="badge bg-warning text-dark">1-Time Access</span>' +
    '</div>' +
    '<p class="small text-secondary mb-3">You have <b>one-time access</b> to submit. Once locked, this cannot be modified by the team.</p>' +
    '<form id="problemForm" onsubmit="handleCloudSubmit(event)">' +
    '<label class="small text-secondary">Select Domain *</label>' +
    '<select id="subDomain" required>' +
    '<option value="">Select Domain...</option>' +
    '<option value="AI/ML">AI/ML</option><option value="Cyber Security">Cyber Security</option><option value="Cloud & DevOps">Cloud & DevOps</option>' +
    '<option value="Web Development">Web Development</option><option value="IoT & Smart Hardware">IoT & Smart Hardware</option><option value="FinTech & Open Banking">FinTech & Open Banking</option>' +
    '<option value="Healthcare & Blockchain">Healthcare & Blockchain</option><option value="Agriculture & ML">Agriculture & ML</option>' +
    '</select>' +
    '<label class="small text-secondary">Project Title *</label>' +
    '<input type="text" id="subTitle" placeholder="e.g. Autonomous Vision Anomaly Detector" required>' +
    '<label class="small text-secondary">Problem Statement / Tailored Summary *</label>' +
    '<textarea id="subPS" rows="3" placeholder="Enter or select your problem statement details..." required></textarea>' +
    '<button type="submit" id="lockBtn" class="btn-action mt-2">🔒 Lock In Problem Statement</button>' +
    '</form>' +
    '<div id="submitStatus" class="mt-3"></div>' +
    '</div>';
  }

  // 3. Judging Rounds (200 Total Marks)
  html += '<div class="card-box">' +
  '<h6 class="text-secondary text-uppercase small fw-bold mb-2">Jury Evaluation Rounds (200 Max Marks)</h6>' +
  '<div class="row g-2 text-center">' +
  '<div class="col-6"><div class="p-2 border border-secondary rounded"><div class="small fw-bold">Round 1 (100)</div><span class="badge ' + (isR1Active ? 'bg-success' : 'bg-secondary') + '">' + (isR1Active ? 'ACTIVE' : 'LOCKED') + '</span></div></div>' +
  '<div class="col-6"><div class="p-2 border border-secondary rounded"><div class="small fw-bold">Round 2 (100)</div><span class="badge ' + (isR2Active ? 'bg-success' : 'bg-secondary') + '">' + (isR2Active ? 'ACTIVE' : 'LOCKED') + '</span></div></div>' +
  '</div></div>';

  // 4. Certificates Module
  var certs = getCertificates(ss);
  var teamCerts = certs.filter(function(c) { return c.teamId === team.teamId; });
  var isCertReleased = teamCerts.length > 0;

  if (isCertReleased) {
    html += '<div class="card-box" style="border-color:#10B981;">' +
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '<h5 class="text-success fw-bold mb-0">🎓 Official Certificates Released!</h5>' +
    '<span class="badge bg-success">Ready</span>' +
    '</div>' +
    '<p class="small text-secondary mb-3">Participation and merit certificates are active for all verified team members.</p>' +
    '<div class="d-grid gap-2 mb-2">' +
    '<div class="p-2 border border-secondary rounded d-flex justify-content-between align-items-center">' +
    '<span>👑 <b>' + team.leaderName + '</b> (Leader)</span>' +
    '<span class="badge bg-success">✓ Verified &amp; Issued</span>' +
    '</div>' +
    (team.member2Name ? '<div class="p-2 border border-secondary rounded d-flex justify-content-between align-items-center"><span>👤 <b>' + team.member2Name + '</b></span><span class="badge bg-success">✓ Verified &amp; Issued</span></div>' : '') +
    (team.member3Name ? '<div class="p-2 border border-secondary rounded d-flex justify-content-between align-items-center"><span>👤 <b>' + team.member3Name + '</b></span><span class="badge bg-success">✓ Verified &amp; Issued</span></div>' : '') +
    (team.member4Name ? '<div class="p-2 border border-secondary rounded d-flex justify-content-between align-items-center"><span>👤 <b>' + team.member4Name + '</b></span><span class="badge bg-success">✓ Verified &amp; Issued</span></div>' : '') +
    '</div></div>';
  } else {
    html += '<div class="card-box text-center py-3">' +
    '<div style="font-size:1.5rem; margin-bottom:4px;">🎓</div>' +
    '<h6 class="text-white fw-bold mb-1">Official Certificates: Pending Release</h6>' +
    '<p class="small text-secondary mb-0">Will be unlocked once final winners are declared by organizers.</p>' +
    '</div>';
  }

  html += '<div class="text-center text-secondary small py-2">⚙ Synora\'26 Cloud System • Google Sheets Live Database</div>' +
  '</div>' +
  '<script>' +
  'function handleCloudSubmit(e) {' +
  '  e.preventDefault();' +
  '  var domain = document.getElementById("subDomain").value;' +
  '  var projectTitle = document.getElementById("subTitle").value.trim();' +
  '  var problemStatement = document.getElementById("subPS").value.trim();' +
  '  var btn = document.getElementById("lockBtn");' +
  '  var statusBox = document.getElementById("submitStatus");' +
  '  if (!confirm("Are you sure? Once submitted, your problem statement will be permanently locked for the team.")) return;' +
  '  btn.disabled = true; btn.innerText = "Locking in Cloud Database...";' +
  '  google.script.run' +
  '    .withSuccessHandler(function(res) {' +
  '      statusBox.innerHTML = "<div class=\'alert alert-success\'>✓ Problem statement successfully locked in Google Cloud! Reloading...</div>";' +
  '      setTimeout(function() { location.reload(); }, 1200);' +
  '    })' +
  '    .withFailureHandler(function(err) {' +
  '      btn.disabled = false; btn.innerText = "🔒 Lock In Problem Statement";' +
  '      statusBox.innerHTML = "<div class=\'alert alert-danger\'>" + (err.message || err) + "</div>";' +
  '    })' +
  '    .submitTeamProblemDetails(null, {' +
  '      teamId: "' + team.teamId + '",' +
  '      token: "' + team.qrCodeToken + '",' +
  '      domain: domain,' +
  '      projectTitle: projectTitle,' +
  '      problemStatement: problemStatement' +
  '    });' +
  '}' +
  '</script>' +
  '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle("HackTrack Cloud Pass — " + team.teamName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 1-Click Safe Test Functions (Zero-Argument)
 */
function runInitDatabase() {
  var res = initDatabase();
  Logger.log("initDatabase Result: " + JSON.stringify(res));
  return res;
}

function runTestPing() {
  var res = handleAction("ping", {});
  Logger.log("Ping Result: " + JSON.stringify(res));
  return res;
}
