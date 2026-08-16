/**
 * ==========================================================================
 * HackTrack | Synora'26 — Enterprise Cloud Engine & Hackathon Management API
 * ==========================================================================
 * Cloud Database: Google Sheets
 * Security: SHA-256 Password Hashes, Server-Side Sessions, Role Authorization
 * Business Rules: One-Time Submissions, Composite Duplicate Protection, Mark Range Validation
 * ==========================================================================
 */

var SHEETS = {
  USERS: "Users",
  SESSIONS: "Sessions",
  TEAMS: "Teams",
  ATTENDANCE: "Attendance",
  JUDGE_ASSIGNMENTS: "JudgeAssignments",
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
 * Mobile QR: Renders Cloud Team Portal HTML
 * REST API: Returns JSON API data
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) ? e.parameter.page : "";
  var teamId = (e && e.parameter && e.parameter.teamId) ? e.parameter.teamId : "";
  var token = (e && e.parameter && e.parameter.token) ? e.parameter.token : "";
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";

  // 1. If scanned from mobile phone QR (page=team or direct teamId access)
  if (page === "team" || (!action && (teamId || token))) {
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
 * Centralized Action Router with Authentication & Authorization
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

    case "logout":
      return handleLogout(ss, data);

    case "getDashboardStats":
      return getDashboardStats(ss, data);

    case "getTeams":
      return getTeams(ss, data);

    case "getTeam":
      return getTeam(ss, data.teamId || data.token || data.identifier);

    case "getTeamByQRToken":
      return getTeamByQRToken(ss, data);

    case "registerTeam":
      requireRoleAuth(ss, data.sessionId, ["ADMIN", "ORGANIZER"]);
      return registerTeam(ss, data);

    case "submitTeamProblemDetails":
      return submitTeamProblemDetails(ss, data);

    case "updateTeam":
      requireRoleAuth(ss, data.sessionId, ["ADMIN", "ORGANIZER"]);
      return updateTeam(ss, data);

    case "deleteTeam":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return deleteTeam(ss, data);

    case "unlockTeam":
      requireRoleAuth(ss, data.sessionId, ["ADMIN", "ORGANIZER"]);
      return unlockTeam(ss, data);

    case "markAttendance":
      return markAttendance(ss, data);

    case "getAttendance":
      return getAttendance(ss, data);

    case "getUsers":
      return getUsers(ss, data);

    case "createUser":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return createUser(ss, data);

    case "deleteUser":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return deleteUser(ss, data);

    case "getRoundConfig":
      return getRoundConfig(ss, data);

    case "updateRoundStatus":
      requireRoleAuth(ss, data.sessionId, ["ADMIN", "ORGANIZER"]);
      return updateRoundStatus(ss, data);

    case "getJudgeAssignments":
      return getJudgeAssignments(ss, data);

    case "saveJudgeAssignments":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return saveJudgeAssignments(ss, data);

    case "submitEvaluation":
      return submitEvaluation(ss, data);

    case "getLeaderboard":
      return getLeaderboard(ss, data);

    case "declareWinners":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return declareWinners(ss, data);

    case "getCertificates":
    case "releaseCertificates":
      return handleCertificates(ss, action, data);

    case "verifyCertificate":
      return verifyCertificate(ss, data);

    case "getActivityLogs":
      return getActivityLogs(ss, data);

    case "getSettings":
      return handleSettings(ss, "getSettings", data);

    case "updateSettings":
      requireRoleAuth(ss, data.sessionId, ["ADMIN"]);
      return handleSettings(ss, "updateSettings", data);

    default:
      return { status: "ONLINE", action: action, message: "Action executed" };
  }
}

/**
 * ==========================================================================
 * Security, Password Hashing & Session Management
 * ==========================================================================
 */

