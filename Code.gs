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
  SETTINGS: "Settings",
  LOGIN_ATTEMPTS: "LoginAttempts",      // Rate limiting & progressive lockout
  SCORE_AUDIT: "ScoreAuditLog"          // Immutable judging audit trail
};

// Security constants
var SECURITY = {
  MAX_FAILED_ATTEMPTS: 5,          // Lock account after 5 failed attempts
  LOCKOUT_WINDOW_MINUTES: 15,      // Rolling window for failed attempt count
  LOCKOUT_DELAY_SECONDS: [0, 0, 2, 5, 10, 30], // Progressive delay per attempt count (index = attempt#)
  SESSION_HOURS_ADMIN: 8,          // Shorter session for admin accounts
  SESSION_HOURS_STANDARD: 24,      // Standard session for organizers and judges
  QR_EXPIRY_HOURS: 48              // QR badge tokens valid for 48h from event day
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
 * Centralized Action Router with Mandatory Authentication & Authorization
 * -----------------------------------------------------------------------
 * Every endpoint either explicitly allows public access or requires a
 * valid session + role. The auth() helper:
 *   1. Calls requireRoleAuth() which THROWS if sessionId is missing/invalid.
 *   2. Attaches the authenticated session to data._session so that
 *      downstream functions can derive identity from it.
 */
function handleAction(action, data, method) {
  action = action || "ping";
  data = data || {};
  method = method || "WEB";

  var ss = getSpreadsheet();
  ensureDatabaseStructure(ss);

  // Auth helper: authenticates, authorizes by role, attaches session to data
  function auth(roles) {
    var session = requireRoleAuth(ss, data.sessionId, roles);
    data._session = session;
    return session;
  }

  switch (action) {

    // ── PUBLIC: Health check ──
    case "ping":
      return {
        status: "ONLINE",
        app: "HackTrack Synora'26 Cloud API",
        timestamp: new Date().toISOString()
      };

    // ── PUBLIC: Login / Auth ──
    case "login":
      return handleLogin(ss, data);

    case "logout":
      return handleLogout(ss, data);

    case "changePassword":
      return changePassword(ss, data); // Has own internal session validation

    // ── BOOTSTRAP / MIGRATION: initDatabase ──
    case "initDatabase":
      return initDatabase(ss);

    // ── ADMIN ONLY ──
    case "getUsers":
      auth(["ADMIN"]);
      return getUsers(ss, data);

    case "createUser":
      auth(["ADMIN"]);
      return createUser(ss, data);

    case "deleteUser":
      auth(["ADMIN"]);
      return deleteUser(ss, data);

    case "saveJudgeAssignments":
      auth(["ADMIN"]);
      return saveJudgeAssignments(ss, data);

    case "declareWinners":
      auth(["ADMIN"]);
      return declareWinners(ss, data);

    case "getActivityLogs":
      auth(["ADMIN"]);
      return getActivityLogs(ss, data);

    case "getSettings":
      auth(["ADMIN"]);
      return handleSettings(ss, "getSettings", data);

    case "updateSettings":
      auth(["ADMIN"]);
      return handleSettings(ss, "updateSettings", data);

    // ── ADMIN + ORGANIZER ──
    case "getDashboardStats":
      auth(["ADMIN", "ORGANIZER"]);
      return getDashboardStats(ss, data);

    case "registerTeam":
      auth(["ADMIN", "ORGANIZER"]);
      return registerTeam(ss, data);

    case "submitTeamProblemDetails":
      auth(["ADMIN", "ORGANIZER"]);
      return submitTeamProblemDetails(ss, data);

    case "updateTeam":
      auth(["ADMIN", "ORGANIZER"]);
      return updateTeam(ss, data);

    case "deleteTeam":
      auth(["ADMIN"]);
      return deleteTeam(ss, data);

    case "unlockTeam":
      auth(["ADMIN", "ORGANIZER"]);
      return unlockTeam(ss, data);

    case "markAttendance":
      auth(["ADMIN", "ORGANIZER"]);
      return markAttendance(ss, data);

    case "getAttendance":
      auth(["ADMIN", "ORGANIZER"]);
      return getAttendance(ss, data);

    case "getTeamByQRToken":
      auth(["ADMIN", "ORGANIZER"]);
      return getTeamByQRToken(ss, data);

    case "updateRoundStatus":
      auth(["ADMIN", "ORGANIZER"]);
      return updateRoundStatus(ss, data);

    case "generateRotatingQR":
      auth(["ADMIN", "ORGANIZER"]);
      return generateRotatingQR(ss, data);

    case "getCertificates":
    case "releaseCertificates":
      auth(["ADMIN", "ORGANIZER"]);
      return handleCertificates(ss, action, data);

    // ── ADMIN + ORGANIZER + JUDGE ──
    case "getTeams":
      auth(["ADMIN", "ORGANIZER", "JUDGE"]);
      return getTeams(ss, data);

    case "getTeam":
      auth(["ADMIN", "ORGANIZER", "JUDGE"]);
      return getTeam(ss, data.teamId || data.token || data.identifier);

    case "getRoundConfig":
      auth(["ADMIN", "ORGANIZER", "JUDGE"]);
      return getRoundConfig(ss, data);

    case "getJudgeAssignments":
      auth(["ADMIN", "ORGANIZER", "JUDGE"]);
      return getJudgeAssignments(ss, data);

    // ── JUDGE ONLY ──
    case "submitEvaluation":
      auth(["JUDGE"]);
      return submitEvaluation(ss, data);

    // ── PUBLIC: Designed to be openly accessible ──
    case "getLeaderboard":
      return getLeaderboard(ss, data);

    case "verifyCertificate":
      return verifyCertificate(ss, data);

    case "verifyAndLoadTeamPortal":
      return verifyAndLoadTeamPortal(data.token || data.teamId, data.email);

    // ── UNKNOWN ACTION ──
    default:
      throw new Error("UNKNOWN_ACTION: Action '" + action + "' is not recognized.");
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

/**
 * Rate Limiting: check and record login attempts, enforce progressive lockout.
 * Uses LoginAttempts sheet keyed by email with rolling 15-minute window.
 */
function checkRateLimit(ss, email) {
  var sheet = ss.getSheetByName(SHEETS.LOGIN_ATTEMPTS);
  if (!sheet) return; // Skip if sheet not ready yet

  var now = new Date();
  var windowStart = new Date(now.getTime() - SECURITY.LOCKOUT_WINDOW_MINUTES * 60 * 1000);
  var rows = getSheetObjects(sheet);

  var recentFailures = rows.filter(function(r) {
    return String(r.Email).toLowerCase() === email &&
           String(r.Result) === "FAIL" &&
           new Date(r.Timestamp) >= windowStart;
  });

  var failCount = recentFailures.length;

  if (failCount >= SECURITY.MAX_FAILED_ATTEMPTS) {
    logActivity(ss, email, email, "system", "Account Lockout Triggered",
      failCount + " failed attempts within " + SECURITY.LOCKOUT_WINDOW_MINUTES + " minutes.");
    throw new Error(
      "RATE_LIMITED: Too many failed login attempts (" + failCount + " in " +
      SECURITY.LOCKOUT_WINDOW_MINUTES + " minutes). Please wait " +
      SECURITY.LOCKOUT_WINDOW_MINUTES + " minutes before trying again."
    );
  }

  // Progressive delay hint returned (client should honour, server enforces via count)
  return failCount;
}

function recordLoginAttempt(ss, email, result, reason) {
  var sheet = ss.getSheetByName(SHEETS.LOGIN_ATTEMPTS);
  if (!sheet) return;
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var logId = "ATT-" + Utilities.getUuid().substring(0, 8).toUpperCase();
  sheet.appendRow([logId, email, result, reason || "", timestamp]);
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

  // 1. Rate limiting check BEFORE hitting the user table
  checkRateLimit(ss, email);

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
    // Record failed attempt even for non-existent emails (prevent user enumeration timing)
    recordLoginAttempt(ss, email, "FAIL", "Email not registered");
    // Return same generic error — don't reveal whether email exists
    throw new Error("INVALID_CREDENTIALS: Incorrect email or password.");
  }

  if (String(user.Status || "").toUpperCase() === "INACTIVE") {
    recordLoginAttempt(ss, email, "FAIL", "Account inactive");
    throw new Error("ACCOUNT_INACTIVE: This user account has been disabled. Please contact administrator.");
  }

  // 2. Check password against SHA-256 hash
  var inputHash = hashPassword(password);
  var storedHash = String(user.PasswordHash || "");
  var isMatch = (storedHash === inputHash);

  // Self-healing migration: if user has legacy plaintext password, upgrade immediately
  if (!isMatch && storedHash === password && storedHash.length < 64) {
    isMatch = true;
    var userRows = sheet.getDataRange().getValues();
    for (var ur = 1; ur < userRows.length; ur++) {
      if (userRows[ur][0] === user.UserID) {
        sheet.getRange(ur + 1, 4).setValue(inputHash);
        Logger.log("Self-healed legacy password to SHA-256 for: " + user.Email);
        break;
      }
    }
  }

  if (!isMatch) {
    recordLoginAttempt(ss, email, "FAIL", "Wrong password");
    throw new Error("INVALID_CREDENTIALS: Incorrect email or password.");
  }

  if (requestedRole && user.Role && user.Role.toString().toLowerCase() !== requestedRole) {
    recordLoginAttempt(ss, email, "FAIL", "Role mismatch");
    throw new Error("ACCESS_DENIED: Unauthorized role request. Your registered role is: " + user.Role);
  }

  // 3. Successful login — record it and create session
  recordLoginAttempt(ss, email, "SUCCESS", "");
  var session = createSession(ss, user);
  logActivity(ss, user.UserID, user.Name, user.Role, "User Login",
    "Authenticated successfully from session " + session.sessionId.substring(0, 12) + "...");

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
  // Admin accounts get shorter 8-hour sessions for security
  var sessionHours = (String(user.Role).toLowerCase() === "admin")
    ? SECURITY.SESSION_HOURS_ADMIN
    : SECURITY.SESSION_HOURS_STANDARD;
  var expires = new Date(now.getTime() + sessionHours * 60 * 60 * 1000);
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
  if (!sessionId) {
    throw new Error("AUTH_REQUIRED: Session token is required for logout.");
  }

  var sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) return { success: true };

  var dataRange = sheet.getDataRange().getValues();
  var found = false;

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === sessionId) {
      // Only allow logout of ACTIVE sessions
      if (String(dataRange[i][6]).toUpperCase() === "ACTIVE") {
        sheet.getRange(i + 1, 7).setValue("LOGGED_OUT");
        logActivity(ss, dataRange[i][1], dataRange[i][2], dataRange[i][3], "User Logout", "Session terminated by user.");
      }
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error("AUTH_REQUIRED: Session not found or already terminated.");
  }

  return { success: true, message: "Logged out successfully." };
}