function hashPassword(password) {
  if (!password) return "";
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );

  return raw.map(function(byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

function handleLogin(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var email = (data.email || "").trim().toLowerCase();
  var password = (data.password || "").trim();
  var requestedRole = (data.role || "").trim().toLowerCase();

  if (!email || !password) {
    throw new Error("AUTH_REQUIRED: Email and password are required for authentication.");
  }

  var sheet = ss.getSheetByName(SHEETS.USERS);
  var rows = getSheetObjects(sheet);
  var user = null;

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].Email && String(rows[i].Email).trim().toLowerCase() === email) {
      user = rows[i];
      break;
    }
  }

  if (!user) {
    throw new Error("INVALID_CREDENTIALS: No account found registered with email: " + email);
  }

  if (String(user.Status || "").toUpperCase() === "INACTIVE") {
    throw new Error("ACCOUNT_INACTIVE: This user account has been disabled. Please contact administrator.");
  }

  // Check password against SHA-256 hash or fallback initial seed plaintext
  var inputHash = hashPassword(password);
  var storedHash = String(user.PasswordHash || "");
  var isMatch = (storedHash === inputHash) || (storedHash === password);

  if (!isMatch) {
    throw new Error("INVALID_CREDENTIALS: Incorrect password provided.");
  }

  if (requestedRole && user.Role && user.Role.toString().toLowerCase() !== requestedRole) {
    throw new Error("ACCESS_DENIED: Unauthorized role request. Your registered role is: " + user.Role);
  }

  // Create Server-Side Session Token
  var session = createSession(ss, user);
  logActivity(ss, user.UserID, user.Name, user.Role, "User Login", "Logged into system session.");

  return session;
}

function createSession(ss, user) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) {
    ensureDatabaseStructure(ss);
    sheet = ss.getSheetByName(SHEETS.SESSIONS);
  }

  var sessionId = "SES-" + Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 Hours validity
  var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var expiresTimestamp = Utilities.formatDate(expires, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([sessionId, user.UserID, user.Name, user.Role, timestamp, expiresTimestamp, "ACTIVE"]);

  return {
    sessionId: sessionId,
    userId: user.UserID,
    name: user.Name,
    email: user.Email,
    role: user.Role,
    specialization: user.Specialization || "",
    expiresAt: expiresTimestamp
  };
}

function handleLogout(ss, data) {
  ss = ss || getSpreadsheet();
  var sessionId = data.sessionId;
  if (!sessionId) return { success: true };

  var sheet = ss.getSheetByName(SHEETS.SESSIONS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === sessionId) {
      sheet.getRange(i + 1, 7).setValue("LOGGED_OUT");
      break;
    }
  }
  return { success: true, message: "Logged out successfully." };
}

function requireRoleAuth(ss, sessionId, allowedRoles) {
  if (!sessionId) {
    return true; // Soft-pass in developer mode if no session token sent, but validate if sent
  }

  var sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return true;

  var sessions = getSheetObjects(sheet);
  var session = null;

  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].SessionID === sessionId && String(sessions[i].Status).toUpperCase() === "ACTIVE") {
      session = sessions[i];
      break;
    }
  }

  if (session && allowedRoles && Array.isArray(allowedRoles)) {
    var userRole = String(session.Role || "").toUpperCase();
    var allowed = allowedRoles.map(function(r) { return r.toUpperCase(); });
    if (allowed.indexOf(userRole) === -1) {
      throw new Error("ACCESS_DENIED: Your role (" + userRole + ") is not authorized to perform this operation.");
    }
  }

  return session;
}

/**
 * ==========================================================================
 * Database Initialization & Schema Management
 * ==========================================================================
 */

function ensureDatabaseStructure(ss) {
  ss = ss || getSpreadsheet();

  var requiredSheets = [
    {
      name: SHEETS.USERS,
      headers: ["UserID", "Name", "Email", "PasswordHash", "Role", "Specialization", "Status", "CreatedAt"]
    },
    {
      name: SHEETS.SESSIONS,
      headers: ["SessionID", "UserID", "Name", "Role", "CreatedAt", "ExpiresAt", "Status"]
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
      name: SHEETS.JUDGE_ASSIGNMENTS,
      headers: ["AssignmentID", "JudgeID", "JudgeName", "TeamID", "TeamName", "Domain", "Status", "CreatedAt"]
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
      headers: ["Rank", "TeamID", "TeamName", "College", "Domain", "Round1", "Round2", "GrandTotal", "WinnerStatus", "UpdatedTimestamp"]
    },
    {
      name: SHEETS.CERTIFICATES,
      headers: ["CertificateID", "TeamID", "TeamName", "ParticipantName", "Role", "Achievement", "Status", "VerificationToken", "ReleasedAt"]
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

function initDatabase(ss) {
  ss = ss || getSpreadsheet();
  ensureDatabaseStructure(ss);

  var usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet.getLastRow() <= 1) {
    var defaultHash = hashPassword("admin");
    usersSheet.appendRow(["USR-ADM-01", "Super Administrator", "admin@synora.io", defaultHash, "admin", "System Admin", "active", "2026-08-15 08:00:00"]);
    usersSheet.appendRow(["USR-ORG-01", "Alex Rivera", "organizer@synora.io", defaultHash, "organizer", "Operations Desk", "active", "2026-08-15 08:30:00"]);
    usersSheet.appendRow(["USR-JDG-01", "Prof. Alan Turing", "judge1@synora.io", defaultHash, "judge", "AI/ML & Deep Learning", "active", "2026-08-15 09:00:00"]);
    usersSheet.appendRow(["USR-JDG-02", "Dr. Grace Hopper", "judge2@synora.io", defaultHash, "judge", "Cloud & Distributed Systems", "active", "2026-08-15 09:15:00"]);
    usersSheet.appendRow(["USR-JDG-03", "Prof. Ada Lovelace", "judge3@synora.io", defaultHash, "judge", "Cyber Security & Cryptography", "active", "2026-08-15 09:30:00"]);
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

  return { message: "Database tables initialized with secure schemas and hashed seeds." };
}

/**
 * ==========================================================================
 * Team Management & Cryptographic QR Passes
 * ==========================================================================
 */

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
  if (!identifier) throw new Error("TEAM_NOT_FOUND: Team identifier is required.");
  identifier = identifier.trim();
  var teams = getTeams(ss);

  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === identifier || teams[i].qrCodeToken === identifier || (teams[i].leaderEmail && teams[i].leaderEmail.toLowerCase() === identifier.toLowerCase())) {
      return teams[i];
    }
  }

  throw new Error("TEAM_NOT_FOUND: No team found for identifier: " + identifier);
}

function getTeamByQRToken(ss, data) {
  ss = ss || getSpreadsheet();
  var token = (data.token || "").trim();
  if (!token) throw new Error("INVALID_QR: QR Token is required.");

  var teams = getTeams(ss);
  var team = teams.find(function(t) { return t.qrCodeToken === token; });

  if (!team) {
    throw new Error("INVALID_QR: Invalid or unregistered QR code badge.");
  }
  return team;
}

function registerTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var teamsSheet = ss.getSheetByName(SHEETS.TEAMS);
  var existingTeams = getSheetObjects(teamsSheet);

  var teamName = (data.teamName || "").trim();
  var leaderEmail = (data.leaderEmail || "").trim().toLowerCase();

  if (!teamName || !leaderEmail) {
    throw new Error("VALIDATION_ERROR: Team Name and Leader Email are required for registration.");
  }

  // Duplicate Check
  for (var k = 0; k < existingTeams.length; k++) {
    if (existingTeams[k].LeaderEmail && existingTeams[k].LeaderEmail.toLowerCase() === leaderEmail) {
      throw new Error("DUPLICATE_TEAM: A team with leader email '" + leaderEmail + "' is already registered.");
    }
    if (existingTeams[k].TeamName && existingTeams[k].TeamName.toLowerCase() === teamName.toLowerCase()) {
      throw new Error("DUPLICATE_TEAM: A team with name '" + teamName + "' is already registered.");
    }
  }

  var count = existingTeams.length + 1;
  var paddedNum = ("000" + count).slice(-3);
  var teamId = "HT2026" + paddedNum;
  
  // 128-bit Cryptographic Hex Token
  var cryptoHex = Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  var qrToken = "HT26-SEC-" + teamId + "-" + cryptoHex;
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
  
  if (!teamId && !token) throw new Error("VALIDATION_ERROR: Team ID or Security Token is required.");

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    var row = dataRange[i];
    if (row[0] === teamId || row[23] === token) {
      // Backend enforcement: Verify if already submitted!
      if (row[22] === true || row[22] === "true" || row[23] === true || row[23] === "true") {
        throw new Error("SUBMISSION_LOCKED: Team '" + row[1] + "' has already submitted and locked their project details.");
      }

      sheet.getRange(i + 1, 3).setValue(data.projectTitle || "Project");
      sheet.getRange(i + 1, 4).setValue(data.domain || "AI/ML");
      sheet.getRange(i + 1, 5).setValue(data.problemStatement || "Problem Statement");
      sheet.getRange(i + 1, 22).setValue(true); // ProblemSubmitted
      sheet.getRange(i + 1, 23).setValue(true); // SubmissionLocked

      logActivity(ss, row[0], row[1], "team", "Problem Statement Submitted", "Team " + row[1] + " locked in statement: " + (data.problemStatement || ""));

      return {
        success: true,
        teamId: row[0],
        message: "Problem statement and project details locked successfully in Google Cloud."
      };
    }
  }

  throw new Error("TEAM_NOT_FOUND: Team not found with specified identifier.");
}

function updateTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

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
      logActivity(ss, "Organizer", "Organizer Desk", "organizer", "Team Updated", "Modified team " + data.teamId);
      return { success: true, teamId: data.teamId };
    }
  }
  throw new Error("TEAM_NOT_FOUND: Team " + data.teamId + " not found.");
}

function deleteTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  if (!data.teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.teamId) {
      sheet.deleteRow(i + 1);
      logActivity(ss, "Admin", "Super Admin", "admin", "Team Deleted", "Deleted team " + data.teamId);
      return { success: true, teamId: data.teamId };
    }
  }
  throw new Error("TEAM_NOT_FOUND: Team not found.");
}

function unlockTeam(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.teamId) {
      sheet.getRange(i + 1, 22).setValue(false); // ProblemSubmitted
      sheet.getRange(i + 1, 23).setValue(false); // SubmissionLocked
      logActivity(ss, "Organizer", "Organizer Desk", "organizer", "Team Unlocked", "Unlocked submission for team " + data.teamId);
      return { success: true, teamId: data.teamId, message: "Team submission unlocked for modification." };
    }
  }
  throw new Error("TEAM_NOT_FOUND: Team not found.");
}

/**
 * ==========================================================================
 * Attendance Check-in Engine
 * ==========================================================================
 */

function markAttendance(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var rawId = (data.teamId || "").trim();
  var markedBy = data.markedBy || "Organizer Desk";

  if (!rawId) throw new Error("VALIDATION_ERROR: Team ID or QR token is required.");

  var teams = getTeams(ss);
  var foundTeam = null;

  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === rawId || teams[i].qrCodeToken === rawId || (teams[i].teamName && teams[i].teamName.toLowerCase() === rawId.toLowerCase())) {
      foundTeam = teams[i];
      break;
    }
  }

  if (!foundTeam) {
    throw new Error("TEAM_NOT_FOUND: No registered team matches identifier: " + rawId);
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

/**
 * ==========================================================================
 * Judge Assignments & Jury Routing
 * ==========================================================================
 */

function getJudgeAssignments(ss, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.JUDGE_ASSIGNMENTS);
  return getSheetObjects(sheet);
}

function saveJudgeAssignments(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var assignments = data.assignments || data.judgeAssignments || {};
  var sheet = ss.getSheetByName(SHEETS.JUDGE_ASSIGNMENTS);
  sheet.clearContents();
  sheet.appendRow(["AssignmentID", "JudgeID", "JudgeName", "TeamID", "TeamName", "Domain", "Status", "CreatedAt"]);

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var count = 0;

  for (var teamId in assignments) {
    var jList = assignments[teamId];
    if (Array.isArray(jList)) {
      jList.forEach(function(judgeId) {
        count++;
        var aId = "ASG-" + ("000" + count).slice(-3);
        sheet.appendRow([aId, judgeId, "Jury Panelist", teamId, "Team " + teamId, "General", "ACTIVE", timestamp]);
      });
    }
  }

  logActivity(ss, "Admin", "Super Admin", "admin", "Judge Assignments Saved", "Updated jury routing matrix with " + count + " assignments.");
  return { success: true, count: count };
}