/**
 * HARD Authentication & Role Authorization.
 * This function ALWAYS throws if:
 *   - sessionId is missing
 *   - sessionId is invalid/logged out/expired
 *   - user role is not in allowedRoles
 * Returns the full session object (UserID, Name, Role) on success.
 */
function requireRoleAuth(ss, sessionId, allowedRoles) {
  // ── HARD FAIL: No session = no access ──
  if (!sessionId) {
    throw new Error("AUTH_REQUIRED: A valid session token is required. Please log in.");
  }

  var sheet = ss.getSheetByName(SHEETS.SESSIONS);
  if (!sheet) {
    throw new Error("AUTH_REQUIRED: Session infrastructure not initialized. Run initDatabase first.");
  }

  var sessions = getSheetObjects(sheet);
  var session = null;

  for (var i = 0; i < sessions.length; i++) {
    if (sessions[i].SessionID === sessionId && String(sessions[i].Status).toUpperCase() === "ACTIVE") {
      session = sessions[i];
      break;
    }
  }

  if (!session) {
    throw new Error("AUTH_REQUIRED: Session token is invalid, expired, or has been logged out.");
  }

  // ── Enforce session expiry ──
  if (session.ExpiresAt && new Date(session.ExpiresAt) < new Date()) {
    var dataRange = sheet.getDataRange().getValues();
    for (var j = 1; j < dataRange.length; j++) {
      if (dataRange[j][0] === sessionId) {
        sheet.getRange(j + 1, 7).setValue("EXPIRED");
        break;
      }
    }
    throw new Error("SESSION_EXPIRED: Your session has expired. Please log in again.");
  }

  // ── Enforce role authorization ──
  if (allowedRoles && Array.isArray(allowedRoles)) {
    var userRole = String(session.Role || "").toUpperCase();
    var allowed = allowedRoles.map(function(r) { return r.toUpperCase(); });
    if (allowed.indexOf(userRole) === -1) {
      throw new Error("ACCESS_DENIED: Your role (" + userRole + ") is not permitted to perform this operation. Required: " + allowed.join(" or ") + ".");
    }
  }

  return session;
}

/**
 * changePassword — enforced server-side, invalidates all other sessions.
 */
function changePassword(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var sessionId = data.sessionId;
  var newPassword = (data.newPassword || "").trim();
  var currentPassword = (data.currentPassword || "").trim();

  if (!newPassword || newPassword.length < 8) {
    throw new Error("VALIDATION_ERROR: New password must be at least 8 characters long.");
  }

  // Resolve user from session
  var sessSheet = ss.getSheetByName(SHEETS.SESSIONS);
  var sessions = getSheetObjects(sessSheet);
  var session = sessions.find(function(s) { return s.SessionID === sessionId && String(s.Status).toUpperCase() === "ACTIVE"; });
  if (!session) throw new Error("AUTH_REQUIRED: Valid session required to change password.");

  // Verify current password
  var usersSheet = ss.getSheetByName(SHEETS.USERS);
  var userRows = usersSheet.getDataRange().getValues();
  var userRowIndex = -1;
  var existingHash = "";

  for (var i = 1; i < userRows.length; i++) {
    if (userRows[i][0] === session.UserID) {
      existingHash = String(userRows[i][3]);
      userRowIndex = i + 1;
      break;
    }
  }

  if (userRowIndex === -1) throw new Error("USER_NOT_FOUND: User account not found.");

  var currentHash = hashPassword(currentPassword);
  if (currentHash !== existingHash) {
    throw new Error("INVALID_CREDENTIALS: Current password is incorrect.");
  }

  if (currentPassword === newPassword) {
    throw new Error("VALIDATION_ERROR: New password must be different from your current password.");
  }

  // Write new hash
  var newHash = hashPassword(newPassword);
  usersSheet.getRange(userRowIndex, 4).setValue(newHash);

  // Invalidate ALL other active sessions for this user (security: session invalidation after password change)
  var sessData = sessSheet.getDataRange().getValues();
  for (var j = 1; j < sessData.length; j++) {
    if (sessData[j][1] === session.UserID && sessData[j][0] !== sessionId && String(sessData[j][6]).toUpperCase() === "ACTIVE") {
      sessSheet.getRange(j + 1, 7).setValue("INVALIDATED_PWD_CHANGE");
    }
  }

  logActivity(ss, session.UserID, session.Name, session.Role, "Password Changed", "Password updated. All other sessions invalidated.");
  return { success: true, message: "Password changed successfully. All other active sessions have been terminated." };
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
      name: SHEETS.LOGIN_ATTEMPTS,
      headers: ["AttemptID", "Email", "Result", "Reason", "Timestamp"]
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
      headers: ["AttendanceID", "TeamID", "TeamName", "Status", "CheckInTime", "MarkedBy", "QRTokenUsed"]
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
      name: SHEETS.SCORE_AUDIT,
      headers: ["AuditID", "Round", "JudgeID", "JudgeName", "TeamID", "TeamName", "OldC1", "OldC2", "OldC3", "OldC4", "OldTotal", "NewC1", "NewC2", "NewC3", "NewC4", "NewTotal", "Reason", "ChangedBy", "Timestamp"]
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

  // Auto-migrate any legacy plaintext passwords to SHA-256 hashes
  var usersSheet = ss.getSheetByName(SHEETS.USERS);
  if (usersSheet && usersSheet.getLastRow() > 1) {
    var userData = usersSheet.getDataRange().getValues();
    for (var u = 1; u < userData.length; u++) {
      var stored = String(userData[u][3] || "");
      if (stored && (stored.length < 64 || !/^[0-9a-f]{64}$/i.test(stored))) {
        usersSheet.getRange(u + 1, 4).setValue(hashPassword(stored));
      }
    }
  }
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
  } else {
    // AUTO-MIGRATE: Convert any plaintext passwords to SHA-256 hashes
    // A SHA-256 hex hash is always exactly 64 hex characters. Anything shorter is plaintext.
    var userData = usersSheet.getDataRange().getValues();
    for (var u = 1; u < userData.length; u++) {
      var stored = String(userData[u][3] || "");
      if (stored && (stored.length < 64 || !/^[0-9a-f]{64}$/i.test(stored))) {
        usersSheet.getRange(u + 1, 4).setValue(hashPassword(stored));
        Logger.log("Migrated plaintext password for user: " + userData[u][0]);
      }
    }
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

  return { message: "Database tables initialized with secure schemas and hashed seeds. Plaintext passwords migrated." };
}


/**
 * ==========================================================================
 * Team Management & Cryptographic QR Passes
 * ==========================================================================
 */