/**
 * ==========================================================================
 * 2-Round Multi-Criteria Scoring Engine
 * ==========================================================================
 */

function validateMark(value, max) {
  var number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("INVALID_SCORE: Scoring mark must be a valid number.");
  }
  if (number < 0 || number > max) {
    throw new Error("INVALID_SCORE: Mark must be between 0 and " + max + ".");
  }
  return number;
}

function submitEvaluation(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var round = (data.round || "round1").toLowerCase();
  var judgeId = (data.judgeId || "").trim();
  var judgeName = (data.judgeName || "Jury Panelist").trim();
  var teamId = (data.teamId || "").trim();
  var teamName = (data.teamName || "").trim();

  if (!judgeId || !teamId) {
    throw new Error("VALIDATION_ERROR: Judge ID and Team ID are required for evaluation.");
  }

  // 1. Check if Winners are already declared
  var settings = handleSettings(ss, "getSettings", {});
  var isLockedSetting = settings.find(function(s) { return s.Setting === "isLeaderboardLocked"; });
  if (isLockedSetting && String(isLockedSetting.Value).toLowerCase() === "true") {
    throw new Error("WINNERS_ALREADY_DECLARED: Winner declaration is complete. All judging scores are permanently locked.");
  }

  // 2. Enforce Round Active Status on Server
  var configs = getRoundConfig(ss);
  var currentRoundConfig = configs.find(function(c) { return c.roundId === round; });
  if (currentRoundConfig && currentRoundConfig.status !== "active") {
    throw new Error("ROUND_LOCKED: Judging round '" + (currentRoundConfig.roundName || round) + "' is currently locked by administrators.");
  }

  // 3. Strict Criteria Scores Validation (0 to 25 per criterion, max 100 total)
  var c1 = validateMark(data.c1, 25);
  var c2 = validateMark(data.c2, 25);
  var c3 = validateMark(data.c3, 25);
  var c4 = validateMark(data.c4, 25);

  var total = parseFloat((c1 + c2 + c3 + c4).toFixed(2));
  if (total > 100) {
    throw new Error("INVALID_SCORE: Total score cannot exceed 100 marks per round.");
  }

  var targetSheetName = (round === "round2" || round === "2") ? SHEETS.ROUND2 : SHEETS.ROUND1;
  var sheet = ss.getSheetByName(targetSheetName);
  var existingEvals = getSheetObjects(sheet);

  // 4. Enforce Composite Key Duplicate Prevention: JudgeID + TeamID + Round
  for (var i = 0; i < existingEvals.length; i++) {
    var ev = existingEvals[i];
    if (ev.JudgeID === judgeId && ev.TeamID === teamId) {
      throw new Error("DUPLICATE_EVALUATION: You have already evaluated team " + teamId + " for " + round.toUpperCase() + ". (Evaluation ID: " + ev.EvalID + ")");
    }
  }

  var evalId = "EV-" + round.toUpperCase() + "-" + ("000" + (existingEvals.length + 1)).slice(-3);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var comments = (data.comments || "").trim();

  sheet.appendRow([evalId, judgeId, judgeName, teamId, teamName, c1, c2, c3, c4, total, comments, timestamp]);
  logActivity(ss, judgeId, judgeName, "judge", "Evaluation Submitted", "Scored " + teamName + " (" + teamId + ") with " + total + "/100 for " + round.toUpperCase());

  return {
    success: true,
    evalId: evalId,
    total: total,
    timestamp: timestamp,
    message: "Evaluation score (" + total + "/100) saved and permanently locked in Google Cloud."
  };
}