function getTeams(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var rows = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));

  // Determine caller role for PII redaction
  var callerRole = (data._session && data._session.Role) ? String(data._session.Role).toUpperCase() : "";
  var isPrivileged = (callerRole === "ADMIN" || callerRole === "ORGANIZER");

  return rows.map(function(r) {
    var team = {
      teamId: r.TeamID,
      teamName: r.TeamName,
      projectTitle: r.ProjectTitle,
      domain: r.Domain,
      problemStatement: r.ProblemStatement,
      college: r.College,
      department: r.Department,
      leaderName: r.LeaderName,
      member2Name: r.Member2Name,
      member3Name: r.Member3Name,
      member4Name: r.Member4Name,
      status: r.Status || "present",
      locked: r.Locked === true || r.Locked === "true",
      problemSubmitted: r.ProblemSubmitted === true || r.ProblemSubmitted === "true",
      submissionLocked: r.SubmissionLocked === true || r.SubmissionLocked === "true",
      createdAt: r.CreatedAt
    };

    // Only ADMIN/ORGANIZER see PII (emails, phones, QR tokens)
    if (isPrivileged) {
      team.leaderEmail = r.LeaderEmail;
      team.leaderPhone = r.LeaderPhone;
      team.member2Email = r.Member2Email;
      team.member3Email = r.Member3Email;
      team.member4Email = r.Member4Email;
      team.qrCodeToken = r.QRCodeToken;
    }

    return team;
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
  logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Registered", "Registered team: " + teamName + " (" + teamId + ")");

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
      logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Updated", "Modified team " + data.teamId);
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
      logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Deleted", "Deleted team " + data.teamId);
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
      logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Unlocked", "Unlocked submission for team " + data.teamId);
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

  // Server-derived identity from authenticated session
  var session = data._session;
  var markedBy = session ? (session.Name + " (" + session.Role + ")") : "System";
  var usedQrToken = (data.qrToken || rawId).trim();

  if (!rawId) throw new Error("VALIDATION_ERROR: Team ID or QR token is required.");

  var teams = getTeams(ss);
  var foundTeam = null;

  for (var i = 0; i < teams.length; i++) {
    var t = teams[i];
    if (t.teamId === rawId || t.qrCodeToken === rawId || (t.teamName && t.teamName.toLowerCase() === rawId.toLowerCase())) {
      foundTeam = t;
      break;
    }
  }

  if (!foundTeam) {
    logActivity(ss, session ? session.UserID : "system", markedBy, "system", "QR Scan Rejected",
      "Unregistered QR/ID presented: " + rawId);
    throw new Error("INVALID_QR: Unregistered or invalid QR badge: " + rawId);
  }

  var attSheet = ss.getSheetByName(SHEETS.ATTENDANCE);
  var attList = getSheetObjects(attSheet);

  // REPLAY PROTECTION: Check if this exact QR token has already been used for check-in
  var tokenReplayed = attList.find(function(a) { return a.QRTokenUsed === usedQrToken; });
  if (tokenReplayed) {
    logActivity(ss, foundTeam.teamId, foundTeam.teamName, "system",
      "QR Replay Attack Detected", "Token already used at " + tokenReplayed.CheckInTime + ". Attempted by: " + markedBy);
    throw new Error(
      "QR_REPLAYED: This QR badge has already been used for check-in at " +
      tokenReplayed.CheckInTime + ". Please contact an organizer."
    );
  }

  // DUPLICATE CHECK: One check-in per team
  var already = attList.find(function(a) { return a.TeamID === foundTeam.teamId; });
  if (already) {
    return {
      alreadyCheckedIn: true,
      success: true,
      message: "Team " + foundTeam.teamName + " is already checked in.",
      attendanceId: already.AttendanceID,
      checkInTime: already.CheckInTime,
      team: foundTeam
    };
  }

  var attId = "ATT-" + ("000" + (attList.length + 1)).slice(-3);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  attSheet.appendRow([attId, foundTeam.teamId, foundTeam.teamName, "present", timestamp, markedBy, usedQrToken]);
  logActivity(ss, session ? session.UserID : "system", markedBy, session ? session.Role : "system", "Attendance Check-in",
    "Checked in " + foundTeam.teamName + " (" + foundTeam.teamId + ") at " + timestamp);

  return {
    alreadyCheckedIn: false,
    success: true,
    message: "✓ " + foundTeam.teamName + " checked in successfully!",
    attendanceId: attId,
    checkInTime: timestamp,
    team: foundTeam
  };
}

/**
 * generateRotatingQR — Admin/Organizer can issue a new QR token for a team
 * (e.g. after a lost badge). Old token is revoked by being replaced.
 */
function generateRotatingQR(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var teamId = (data.teamId || "").trim();
  if (!teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

  var sheet = ss.getSheetByName(SHEETS.TEAMS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === teamId) {
      var oldToken = dataRange[i][23];
      var newCryptoHex = Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
      var newToken = "HT26-ROT-" + teamId + "-" + newCryptoHex;
      sheet.getRange(i + 1, 24).setValue(newToken);

      logActivity(ss, teamId, dataRange[i][1], "system", "QR Token Rotated",
        "Old: " + oldToken + " → New: " + newToken);

      return {
        success: true,
        teamId: teamId,
        teamName: dataRange[i][1],
        newQRToken: newToken,
        message: "QR token rotated. Old badge is now invalid."
      };
    }
  }
  throw new Error("TEAM_NOT_FOUND: Team not found.");
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
  var session = data._session; // Server-derived identity
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

  logActivity(ss, session.UserID, session.Name, session.Role, "Judge Assignments Saved",
    "Updated jury routing matrix with " + count + " assignments.");
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
  var teamId = (data.teamId || "").trim();

  // SERVER-DERIVED IDENTITY: Judge identity comes from authenticated session, NEVER the client
  var session = data._session;
  if (!session) {
    throw new Error("AUTH_REQUIRED: Authenticated judge session is required to submit evaluations.");
  }
  var judgeId = session.UserID;
  var judgeName = session.Name;

  if (!teamId) {
    throw new Error("VALIDATION_ERROR: Team ID is required for evaluation.");
  }

  // JUDGE ASSIGNMENT ENFORCEMENT: verify judge is assigned to this team
  var assignments = getSheetObjects(ss.getSheetByName(SHEETS.JUDGE_ASSIGNMENTS));
  var isAssigned = assignments.some(function(a) {
    return a.JudgeID === judgeId && a.TeamID === teamId && String(a.Status).toUpperCase() === "ACTIVE";
  });
  if (!isAssigned) {
    logActivity(ss, judgeId, judgeName, "judge", "Unassigned Evaluation Attempt",
      "Judge " + judgeId + " attempted to score team " + teamId + " but is not assigned.");
    throw new Error("ACCESS_DENIED: You are not assigned to evaluate team " + teamId + ". Contact admin to update assignments.");
  }

  // 1. Check if Winners are already declared — scores immutable after lock
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

  // Resolve team name from server (never trust client-supplied teamName)
  var teamName = teamId;
  try {
    var teamObj = getTeam(ss, teamId);
    teamName = teamObj.teamName || teamId;
  } catch (e) { /* use teamId as fallback */ }

  var targetSheetName = (round === "round2" || round === "2") ? SHEETS.ROUND2 : SHEETS.ROUND1;
  var sheet = ss.getSheetByName(targetSheetName);
  var existingEvals = getSheetObjects(sheet);

  // 4. Enforce Composite Key Duplicate Prevention: JudgeID + TeamID + Round
  for (var i = 0; i < existingEvals.length; i++) {
    var ev = existingEvals[i];
    if (ev.JudgeID === judgeId && ev.TeamID === teamId) {
      throw new Error("DUPLICATE_EVALUATION: You have already evaluated team " + teamId + " for " + round.toUpperCase() + ".");
    }
  }

  var evalId = "EV-" + round.toUpperCase() + "-" + ("000" + (existingEvals.length + 1)).slice(-3);
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var comments = (data.comments || "").trim();

  sheet.appendRow([evalId, judgeId, judgeName, teamId, teamName, c1, c2, c3, c4, total, comments, timestamp]);
  logActivity(ss, judgeId, judgeName, "judge", "Evaluation Submitted",
    "Scored " + teamName + " (" + teamId + ") with " + total + "/100 for " + round.toUpperCase());

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

  var session = data._session;
  logActivity(ss, session.UserID, session.Name, session.Role, "Winners Declared & Locked", "Locked leaderboard. 1st: " + (podium[0] ? podium[0].teamName : "N/A"));

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
  logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "User Created", "Created user: " + data.name + " (" + email + ")");

  return { userId: userId, name: data.name, email: email, role: data.role };
}

function deleteUser(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};

  // SELF-DELETE PREVENTION: Admin cannot delete their own account
  if (data._session && data.userId === data._session.UserID) {
    throw new Error("VALIDATION_ERROR: You cannot delete your own admin account.");
  }

  var sheet = ss.getSheetByName(SHEETS.USERS);
  var dataRange = sheet.getDataRange().getValues();

  for (var i = 1; i < dataRange.length; i++) {
    if (dataRange[i][0] === data.userId) {
      sheet.deleteRow(i + 1);
      logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "User Deleted", "Deleted user " + data.userId);
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
      logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Round Status Changed", "Set " + roundId + " to " + status.toUpperCase());
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

/**
 * verifyAndLoadTeamPortal (called via google.script.run from the HTML email gate)
 * Checks the entered email against team membership and returns team data only if authorized.
 * Admins and organizers can access any team by email.
 */
function verifyAndLoadTeamPortal(token, emailEntered) {
  var ss = getSpreadsheet();
  emailEntered = (emailEntered || "").trim().toLowerCase();

  if (!emailEntered) {
    throw new Error("Please enter your registered email address to access your team pass.");
  }

  // Find team by QR token
  var teams = getTeams(ss);
  var team = null;
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].qrCodeToken === token) {
      team = teams[i];
      break;
    }
  }

  if (!team) {
    throw new Error("INVALID_QR: This QR code is not registered or has been revoked. Please contact an organizer.");
  }

  // Check if requester is admin or organizer (any registered admin/organizer email bypasses the member check)
  var users = getSheetObjects(ss.getSheetByName(SHEETS.USERS));
  var callerUser = null;
  for (var u = 0; u < users.length; u++) {
    if (String(users[u].Email || "").trim().toLowerCase() === emailEntered) {
      callerUser = users[u];
      break;
    }
  }

  var isAdminOrOrganizer = callerUser &&
    (String(callerUser.Role).toLowerCase() === "admin" ||
     String(callerUser.Role).toLowerCase() === "organizer") &&
    String(callerUser.Status).toLowerCase() === "active";

  if (isAdminOrOrganizer) {
    // Admins and organizers can view any team — return full data with privilege flag
    logActivity(ss, callerUser.UserID, callerUser.Name, callerUser.Role, "Admin Portal View",
      "Viewed team portal: " + team.teamName + " (" + team.teamId + ")");
    return { team: team, accessLevel: "ADMIN", viewerName: callerUser.Name, viewerRole: callerUser.Role };
  }

  // Collect all member emails for this team
  var memberEmails = [
    (team.leaderEmail || "").trim().toLowerCase(),
    (team.member2Email || "").trim().toLowerCase(),
    (team.member3Email || "").trim().toLowerCase(),
    (team.member4Email || "").trim().toLowerCase()
  ].filter(function(e) { return e !== ""; });

  if (memberEmails.indexOf(emailEntered) === -1) {
    // Log unauthorized access attempt
    logActivity(ss, emailEntered, emailEntered, "unknown", "Unauthorized QR Access Attempt",
      "Email " + emailEntered + " tried to access team " + team.teamId + " portal but is not a registered member.");
    throw new Error(
      "ACCESS_DENIED: Your email (" + emailEntered + ") is not registered as a member of team \"" +
      team.teamName + "\". Only registered team members can access this pass.\n\nIf you believe this is an error, please contact your organizer."
    );
  }

  // Determine which member role this person is
  var memberRole = "Team Member";
  if ((team.leaderEmail || "").trim().toLowerCase() === emailEntered) {
    memberRole = "Team Leader";
  }

  logActivity(ss, emailEntered, emailEntered, "team", "Team Portal Access",
    memberRole + " " + emailEntered + " accessed team portal for " + team.teamName);

  return { team: team, accessLevel: "MEMBER", memberRole: memberRole, viewerEmail: emailEntered };
}