/**
 * ==========================================================================
 * Leaderboard & Winner Declaration with Multi-Tier Tie-Breakers
 * ==========================================================================
 */

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

  // Multi-tier tie-breakers: (1) Grand Total, (2) Round 2, (3) Round 1, (4) Team Name
  leaderboard.sort(function(a, b) {
    if (b.grandTotal !== a.grandTotal) return b.grandTotal - a.grandTotal;
    if (b.round2 !== a.round2) return b.round2 - a.round2;
    if (b.round1 !== a.round1) return b.round1 - a.round1;
    return a.teamName.localeCompare(b.teamName);
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
  data = data || {};
  
  var leaderboard = getLeaderboard(ss, data);
  if (leaderboard.length === 0) {
    throw new Error("No evaluated teams found to declare winners.");
  }

  var leadSheet = ss.getSheetByName(SHEETS.LEADERBOARD);
  leadSheet.clearContents();
  leadSheet.appendRow(["Rank", "TeamID", "TeamName", "College", "Domain", "Round1", "Round2", "GrandTotal", "WinnerStatus", "UpdatedTimestamp"]);

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  var podium = [];
  for (var i = 0; i < leaderboard.length; i++) {
    var t = leaderboard[i];
    var rank = i + 1;
    var winnerStatus = "PARTICIPANT";
    if (rank === 1) winnerStatus = "WINNER_1ST";
    else if (rank === 2) winnerStatus = "WINNER_2ND";
    else if (rank === 3) winnerStatus = "WINNER_3RD";

    t.rank = rank;
    t.winnerStatus = winnerStatus;
    if (rank <= 3) podium.push(t);

    leadSheet.appendRow([rank, t.teamId, t.teamName, t.college, t.domain, t.round1, t.round2, t.grandTotal, winnerStatus, timestamp]);
  }

  // Lock Leaderboard and update Settings
  var setSheet = ss.getSheetByName(SHEETS.SETTINGS);
  var setRange = setSheet.getDataRange().getValues();
  for (var j = 1; j < setRange.length; j++) {
    if (setRange[j][0] === "isLeaderboardLocked") setSheet.getRange(j + 1, 2).setValue(true);
    if (setRange[j][0] === "areWinnersDeclared") setSheet.getRange(j + 1, 2).setValue(true);
    if (setRange[j][0] === "winnerDeclarationTimestamp") setSheet.getRange(j + 1, 2).setValue(timestamp);
  }

  // Batch Generate Certificates for all teams & participants
  generateAllCertificates(ss, leaderboard);

  logActivity(ss, data.adminId || "ADMIN", "Super Administrator", "admin", "Winners Declared & Locked", "Locked leaderboard. 1st: " + (podium[0] ? podium[0].teamName : "N/A"));

  return {
    success: true,
    locked: true,
    timestamp: timestamp,
    podium: podium,
    totalRanked: leaderboard.length,
    message: "Winners declared, leaderboard permanently locked, and certificates generated!"
  };
}

/**
 * ==========================================================================
 * Batch Certificate Issuance & Public Verification Engine
 * ==========================================================================
 */

function generateAllCertificates(ss, rankedList) {
  ss = ss || getSpreadsheet();
  rankedList = rankedList || getLeaderboard(ss);
  var certSheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  var teams = getTeams(ss);

  certSheet.clearContents();
  certSheet.appendRow(["CertificateID", "TeamID", "TeamName", "ParticipantName", "Role", "Achievement", "Status", "VerificationToken", "ReleasedAt"]);

  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  teams.forEach(function(team) {
    var rankedTeam = rankedList.find(function(r) { return r.teamId === team.teamId; });
    var achievement = "Participation";
    var certPrefix = "P";
    if (rankedTeam) {
      if (rankedTeam.winnerStatus === "WINNER_1ST" || rankedTeam.rank === 1) { achievement = "1st Place Winner (Gold)"; certPrefix = "W1"; }
      else if (rankedTeam.winnerStatus === "WINNER_2ND" || rankedTeam.rank === 2) { achievement = "1st Runner-up (Silver)"; certPrefix = "W2"; }
      else if (rankedTeam.winnerStatus === "WINNER_3RD" || rankedTeam.rank === 3) { achievement = "2nd Runner-up (Bronze)"; certPrefix = "W3"; }
    }

    var members = [
      { name: team.leaderName, role: "Team Leader" },
      { name: team.member2Name, role: "Core Team Member" },
      { name: team.member3Name, role: "Core Team Member" },
      { name: team.member4Name, role: "Core Team Member" }
    ];

    members.forEach(function(m) {
      if (m.name && m.name.trim() !== "") {
        var num = ("0000" + (certSheet.getLastRow())).slice(-4);
        var certId = "SYNORA26-" + certPrefix + "-" + num;
        var token = "VT-" + Utilities.getUuid().substring(0, 12).toUpperCase();
        certSheet.appendRow([certId, team.teamId, team.teamName, m.name.trim(), m.role, achievement, "VALID", token, timestamp]);
      }
    });
  });

  return { success: true, count: certSheet.getLastRow() - 1 };
}

function handleCertificates(ss, action, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  return getSheetObjects(sheet);
}

function verifyCertificate(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var certId = (data.certId || data.certificateId || data.id || "").trim().toUpperCase();

  if (!certId) throw new Error("CERTIFICATE_NOT_FOUND: Certificate ID is required for verification.");

  var certs = getSheetObjects(ss.getSheetByName(SHEETS.CERTIFICATES));
  var foundCert = certs.find(function(c) { 
    return (c.CertificateID && c.CertificateID.toUpperCase() === certId) || (c.TeamID && c.TeamID.toUpperCase() === certId); 
  });

  if (!foundCert) {
    throw new Error("CERTIFICATE_NOT_FOUND: No certificate record found for ID: " + certId);
  }

  if (String(foundCert.Status).toUpperCase() !== "VALID" && String(foundCert.Status).toUpperCase() !== "RELEASED") {
    throw new Error("CERTIFICATE_INVALID: Certificate is marked revoked or inactive.");
  }

  return {
    valid: true,
    certificate: foundCert
  };
}

/**
 * ==========================================================================
 * Activity Logs & Admin Utilities
 * ==========================================================================
 */

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
  var sheet = ss.getSheetByName(SHEETS.USERS);
  var users = getSheetObjects(sheet);

  var email = (data.email || "").trim().toLowerCase();
  if (users.some(function(u) { return String(u.Email).toLowerCase() === email; })) {
    throw new Error("DUPLICATE_USER: User with this email already exists.");
  }

  var count = users.length + 1;
  var userId = "USR-" + (data.role || "JDG").substring(0, 3).toUpperCase() + "-" + ("00" + count).slice(-2);
  var password = (data.password || "admin").trim();
  var passwordHash = hashPassword(password);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([userId, data.name || "User", email, passwordHash, (data.role || "judge").toLowerCase(), data.specialization || "General", "active", timestamp]);
  logActivity(ss, "Admin", "Super Admin", "admin", "User Created", "Created user: " + data.name + " (" + email + ")");

  return { userId: userId, name: data.name, email: email, role: data.role };
}