/**
 * renderCloudTeamPortal — Shows Email Identity Gate first.
 * After the user enters their email and it is verified server-side by verifyAndLoadTeamPortal(),
 * the full team portal is rendered client-side via google.script.run.
 */
function renderCloudTeamPortal(teamId, token) {
  var ss = getSpreadsheet();

  // Determine the lookup token/id to embed in the page
  var lookupToken = token || teamId || "";
  if (!lookupToken) {
    return HtmlService.createHtmlOutput(
      '<html><body style="background:#0B132B;color:#E2E8F0;font-family:system-ui;padding:40px;text-align:center;">' +
      '<h2 style="color:#EF4444;">⚠ Invalid QR Code</h2>' +
      '<p>This QR badge link is invalid or missing. Please present your physical QR badge to be scanned by an organizer.</p>' +
      '</body></html>'
    ).setTitle("Invalid QR — HackTrack");
  }

  // Build the email gate + dynamic portal page
  var html = '<!DOCTYPE html><html lang="en"><head>' +
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<title>Team Identity Verification — Synora\'26</title>' +
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">' +
  '<style>' +
  ':root{--bg:#0B132B;--card:#1C2541;--border:#3A506B;--accent:#06B6D4;--warn:#F59E0B;--success:#10B981;--danger:#EF4444;}' +
  'body{background:var(--bg);color:#E2E8F0;font-family:system-ui,-apple-system,sans-serif;padding:16px 12px;min-height:100vh;}' +
  '.card-box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 8px 32px rgba(0,0,0,0.35);}' +
  '.btn-primary-custom{background:linear-gradient(135deg,#2563EB,#06B6D4);border:none;color:#fff;font-weight:700;border-radius:10px;padding:13px;width:100%;cursor:pointer;font-size:1rem;transition:opacity .2s;}' +
  '.btn-primary-custom:hover{opacity:.88;}' +
  'input{background:#0B132B!important;color:#fff!important;border:1px solid var(--border)!important;border-radius:8px;padding:10px 14px;width:100%;margin-bottom:4px;font-size:1rem;}' +
  'input:focus{border-color:var(--accent)!important;outline:none!important;box-shadow:0 0 0 2px rgba(6,182,212,.25)!important;}' +
  'select,textarea{background:#0B132B!important;color:#fff!important;border:1px solid var(--border)!important;border-radius:8px;padding:10px;width:100%;margin-bottom:12px;}' +
  '.member-badge{display:inline-block;background:rgba(6,182,212,.12);border:1px solid var(--accent);color:var(--accent);border-radius:8px;padding:3px 10px;font-size:.78rem;font-weight:600;margin-bottom:4px;}' +
  '.spinner{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px;}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '#gateScreen,#portalScreen{transition:opacity .3s;}' +
  '.portal-hidden{display:none!important;}' +
  '</style></head><body>' +

  '<div class="container" style="max-width:540px;">' +

  '<!-- HEADER -->' +
  '<div class="text-center mb-4">' +
  '<div style="font-size:2rem;margin-bottom:6px;">⚙</div>' +
  '<h3 class="fw-bold text-info mb-0">HackTrack Cloud Pass</h3>' +
  '<p class="small text-secondary mb-0">Synora\'26 National Flagship Hackathon</p>' +
  '</div>' +

  '<!-- ==================== EMAIL GATE SCREEN ==================== -->' +
  '<div id="gateScreen">' +
  '<div class="card-box" style="border-left:4px solid var(--accent);">' +
  '<div class="text-center mb-3">' +
  '<div style="font-size:2.2rem;">🔐</div>' +
  '<h5 class="fw-bold text-white mb-1">Identity Verification Required</h5>' +
  '<p class="small text-secondary mb-0">Enter the email address you registered with. Only registered team members can access their pass.</p>' +
  '</div>' +
  '<label class="small text-secondary fw-bold mb-1" for="verifyEmail">Your Registered Email Address</label>' +
  '<input type="email" id="verifyEmail" placeholder="e.g. rahul@college.edu" autocomplete="email" autofocus>' +
  '<div id="emailError" class="small text-danger mb-2" style="display:none;"></div>' +
  '<button class="btn-primary-custom mt-2" onclick="verifyIdentity()" id="verifyBtn">🔓 Verify & Open My Pass</button>' +
  '<p class="small text-secondary text-center mt-3 mb-0">⚠ Only your registered email gives you access. Accessing another team\'s pass is not permitted and is logged.</p>' +
  '</div>' +
  '</div>' +

  '<!-- ==================== PORTAL SCREEN (hidden until verified) ==================== -->' +
  '<div id="portalScreen" class="portal-hidden"></div>' +

  '<div class="text-center text-secondary small py-2">⚙ Synora\'26 Cloud System • Google Sheets Live Database</div>' +
  '</div>' +

  '<script>' +
  'var LOOKUP_TOKEN = "' + escapeHtml(lookupToken) + '";' +
  'var verifiedEmail = "";' +
  'var teamData = null;' +
  'var verifierRole = "";' +

  'document.getElementById("verifyEmail").addEventListener("keydown", function(e){' +
  '  if(e.key==="Enter") verifyIdentity();' +
  '});' +

  'function verifyIdentity() {' +
  '  var email = document.getElementById("verifyEmail").value.trim();' +
  '  var btn = document.getElementById("verifyBtn");' +
  '  var errBox = document.getElementById("emailError");' +
  '  errBox.style.display = "none";' +
  '  if (!email || !email.includes("@")) {' +
  '    errBox.textContent = "Please enter a valid email address.";' +
  '    errBox.style.display = "block";' +
  '    return;' +
  '  }' +
  '  btn.disabled = true;' +
  '  btn.innerHTML = \'<span class="spinner"></span>Verifying identity...\';' +
  '  google.script.run' +
  '    .withSuccessHandler(function(result) {' +
  '      verifiedEmail = email;' +
  '      teamData = result.team;' +
  '      verifierRole = result.accessLevel;' +
  '      renderPortal(result);' +
  '    })' +
  '    .withFailureHandler(function(err) {' +
  '      btn.disabled = false;' +
  '      btn.innerHTML = "🔓 Verify & Open My Pass";' +
  '      errBox.textContent = err.message || String(err);' +
  '      errBox.style.display = "block";' +
  '    })' +
  '    .verifyAndLoadTeamPortal(LOOKUP_TOKEN, email);' +
  '}' +

  'function renderPortal(result) {' +
  '  var t = result.team;' +
  '  var isAdmin = result.accessLevel === "ADMIN";' +
  '  var memberRole = result.memberRole || result.viewerRole || "Member";' +
  '  document.getElementById("gateScreen").style.display = "none";' +
  '  var p = document.getElementById("portalScreen");' +
  '  p.classList.remove("portal-hidden");' +

  '  var badge = isAdmin' +
  '    ? \'<span class="badge bg-danger ms-2">👑 \' + (result.viewerRole||"ADMIN").toUpperCase() + \' VIEW</span>\'' +
  '    : \'<span class="badge bg-success ms-2">✓ \' + memberRole + \'</span>\';' +

  '  var memberList = "";' +
  '  if(t.leaderName) memberList += \'<li class="list-group-item bg-transparent border-secondary text-white px-0">👑 <b>\' + esc(t.leaderName) + \'</b>\' + (t.leaderEmail ? \' <span class="small text-secondary">(\' + esc(t.leaderEmail) + \')</span>\' : \'\') + \'</li>\';' +
  '  if(t.member2Name) memberList += \'<li class="list-group-item bg-transparent border-secondary text-white px-0">👤 \' + esc(t.member2Name) + (t.member2Email ? \' <span class="small text-secondary">(\' + esc(t.member2Email) + \')</span>\' : \'\') + \'</li>\';' +
  '  if(t.member3Name) memberList += \'<li class="list-group-item bg-transparent border-secondary text-white px-0">👤 \' + esc(t.member3Name) + (t.member3Email ? \' <span class="small text-secondary">(\' + esc(t.member3Email) + \')</span>\' : \'\') + \'</li>\';' +
  '  if(t.member4Name) memberList += \'<li class="list-group-item bg-transparent border-secondary text-white px-0">👤 \' + esc(t.member4Name) + (t.member4Email ? \' <span class="small text-secondary">(\' + esc(t.member4Email) + \')</span>\' : \'\') + \'</li>\';' +

  '  p.innerHTML = ' +
  '    \'<div class="card-box" style="border-left:4px solid #06B6D4;">\' +' +
  '    \'<div class="d-flex justify-content-between align-items-center mb-1">\' +' +
  '    \'<h4 class="text-white fw-bold mb-0">\' + esc(t.teamName) + \'</h4>\' +' +
  '    \'<span class="badge bg-primary">\' + esc(t.teamId) + \'</span></div>\' +' +
  '    \'<p class="small text-secondary mb-2">\' + esc(t.college||"") + \' • \' + esc(t.department||"") + \'</p>\' +' +
  '    \'<div class="mb-2">\' + badge + \'</div>\' +' +
  '    \'<div class="small text-secondary fw-bold text-uppercase mb-1">Registered Member Roster</div>\' +' +
  '    \'<ul class="list-group list-group-flush">\' + memberList + \'</ul>\' +' +
  '    \'</div>\' +' +
  '    buildProjectSection(t, isAdmin) +' +
  '    buildRoundsSection(t);' +
  '}' +

  'function buildProjectSection(t, isAdmin) {' +
  '  var isSubmitted = (t.submissionLocked === true || t.submissionLocked === "true" || t.problemSubmitted === true || t.problemSubmitted === "true");' +
  '  if (isSubmitted) {' +
  '    return \'<div class="card-box" style="border-color:#10B981;">\' +' +
  '      \'<div class="d-flex justify-content-between align-items-center mb-2">\' +' +
  '      \'<h5 class="text-success fw-bold mb-0">🔒 Project Submission Locked</h5>\' +' +
  '      \'<span class="badge bg-success">Submitted</span></div>\' +' +
  '      \'<div class="mb-2"><span class="badge bg-info text-dark">\' + esc(t.domain||"") + \'</span></div>\' +' +
  '      \'<p class="fw-bold text-white mb-1">\' + esc(t.projectTitle||"Pending") + \'</p>\' +' +
  '      \'<p class="small text-secondary mb-2">\' + esc(t.problemStatement||"") + \'</p>\' +' +
  '      \'<div class="alert py-2 small mb-0" style="background:#0F2744;border:1px solid #1E4976;color:#93C5FD;"><b>Locked:</b> Submission is permanently recorded in Google Cloud.</div>\' +' +
  '      \'</div>\';' +
  '  }' +
  '  return \'<div class="card-box" id="subBox" style="border-color:#F59E0B;">\' +' +
  '    \'<h5 class="text-warning fw-bold mb-1">🔓 One-Time Problem Statement Submission</h5>\' +' +
  '    \'<p class="small text-secondary mb-3">Once submitted this <b>cannot be edited</b>. Ensure all details are correct before locking.</p>\' +' +
  '    \'<form id="problemForm" onsubmit="handleCloudSubmit(event)">\' +' +
  '    \'<label class="small text-secondary">Select Domain *</label>\' +' +
  '    \'<select id="subDomain" required>\' +' +
  '    \'<option value="">Select Domain...</option>\' +' +
  '    \'<option>AI/ML</option><option>Cyber Security</option><option>Cloud &amp; DevOps</option>\' +' +
  '    \'<option>Web Development</option><option>IoT &amp; Smart Hardware</option>\' +' +
  '    \'<option>FinTech &amp; Open Banking</option><option>Healthcare &amp; Blockchain</option><option>Agriculture &amp; ML</option>\' +' +
  '    \'</select>\' +' +
  '    \'<label class="small text-secondary">Project Title *</label>\' +' +
  '    \'<input type="text" id="subTitle" placeholder="e.g. Autonomous Vision Anomaly Detector" required>\' +' +
  '    \'<label class="small text-secondary">Problem Statement / Summary *</label>\' +' +
  '    \'<textarea id="subPS" rows="3" placeholder="Describe your problem approach..." required></textarea>\' +' +
  '    \'<button type="submit" id="lockBtn" class="btn-primary-custom">🔒 Lock In Problem Statement</button>\' +' +
  '    \'</form>\' +' +
  '    \'<div id="submitStatus" class="mt-3"></div>\' +' +
  '    \'</div>\';' +
  '}' +

  'function buildRoundsSection(t) {' +
  '  return \'<div class="card-box">\' +' +
  '    \'<h6 class="text-secondary text-uppercase small fw-bold mb-2">Jury Evaluation Rounds (200 Max Marks)</h6>\' +' +
  '    \'<div class="row g-2 text-center">\' +' +
  '    \'<div class="col-6"><div class="p-2 border border-secondary rounded"><div class="small fw-bold">Round 1 (100)</div><span class="badge bg-secondary">LOCKED</span></div></div>\' +' +
  '    \'<div class="col-6"><div class="p-2 border border-secondary rounded"><div class="small fw-bold">Round 2 (100)</div><span class="badge bg-secondary">LOCKED</span></div></div>\' +' +
  '    \'</div></div>\';' +
  '}' +

  'function handleCloudSubmit(e) {' +
  '  e.preventDefault();' +
  '  var domain = document.getElementById("subDomain").value;' +
  '  var title = document.getElementById("subTitle").value.trim();' +
  '  var ps = document.getElementById("subPS").value.trim();' +
  '  var btn = document.getElementById("lockBtn");' +
  '  var status = document.getElementById("submitStatus");' +
  '  if (!confirm("Are you sure? Your submission will be permanently locked and cannot be changed.")) return;' +
  '  btn.disabled = true;' +
  '  btn.innerHTML = \'<span class="spinner"></span>Locking in Cloud...\';' +
  '  google.script.run' +
  '    .withSuccessHandler(function() {' +
  '      status.innerHTML = \'<div class="alert alert-success">✓ Submission locked successfully! Refreshing...</div>\';' +
  '      setTimeout(function(){location.reload();}, 1400);' +
  '    })' +
  '    .withFailureHandler(function(err) {' +
  '      btn.disabled = false;' +
  '      btn.innerHTML = "🔒 Lock In Problem Statement";' +
  '      status.innerHTML = \'<div class="alert alert-danger">\' + (err.message || err) + \'</div>\';' +
  '    })' +
  '    .submitTeamProblemDetailsVerified(teamData.teamId, teamData.qrCodeToken, verifiedEmail, domain, title, ps);' +
  '}' +

  'function esc(s) {' +
  '  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#039;");' +
  '}' +
  '</script>' +
  '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle("Team Identity Verification — Synora'26")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * submitTeamProblemDetailsVerified — server-side submission with ownership check.
 * Called from the verified portal only, after email identity is confirmed.
 */
function submitTeamProblemDetailsVerified(teamId, token, verifiedEmail, domain, projectTitle, problemStatement) {
  var ss = getSpreadsheet();
  verifiedEmail = (verifiedEmail || "").trim().toLowerCase();

  if (!verifiedEmail) throw new Error("AUTH_REQUIRED: Verified email is required to submit.");

  // Re-validate ownership server-side (defense in depth — never trust client alone)
  var teams = getTeams(ss);
  var team = null;
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === teamId || teams[i].qrCodeToken === token) {
      team = teams[i];
      break;
    }
  }
  if (!team) throw new Error("TEAM_NOT_FOUND: Team not found.");

  // Check ownership: must be admin, organizer, or a registered team member
  var users = getSheetObjects(ss.getSheetByName(SHEETS.USERS));
  var callerUser = null;
  for (var u = 0; u < users.length; u++) {
    if (String(users[u].Email || "").trim().toLowerCase() === verifiedEmail) {
      callerUser = users[u];
      break;
    }
  }

  var isStaff = callerUser &&
    (String(callerUser.Role).toLowerCase() === "admin" ||
     String(callerUser.Role).toLowerCase() === "organizer");

  var memberEmails = [
    (team.leaderEmail || "").trim().toLowerCase(),
    (team.member2Email || "").trim().toLowerCase(),
    (team.member3Email || "").trim().toLowerCase(),
    (team.member4Email || "").trim().toLowerCase()
  ].filter(function(e) { return e !== ""; });

  if (!isStaff && memberEmails.indexOf(verifiedEmail) === -1) {
    logActivity(ss, verifiedEmail, verifiedEmail, "unknown", "IDOR Submission Attempt Blocked",
      "Email " + verifiedEmail + " tried to submit for team " + teamId + " without membership.");
    throw new Error("ACCESS_DENIED: You are not authorized to submit for this team.");
  }

  // Now call the standard submission function
  return submitTeamProblemDetails(ss, {
    teamId: teamId,
    token: token,
    domain: domain,
    projectTitle: projectTitle,
    problemStatement: problemStatement
  });
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