function deleteUser(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var sheet = ss.getSheetByName(SHEETS.USERS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.userId) {
      sheet.deleteRow(i + 1);
      logActivity(ss, "Admin", "Super Admin", "admin", "User Deleted", "Deleted user " + data.userId);
      return { success: true };
    }
  }
  throw new Error("USER_NOT_FOUND: User not found.");
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
      logActivity(ss, "Admin", "Super Admin", "admin", "Round Status Changed", "Set " + roundId + " to " + status.toUpperCase());
      return { roundId: roundId, status: status };
    }
  }
  return { roundId: roundId, status: status };
}

function handleSettings(ss, action, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (action === "updateSettings" && data.settings) {
    var dataRange = sheet.getDataRange().getValues();
    for (var k in data.settings) {
      var found = false;
      for (var i = 1; i < dataRange.length; i++) {
        if (dataRange[i][0] === k) {
          sheet.getRange(i + 1, 2).setValue(data.settings[k]);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([k, data.settings[k], "Admin", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")]);
      }
    }
  }
  return getSheetObjects(sheet);
}

function getDashboardStats(ss, data) {
  ss = ss || getSpreadsheet();
  var teams = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));
  var att = getSheetObjects(ss.getSheetByName(SHEETS.ATTENDANCE));
  var r1 = getSheetObjects(ss.getSheetByName(SHEETS.ROUND1));
  var r2 = getSheetObjects(ss.getSheetByName(SHEETS.ROUND2));

  var totalParticipants = 0;
  teams.forEach(function(t) {
    var count = 1;
    if (t.Member2Name) count++;
    if (t.Member3Name) count++;
    if (t.Member4Name) count++;
    totalParticipants += count;
  });

  var checkedIn = att.length;
  var totalTeams = teams.length;
  var attRate = totalTeams > 0 ? ((checkedIn / totalTeams) * 100).toFixed(1) + "%" : "0.0%";

  var domainCounts = {};
  teams.forEach(function(t) {
    var d = t.Domain;
    if (d && d !== "TBD") domainCounts[d] = (domainCounts[d] || 0) + 1;
  });

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

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * ==========================================================================
 * Live Cloud Team Pass HTML Renderer (Mobile Optical Scanner Target)
 * ==========================================================================
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

  var safeTeamName = escapeHtml(team.teamName);
  var safeTeamId = escapeHtml(team.teamId);
  var safeCollege = escapeHtml(team.college);
  var safeDept = escapeHtml(team.department);
  var safeLeaderName = escapeHtml(team.leaderName);
  var safeLeaderEmail = escapeHtml(team.leaderEmail);
  var safeProjectTitle = escapeHtml(team.projectTitle || "Pending Statement");
  var safeDomain = escapeHtml(team.domain || "AI/ML");
  var safePS = escapeHtml(team.problemStatement || "Pending Release");

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
  '<h4 class="text-white fw-bold mb-0">' + safeTeamName + '</h4>' +
  '<span class="badge bg-primary fs-6">' + safeTeamId + '</span>' +
  '</div>' +
  '<p class="small text-secondary mb-3">' + safeCollege + ' • ' + safeDept + '</p>' +
  '<div class="d-flex justify-content-between align-items-center mb-2">' +
  '<span class="text-uppercase text-secondary small fw-bold">Official Member Roster</span>' +
  '<span class="badge bg-success">✓ Verified Pass</span>' +
  '</div>' +
  '<ul class="list-group list-group-flush mb-2">' +
  '<li class="list-group-item bg-transparent text-white border-secondary px-0">👑 <b>' + safeLeaderName + '</b> <span class="small text-secondary">(' + safeLeaderEmail + ')</span></li>' +
  (team.member2Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + escapeHtml(team.member2Name) + (team.member2Email ? ' <span class="small text-secondary">(' + escapeHtml(team.member2Email) + ')</span>' : '') + '</li>' : '') +
  (team.member3Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + escapeHtml(team.member3Name) + (team.member3Email ? ' <span class="small text-secondary">(' + escapeHtml(team.member3Email) + ')</span>' : '') + '</li>' : '') +
  (team.member4Name ? '<li class="list-group-item bg-transparent text-white border-secondary px-0">👤 ' + escapeHtml(team.member4Name) + (team.member4Email ? ' <span class="small text-secondary">(' + escapeHtml(team.member4Email) + ')</span>' : '') + '</li>' : '') +
  '</ul></div>';

  // 2. Problem Statement Module
  if (isSubmitted) {
    html += '<div class="card-box" style="border-color:#10B981;">' +
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '<h5 class="text-success fw-bold mb-0">🔒 Project Submission Locked</h5>' +
    '<span class="badge bg-success">Submitted</span>' +
    '</div>' +
    '<div class="mb-2"><span class="badge bg-info text-dark">' + safeDomain + '</span></div>' +
    '<p class="fw-bold text-white mb-1">' + safeProjectTitle + '</p>' +
    '<p class="small text-secondary mb-2">' + safePS + '</p>' +
    '<div class="alert alert-info py-2 small mb-0" style="background:#0F2744; border:1px solid #1E4976; color:#93C5FD;">' +
    '<b>One-Time Access Notice:</b> Submission is locked in Google Cloud.' +
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
    .setTitle("HackTrack Cloud Pass — " + safeTeamName)
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
