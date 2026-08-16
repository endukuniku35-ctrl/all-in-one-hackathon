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
 * ==========================================================================
 * High-Concurrency Cache & Atomic Lock Layer (200+ Concurrent User Support)
 * ==========================================================================
 */
var CACHE_CONFIG = {
  DEFAULT_TTL: 180,       // 3 minutes cache for read-heavy operations
  SHORT_TTL: 60,          // 1 minute cache
  MAX_VAL_SIZE: 95000     // 95KB safety margin (Apps Script limit is 100KB)
};

function getScriptCacheItem(key) {
  try {
    var cache = CacheService.getScriptCache();
    var val = cache.get(key);
    if (val) return JSON.parse(val);
  } catch (e) {}
  return null;
}

function setScriptCacheItem(key, data, ttl) {
  try {
    var cache = CacheService.getScriptCache();
    var str = JSON.stringify(data);
    if (str.length < CACHE_CONFIG.MAX_VAL_SIZE) {
      cache.put(key, str, ttl || CACHE_CONFIG.DEFAULT_TTL);
    }
  } catch (e) {}
}

function invalidateScriptCache(keys) {
  try {
    var cache = CacheService.getScriptCache();
    if (Array.isArray(keys)) {
      cache.removeAll(keys);
    } else if (typeof keys === "string") {
      cache.remove(keys);
    }
  } catch (e) {}
}

function invalidateAllCaches() {
  invalidateScriptCache([
    "cached_raw_teams",
    "cached_round_config",
    "cached_settings",
    "cached_leaderboard",
    "cached_dashboard_stats",
    "cached_users_list"
  ]);
}

/**
 * Executes a write operation with an atomic script-wide lock to prevent
 * Google Sheets row write collisions during simultaneous multi-user submissions.
 */
function withScriptLock(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  timeoutMs = timeoutMs || 12000;
  var hasLock = lock.tryLock(timeoutMs);
  if (!hasLock) {
    throw new Error("SERVER_BUSY: System is processing heavy concurrent requests. Please retry in a moment.");
  }
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

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

    case "getSystemHealth":
      auth(["ADMIN"]);
      return getSystemHealth(ss, data);

    case "getScoreAuditLogs":
      auth(["ADMIN"]);
      return getScoreAuditLogs(ss, data);

    // ── ADMIN + ORGANIZER ──
    case "getDashboardStats":
      auth(["ADMIN", "ORGANIZER"]);
      return getDashboardStats(ss, data);

    case "registerTeam":
      auth(["ADMIN", "ORGANIZER"]);
      return registerTeam(ss, data);

    case "bulkRegisterTeams":
      auth(["ADMIN", "ORGANIZER"]);
      return bulkRegisterTeams(ss, data);

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
      return getTeam(ss, data.teamId || data.token || data.identifier, data._session);

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
 * Cryptographic Strong QR Engine (HMAC-SHA256 Signed & Tamper-Proof)
 * ==========================================================================
 */
function getQrSigningKey() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty("HACKTRACK_QR_HMAC_SECRET");
  if (!secret) {
    secret = "HT26-SECRET-" + Utilities.getUuid() + "-" + Utilities.getUuid();
    props.setProperty("HACKTRACK_QR_HMAC_SECRET", secret);
  }
  return secret;
}

/**
 * Generates an unforgeable, HMAC-SHA256 cryptographically signed QR token:
 * Format: HT26-V2-<TEAM_ID>-<NONCE_16>-<TIMESTAMP_HEX>-<HMAC_16>
 */
function generateStrongQrToken(teamId) {
  var teamClean = String(teamId || "").trim().toUpperCase();
  var nonce = Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase();
  var ts = Math.floor(new Date().getTime() / 1000).toString(16).toUpperCase();
  var payload = "HT26:" + teamClean + ":" + nonce + ":" + ts;
  var secret = getQrSigningKey();

  var sigBytes = Utilities.computeHmacSha256Signature(payload, secret);
  var sigHex = sigBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('').substring(0, 16).toUpperCase();

  return "HT26-V2-" + teamClean + "-" + nonce + "-" + ts + "-" + sigHex;
}

/**
 * Validates the cryptographic signature and format of a QR token.
 * Strictly enforces HMAC-SHA256 signature and timestamp expiry (48h).
 * Rejects legacy unsigned tokens.
 */
function verifyQrTokenIntegrity(token) {
  if (!token) throw new Error("INVALID_QR: QR token is required.");
  token = String(token).trim();

  // Strictly enforce V2 HMAC-signed token format (disallow legacy unsigned tokens)
  if (token.indexOf("HT26-V2-") !== 0) {
    throw new Error("INVALID_QR: Legacy QR tokens are no longer supported. Please present a V2 HMAC-signed badge.");
  }

  // Strong V2 format check: HT26-V2-<TEAM_ID>-<NONCE_16>-<TIMESTAMP_HEX>-<HMAC_16>
  var parts = token.split("-");
  if (parts.length < 6) {
    throw new Error("INVALID_QR_FORMAT: Malformed cryptographic QR token.");
  }

  var prefix = parts[0];
  var ver = parts[1];
  var teamId = parts[2];
  var nonce = parts[3];
  var ts = parts[4];
  var sig = parts[5];

  if (prefix !== "HT26" || ver !== "V2" || !teamId || !nonce || !ts || !sig) {
    throw new Error("INVALID_QR_FORMAT: Incomplete cryptographic token parameters.");
  }

  // Cryptographic Signature Verification
  var payload = "HT26:" + teamId.toUpperCase() + ":" + nonce.toUpperCase() + ":" + ts.toUpperCase();
  var secret = getQrSigningKey();
  var sigBytes = Utilities.computeHmacSha256Signature(payload, secret);
  var expectedSig = sigBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('').substring(0, 16).toUpperCase();

  if (sig.toUpperCase() !== expectedSig) {
    throw new Error("INVALID_QR_SIGNATURE: This QR badge failed cryptographic integrity verification (tampered or forged).");
  }

  // Timestamp Expiry Enforcement (Max 48 Hours)
  var tokenTime = parseInt(ts, 16) * 1000;
  var now = new Date().getTime();
  var age = now - tokenTime;
  var maxAgeMs = (SECURITY.QR_EXPIRY_HOURS || 48) * 60 * 60 * 1000;

  // Allow up to 2 minutes clock skew in the future, reject anything older than maxAgeMs
  if (age < -120000 || age > maxAgeMs) {
    throw new Error("QR_EXPIRED: This QR badge has expired (validity window is " + (SECURITY.QR_EXPIRY_HOURS || 48) + " hours).");
  }

  return true;
}

/**
 * ==========================================================================
 * Team Management & Cryptographic QR Passes
 * ==========================================================================
 */

function getTeams(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};

  var rows = getScriptCacheItem("cached_raw_teams");
  if (!rows) {
    rows = getSheetObjects(ss.getSheetByName(SHEETS.TEAMS));
    setScriptCacheItem("cached_raw_teams", rows, CACHE_CONFIG.DEFAULT_TTL);
  }

  // Only redact PII if this is a JUDGE session requesting via API
  var isJudge = (data._session && String(data._session.Role).toUpperCase() === "JUDGE");
  var redactPII = isJudge;

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

    // Redact sensitive PII only for judges
    if (!redactPII) {
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

function getTeam(ss, identifier, session) {
  ss = ss || getSpreadsheet();
  if (!identifier) throw new Error("TEAM_NOT_FOUND: Team identifier is required.");
  identifier = identifier.trim();
  var teams = getTeams(ss, { _session: session });

  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === identifier || teams[i].qrCodeToken === identifier) {
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
  return withScriptLock(function() {
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
    
    // High-Entropy HMAC-SHA256 Cryptographically Signed QR Token
    var qrToken = generateStrongQrToken(teamId);
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
    invalidateAllCaches();
    logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Registered", "Registered team: " + teamName + " (" + teamId + ")");

    return {
      teamId: teamId,
      teamName: teamName,
      qrCodeToken: qrToken,
      createdAt: timestamp
    };
  });
}

function submitTeamProblemDetails(arg1, arg2, arg3, arg4, arg5) {
  return withScriptLock(function() {
    var ss = null;
    var data = {};

    if (arg1 && typeof arg1 === "object" && typeof arg1.getSheetByName === "function") {
      // Called internally as (ss, data)
      ss = arg1;
      data = arg2 || {};
    } else if (arg1 && typeof arg1 === "object") {
      // Called via google.script.run as ({ teamId, ... })
      ss = getSpreadsheet();
      data = arg1;
    } else {
      // Called via google.script.run as (teamId, token, domain, title, ps)
      ss = getSpreadsheet();
      data = {
        teamId: arg1,
        token: arg2,
        domain: arg3,
        projectTitle: arg4,
        problemStatement: arg5
      };
    }

    var teamId = (data.teamId || "").trim();
    var token = (data.token || "").trim();
    
    if (!teamId && !token) throw new Error("VALIDATION_ERROR: Team ID or Security Token is required.");

    var sheet = ss.getSheetByName(SHEETS.TEAMS);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      var row = dataRange[i];
      if (row[0] === teamId || (token && row[23] === token)) {
        // Backend enforcement: Verify if already submitted!
        if (row[21] === true || row[21] === "true" || row[22] === true || row[22] === "true") {
          throw new Error("SUBMISSION_LOCKED: Team '" + row[1] + "' has already submitted and locked their project details.");
        }

        sheet.getRange(i + 1, 3).setValue(data.projectTitle || "Project");
        sheet.getRange(i + 1, 4).setValue(data.domain || "AI/ML");
        sheet.getRange(i + 1, 5).setValue(data.problemStatement || "Problem Statement");
        sheet.getRange(i + 1, 22).setValue(true); // ProblemSubmitted
        sheet.getRange(i + 1, 23).setValue(true); // SubmissionLocked

        invalidateAllCaches();
        logActivity(ss, row[0], row[1], "team", "Problem Statement Submitted", "Team " + row[1] + " locked in statement: " + (data.problemStatement || ""));

        return {
          success: true,
          teamId: row[0],
          message: "Problem statement and project details locked successfully in Google Cloud."
        };
      }
    }

    throw new Error("TEAM_NOT_FOUND: Team not found with specified identifier.");
  });
}

/**
 * updateTeam — Privileged operation restricted to authenticated Admin/Organizer.
 * Students/teams CANNOT use this route to edit submitted details.
 * When Admin/Organizer updates a locked team, an explicit override audit log is recorded.
 */
function updateTeam(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    if (!data.teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

    var sheet = ss.getSheetByName(SHEETS.TEAMS);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === data.teamId) {
        var isLocked = (dataRange[i][21] === true || dataRange[i][21] === "true" || dataRange[i][22] === true || dataRange[i][22] === "true");
        if (data.teamName) sheet.getRange(i + 1, 2).setValue(data.teamName);
        if (data.projectTitle) sheet.getRange(i + 1, 3).setValue(data.projectTitle);
        if (data.domain) sheet.getRange(i + 1, 4).setValue(data.domain);
        if (data.problemStatement) sheet.getRange(i + 1, 5).setValue(data.problemStatement);
        if (data.college) sheet.getRange(i + 1, 6).setValue(data.college);
        if (data.department) sheet.getRange(i + 1, 7).setValue(data.department);
        if (data.leaderName) sheet.getRange(i + 1, 8).setValue(data.leaderName);
        if (data.leaderEmail) sheet.getRange(i + 1, 9).setValue(data.leaderEmail);
        if (data.leaderPhone) sheet.getRange(i + 1, 10).setValue(data.leaderPhone);
        invalidateAllCaches();
        var session = data._session || { UserID: "system", Name: "Admin", Role: "admin" };
        var logDetail = isLocked 
          ? ("Admin/Organizer override update on LOCKED team " + data.teamId)
          : ("Modified team " + data.teamId);
        logActivity(ss, session.UserID, session.Name, session.Role, isLocked ? "Admin Team Override" : "Team Updated", logDetail);
        return { success: true, teamId: data.teamId, overridden: isLocked };
      }
    }
    throw new Error("TEAM_NOT_FOUND: Team " + data.teamId + " not found.");
  });
}

function deleteTeam(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    if (!data.teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

    var sheet = ss.getSheetByName(SHEETS.TEAMS);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === data.teamId) {
        sheet.deleteRow(i + 1);
        invalidateAllCaches();
        logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Deleted", "Deleted team " + data.teamId);
        return { success: true, teamId: data.teamId };
      }
    }
    throw new Error("TEAM_NOT_FOUND: Team not found.");
  });
}

function unlockTeam(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    var sheet = ss.getSheetByName(SHEETS.TEAMS);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === data.teamId) {
        sheet.getRange(i + 1, 22).setValue(false); // ProblemSubmitted
        sheet.getRange(i + 1, 23).setValue(false); // SubmissionLocked
        invalidateAllCaches();
        logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Team Unlocked", "Unlocked submission for team " + data.teamId);
        return { success: true, teamId: data.teamId, message: "Team submission unlocked for modification." };
      }
    }
    throw new Error("TEAM_NOT_FOUND: Team not found.");
  });
}

/**
 * ==========================================================================
 * Attendance Check-in Engine
 * ==========================================================================
 */

function markAttendance(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    var rawId = (data.teamId || "").trim();

    // Server-derived identity from authenticated session
    var session = data._session;
    var markedBy = session ? (session.Name + " (" + session.Role + ")") : "System";
    var usedQrToken = (data.qrToken || rawId).trim();

    if (!rawId) throw new Error("VALIDATION_ERROR: Team ID or QR token is required.");

    // Cryptographic signature check for V2 tokens
    if (usedQrToken && usedQrToken.indexOf("HT26-V2-") === 0) {
      verifyQrTokenIntegrity(usedQrToken);
    }

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
    invalidateAllCaches();
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
  });
}

/**
 * generateRotatingQR — Admin/Organizer can issue a new QR token for a team
 * (e.g. after a lost badge). Old token is revoked by being replaced.
 */
function generateRotatingQR(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    var teamId = (data.teamId || "").trim();
    if (!teamId) throw new Error("VALIDATION_ERROR: teamId is required.");

    var sheet = ss.getSheetByName(SHEETS.TEAMS);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === teamId) {
        var oldToken = dataRange[i][23];
        // Rotate to a fresh high-entropy HMAC-SHA256 Cryptographic Token
        var newToken = generateStrongQrToken(teamId);
        sheet.getRange(i + 1, 24).setValue(newToken);

        invalidateAllCaches();
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
  });
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
  return withScriptLock(function() {
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

    invalidateAllCaches();
    logActivity(ss, session.UserID, session.Name, session.Role, "Judge Assignments Saved",
      "Updated jury routing matrix with " + count + " assignments.");
    return { success: true, count: count };
  });
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
  return withScriptLock(function() {
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
    invalidateAllCaches();
    logActivity(ss, judgeId, judgeName, "judge", "Evaluation Submitted",
      "Scored " + teamName + " (" + teamId + ") with " + total + "/100 for " + round.toUpperCase());

    return {
      success: true,
      evalId: evalId,
      total: total,
      timestamp: timestamp,
      message: "Evaluation score (" + total + "/100) saved and permanently locked in Google Cloud."
    };
  });
}

/**
 * ==========================================================================
 * Leaderboard & Winner Declaration with Multi-Tier Tie-Breakers
 * ==========================================================================
 */

function getLeaderboard(ss, data) {
  ss = ss || getSpreadsheet();
  var cached = getScriptCacheItem("cached_leaderboard");
  if (cached) return cached;

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

  setScriptCacheItem("cached_leaderboard", leaderboard, 60); // 1 minute TTL
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
  return withScriptLock(function() {
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

    invalidateAllCaches();
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
  });
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
  if (action === "releaseCertificates" || action === "generateCertificates") {
    generateAllCertificates(ss);
    var setSheet = ss.getSheetByName(SHEETS.SETTINGS);
    if (setSheet) {
      var setRange = setSheet.getDataRange().getValues();
      for (var j = 1; j < setRange.length; j++) {
        if (setRange[j][0] === "areWinnersDeclared") setSheet.getRange(j + 1, 2).setValue(true);
        if (setRange[j][0] === "isCertificateSystemEnabled") setSheet.getRange(j + 1, 2).setValue(true);
      }
    }
    invalidateAllCaches();
    return { success: true, message: "All certificates generated and officially released to student passes!" };
  }
  var sheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  return getSheetObjects(sheet);
}

function verifyCertificate(ss, data) {
  ss = ss || getSpreadsheet();
  data = data || {};
  var certId = (data.certId || data.certificateId || data.id || "").trim().toUpperCase();

  if (!certId) throw new Error("CERTIFICATE_NOT_FOUND: Certificate ID or verification token is required for verification.");

  var certs = getSheetObjects(ss.getSheetByName(SHEETS.CERTIFICATES));
  var foundCert = certs.find(function(c) { 
    return (c.CertificateID && c.CertificateID.toUpperCase() === certId) || 
           (c.VerificationToken && c.VerificationToken.toUpperCase() === certId); 
  });

  if (!foundCert) {
    throw new Error("CERTIFICATE_NOT_FOUND: No certificate record found for ID/Token: " + certId);
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
  var cached = getScriptCacheItem("cached_users_list");
  if (cached) return cached;

  var rows = getSheetObjects(ss.getSheetByName(SHEETS.USERS));
  var result = rows.map(function(r) {
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
  setScriptCacheItem("cached_users_list", result, CACHE_CONFIG.DEFAULT_TTL);
  return result;
}

function createUser(ss, data) {
  return withScriptLock(function() {
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
    
    if (!data.password || String(data.password).trim().length < 6) {
      throw new Error("VALIDATION_ERROR: A secure password of at least 6 characters is required when creating a user account.");
    }
    var password = String(data.password).trim();
    var passwordHash = hashPassword(password);
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    sheet.appendRow([userId, data.name || "User", email, passwordHash, (data.role || "judge").toLowerCase(), data.specialization || "General", "active", timestamp]);
    invalidateAllCaches();
    logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "User Created", "Created user: " + data.name + " (" + email + ")");

    return { userId: userId, name: data.name, email: email, role: data.role };
  });
}

function deleteUser(ss, data) {
  return withScriptLock(function() {
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
        invalidateAllCaches();
        logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "User Deleted", "Deleted user " + data.userId);
        return { success: true };
      }
    }
    throw new Error("USER_NOT_FOUND: User not found.");
  });
}

function getRoundConfig(ss, data) {
  ss = ss || getSpreadsheet();
  var cached = getScriptCacheItem("cached_round_config");
  if (cached) return cached;

  var rows = getSheetObjects(ss.getSheetByName(SHEETS.ROUND_CONFIG));
  var result = rows.map(function(r) {
    return {
      roundId: r.RoundID,
      roundName: r.RoundName,
      description: r.Description,
      status: r.Status,
      maxMarks: r.MaxMarks
    };
  });
  setScriptCacheItem("cached_round_config", result, CACHE_CONFIG.DEFAULT_TTL);
  return result;
}

function updateRoundStatus(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    var roundId = data.roundId || "round1";
    var status = data.status || "active";

    var sheet = ss.getSheetByName(SHEETS.ROUND_CONFIG);
    var dataRange = sheet.getDataRange().getValues();

    for (var i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === roundId) {
        sheet.getRange(i + 1, 4).setValue(status);
        invalidateAllCaches();
        logActivity(ss, data._session.UserID, data._session.Name, data._session.Role, "Round Status Changed", "Set " + roundId + " to " + status.toUpperCase());
        return { roundId: roundId, status: status };
      }
    }
    return { roundId: roundId, status: status };
  });
}

function handleSettings(ss, action, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (action === "updateSettings" && data.settings) {
    return withScriptLock(function() {
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
      invalidateAllCaches();
      return getSheetObjects(sheet);
    });
  }

  var cached = getScriptCacheItem("cached_settings");
  if (cached) return cached;
  var settings = getSheetObjects(sheet);
  setScriptCacheItem("cached_settings", settings, CACHE_CONFIG.DEFAULT_TTL);
  return settings;
}

function getDashboardStats(ss, data) {
  ss = ss || getSpreadsheet();
  var cached = getScriptCacheItem("cached_dashboard_stats");
  if (cached) return cached;

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

  var result = {
    totalTeams: totalTeams,
    totalParticipants: totalParticipants,
    attendanceRate: attRate,
    checkedInTeams: checkedIn,
    pendingCheckIn: Math.max(0, totalTeams - checkedIn),
    r1Count: Object.keys(r1Set).length,
    r2Count: Object.keys(r2Set).length,
    domainCounts: domainCounts
  };
  setScriptCacheItem("cached_dashboard_stats", result, 60); // 1 minute TTL
  return result;
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
  token = (token || "").trim();

  if (!emailEntered) {
    throw new Error("Please enter your registered email address to access your team pass.");
  }

  // Cryptographic signature check for V2 tokens on presentation
  if (token && token.indexOf("HT26-V2-") === 0) {
    verifyQrTokenIntegrity(token);
  }

  // Find team by QR token OR by Team ID
  var teams = getTeams(ss, { _internal: true });
  var team = null;
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].qrCodeToken === token || teams[i].teamId === token) {
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

  // Check if certificates are released for this team
  var certSheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  var allCerts = certSheet ? getSheetObjects(certSheet) : [];
  var teamCerts = allCerts.filter(function(c) {
    return String(c.TeamID).toUpperCase() === String(team.teamId).toUpperCase();
  });

  var settings = getSheetObjects(ss.getSheetByName(SHEETS.SETTINGS));
  var winnersDeclaredSetting = settings.find(function(s) { return s.SettingKey === "areWinnersDeclared"; });
  var certsEnabledSetting = settings.find(function(s) { return s.SettingKey === "isCertificateSystemEnabled"; });

  var areCertificatesReleased = (teamCerts.length > 0) && (
    (winnersDeclaredSetting && (winnersDeclaredSetting.SettingValue === true || String(winnersDeclaredSetting.SettingValue).toLowerCase() === "true")) ||
    (certsEnabledSetting && (certsEnabledSetting.SettingValue === true || String(certsEnabledSetting.SettingValue).toLowerCase() === "true")) ||
    (teamCerts.some(function(c) { return String(c.Status).toUpperCase() === "VALID" || String(c.Status).toUpperCase() === "RELEASED"; }))
  );

  if (isAdminOrOrganizer) {
    // Admins and organizers can view any team — return full data with privilege flag
    logActivity(ss, callerUser.UserID, callerUser.Name, callerUser.Role, "Admin Portal View",
      "Viewed team portal: " + team.teamName + " (" + team.teamId + ")");
    return { 
      team: team, 
      accessLevel: "ADMIN", 
      viewerName: callerUser.Name, 
      viewerRole: callerUser.Role,
      areCertificatesReleased: areCertificatesReleased,
      certificates: teamCerts
    };
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

  return { 
    team: team, 
    accessLevel: "MEMBER", 
    memberRole: memberRole, 
    viewerEmail: emailEntered,
    areCertificatesReleased: areCertificatesReleased,
    certificates: teamCerts
  };
}

function renderCloudTeamPortal(teamId, token) {
  var ss = getSpreadsheet();
  var lookupToken = token || teamId || "";
  if (!lookupToken) {
    return HtmlService.createHtmlOutput(
      '<html><body style="background:#070B19;color:#E2E8F0;font-family:system-ui;padding:40px;text-align:center;">' +
      '<h2 style="color:#EF4444;">⚠ Invalid QR Pass</h2>' +
      '<p>This QR pass link is invalid or missing. Please present your badge to an organizer.</p>' +
      '</body></html>'
    ).setTitle("Invalid Pass — Synora'26");
  }

  // Instant server-side lookup
  var teams = getTeams(ss, { _internal: true });
  var team = null;
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === lookupToken || teams[i].qrCodeToken === lookupToken) {
      team = teams[i];
      break;
    }
  }

  if (!team) {
    return HtmlService.createHtmlOutput(
      '<html><body style="background:#070B19;color:#E2E8F0;font-family:system-ui;padding:40px;text-align:center;">' +
      '<h2 style="color:#EF4444;">Team Not Found</h2>' +
      '<p>Could not locate a registered team for token: <b>' + escapeHtml(lookupToken) + '</b>.</p>' +
      '</body></html>'
    ).setTitle("Team Not Found — Synora'26");
  }

  // Fetch certificates
  var certSheet = ss.getSheetByName(SHEETS.CERTIFICATES);
  var allCerts = certSheet ? getSheetObjects(certSheet) : [];
  var teamCerts = allCerts.filter(function(c) {
    return String(c.TeamID).toUpperCase() === String(team.teamId).toUpperCase();
  });
  var areCertsReleased = (teamCerts.length > 0) && teamCerts.some(function(c) {
    return String(c.Status).toUpperCase() === "VALID" || String(c.Status).toUpperCase() === "RELEASED";
  });

  var hasStatement = Boolean(team.problemStatement && 
    team.problemStatement !== "Pending Release" && 
    team.problemStatement !== "Pending Statement Submission" && 
    team.problemStatement !== "Pending Submission" && 
    team.problemStatement.trim().length > 0);
  var isSubmitted = (team.submissionLocked === true || team.submissionLocked === "true" || team.problemSubmitted === true || team.problemSubmitted === "true" || hasStatement);

  // SANITIZE PUBLIC PII: Strip emails, phone numbers, and raw secrets from client DOM
  var publicTeam = {
    teamId: team.teamId,
    teamName: team.teamName,
    college: team.college || "University",
    department: team.department || "",
    domain: team.domain || "",
    projectTitle: team.projectTitle || "",
    problemStatement: team.problemStatement || "",
    submissionLocked: isSubmitted,
    problemSubmitted: isSubmitted,
    leaderName: team.leaderName || "",
    member2Name: team.member2Name || "",
    member3Name: team.member3Name || "",
    member4Name: team.member4Name || "",
    qrCodeToken: team.qrCodeToken || lookupToken
  };

  var teamJson = JSON.stringify(publicTeam);
  var certsJson = JSON.stringify(teamCerts);

  var html = '<!DOCTYPE html><html lang="en"><head>' +
  '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<title>' + escapeHtml(team.teamName) + ' — Synora\'26 Pass</title>' +
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">' +
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">' +
  '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
  '<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>' +
  '<style>' +
  ':root{' +
  '  --bg: #070B19; --card: #0F172A; --card-glass: rgba(15, 23, 42, 0.95);' +
  '  --border: #1E293B; --border-bright: #334155;' +
  '  --cyan: #06B6D4; --cyan-glow: rgba(6, 182, 212, 0.25);' +
  '  --emerald: #10B981; --emerald-glow: rgba(16, 185, 129, 0.25);' +
  '  --amber: #F59E0B; --amber-glow: rgba(245, 158, 11, 0.25);' +
  '}' +
  '* { box-sizing: border-box; }' +
  'body { background: var(--bg); color: #E2E8F0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 12px; min-height: 100vh; background-image: radial-gradient(ellipse 90% 40% at 50% -10%, rgba(6,182,212,0.18), rgba(255,255,255,0)); }' +
  '.app-container { max-width: 520px; margin: 0 auto; }' +
  '.easy-card { background: var(--card-glass); border: 1px solid var(--border); border-radius: 18px; padding: 20px; margin-bottom: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.45); }' +
  '.tab-bar { display: flex; background: #0F172A; padding: 5px; border-radius: 14px; border: 1px solid var(--border); gap: 4px; margin-bottom: 16px; }' +
  '.tab-btn { flex: 1; padding: 10px 6px; background: transparent; border: none; color: #94A3B8; font-weight: 700; font-size: 0.84rem; border-radius: 10px; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 5px; }' +
  '.tab-btn.active { background: linear-gradient(135deg, #2563EB, #06B6D4); color: #FFFFFF; box-shadow: 0 4px 12px rgba(6,182,212,0.3); }' +
  '.btn-main { background: linear-gradient(135deg, #2563EB, #06B6D4); border: none; color: #FFFFFF; font-weight: 700; border-radius: 12px; padding: 13px 18px; width: 100%; cursor: pointer; font-size: 1rem; transition: all .2s; box-shadow: 0 4px 16px var(--cyan-glow); }' +
  '.btn-main:hover { opacity: .92; transform: translateY(-1px); }' +
  '.btn-soft { background: rgba(255,255,255,0.06); border: 1px solid var(--border-bright); color: #E2E8F0; font-weight: 600; border-radius: 10px; padding: 10px 14px; transition: all .2s; cursor: pointer; }' +
  '.btn-soft:hover { background: rgba(255,255,255,0.12); color: #FFF; border-color: var(--cyan); }' +
  'input, select, textarea { background: #070B19 !important; color: #F8FAFC !important; border: 1px solid var(--border-bright) !important; border-radius: 10px; padding: 12px 14px; width: 100%; margin-bottom: 12px; font-size: 0.95rem; }' +
  'input:focus, select:focus, textarea:focus { border-color: var(--cyan) !important; outline: none !important; box-shadow: 0 0 0 3px var(--cyan-glow) !important; }' +
  '.badge-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; }' +
  '.badge-pill.cyan { background: rgba(6,182,212,0.15); color: #38BDF8; border: 1px solid rgba(6,182,212,0.3); }' +
  '.badge-pill.emerald { background: rgba(16,185,129,0.15); color: #34D399; border: 1px solid rgba(16,185,129,0.3); }' +
  '.badge-pill.amber { background: rgba(245,158,11,0.15); color: #FBBF24; border: 1px solid rgba(245,158,11,0.3); }' +
  '.avatar-circle { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #3B82F6, #06B6D4); display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; font-size: 0.9rem; flex-shrink: 0; }' +
  '.toast-msg { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #0F172A; border: 1px solid var(--cyan); color: #fff; padding: 12px 24px; border-radius: 30px; font-size: 0.88rem; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.6); z-index: 9999; display: none; }' +
  '.tab-content-panel { display: none; }' +
  '.tab-content-panel.active { display: block; animation: fadeIn .25s ease-in-out; }' +
  '@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }' +
  '.spinner { display: inline-block; width: 18px; height: 18px; border: 3px solid rgba(255,255,255,.3); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; vertical-align: middle; margin-right: 8px; }' +
  '@keyframes spin { to { transform: rotate(360deg); } }' +
  '.member-chip { background: rgba(255,255,255,0.05); border: 1px solid var(--border-bright); border-radius: 25px; padding: 6px 14px; font-size: 0.82rem; font-weight: 600; color: #E2E8F0; cursor: pointer; transition: all .2s; display: inline-flex; align-items: center; gap: 6px; }' +
  '.member-chip:hover { border-color: var(--cyan); background: rgba(6,182,212,0.12); color: #fff; }' +
  '.member-chip.selected { background: linear-gradient(135deg, rgba(37,99,235,0.4), rgba(6,182,212,0.3)); border-color: var(--cyan); color: #38BDF8; }' +
  '</style></head><body>' +

  '<div class="app-container">' +

  '<!-- 1. TOP HEADER -->' +
  '<div class="d-flex justify-content-between align-items-center mb-3 pt-2 px-1">' +
  '  <div class="d-flex align-items-center gap-2">' +
  '    <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#2563EB,#06B6D4);display:flex;align-items:center;justify-content:center;font-size:1.1rem;">⚙</div>' +
  '    <div>' +
  '      <h6 class="fw-bold text-white mb-0">Synora\'26 Team Pass</h6>' +
  '      <div class="small text-secondary" style="font-size:0.75rem;">Cloud Pass • ' + escapeHtml(team.teamId) + '</div>' +
  '    </div>' +
  '  </div>' +
  '  <div id="verifiedStatusBadge"><span class="badge-pill amber"><i class="bi bi-shield-lock"></i> VERIFICATION REQUIRED</span></div>' +
  '</div>' +

  '<!-- 2. TEAM OVERVIEW CARD -->' +
  '<div class="easy-card mb-3" style="border-left:5px solid var(--cyan);">' +
  '  <div class="d-flex justify-content-between align-items-start">' +
  '    <div>' +
  '      <span class="badge bg-primary font-monospace mb-1">' + escapeHtml(team.teamId) + '</span>' +
  '      <h3 class="fw-bold text-white mb-1">' + escapeHtml(team.teamName) + '</h3>' +
  '      <div class="small text-secondary">🏛️ ' + escapeHtml(team.college || "University") + (team.department ? " • " + escapeHtml(team.department) : "") + '</div>' +
  '    </div>' +
  '  </div>' +
  '</div>' +

  '<!-- 3. SEAMLESS MEMBER VERIFICATION CARD (ZERO PII EXPOSED) -->' +
  '<div class="easy-card mb-3" id="easyVerificationCard" style="border-left:5px solid var(--cyan);background:linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(15,23,42,1) 100%);">' +
  '  <div class="d-flex justify-content-between align-items-center mb-2">' +
  '    <div class="fw-bold text-white"><i class="bi bi-person-badge text-info me-1"></i> Member Identity Verification</div>' +
  '    <span class="badge-pill cyan">1-Step</span>' +
  '  </div>' +
  '  <p class="small text-secondary mb-2">Select who you are to easily unlock verified project submission &amp; certificates:</p>' +
  '  <div class="d-flex flex-wrap gap-2 mb-3" id="memberChipsContainer">' +
  (team.leaderName ? ('<div class="member-chip" onclick="selectMemberToVerify(\'' + escapeHtml(team.leaderName) + '\', \'Team Leader\')">👑 ' + escapeHtml(team.leaderName) + ' <span class="badge bg-warning text-dark ms-1">Leader</span></div>') : '') +
  (team.member2Name ? ('<div class="member-chip" onclick="selectMemberToVerify(\'' + escapeHtml(team.member2Name) + '\', \'Member\')">👤 ' + escapeHtml(team.member2Name) + '</div>') : '') +
  (team.member3Name ? ('<div class="member-chip" onclick="selectMemberToVerify(\'' + escapeHtml(team.member3Name) + '\', \'Member\')">👤 ' + escapeHtml(team.member3Name) + '</div>') : '') +
  (team.member4Name ? ('<div class="member-chip" onclick="selectMemberToVerify(\'' + escapeHtml(team.member4Name) + '\', \'Member\')">👤 ' + escapeHtml(team.member4Name) + '</div>') : '') +
  '  </div>' +
  '  <div id="verifyEmailInputArea" style="display:none;">' +
  '    <label class="small text-secondary fw-bold mb-1">Enter registered email for <span id="verifyingNameLabel" class="text-white fw-bold"></span>:</label>' +
  '    <div class="d-flex gap-2">' +
  '      <input type="email" id="quickVerifyEmail" placeholder="e.g. yourname@university.edu" style="margin-bottom:0;" autocomplete="email">' +
  '      <button class="btn-main" style="width:auto;white-space:nowrap;padding:10px 18px;" onclick="executeQuickVerify()">Verify</button>' +
  '    </div>' +
  '    <div id="quickVerifyError" class="small text-danger mt-1" style="display:none;"></div>' +
  '  </div>' +
  '  <div id="verifiedSuccessBox" style="display:none;" class="p-2 rounded bg-success bg-opacity-10 border border-success border-opacity-25 mt-2">' +
  '    <div class="d-flex justify-content-between align-items-center">' +
  '      <div class="small text-success fw-bold"><i class="bi bi-check-circle-fill me-1"></i> Verified as <span id="verifiedSuccessName" class="text-white"></span> (<span id="verifiedSuccessRole"></span>)</div>' +
  '      <button class="btn btn-link btn-sm text-secondary p-0" onclick="resetVerification()" style="font-size:0.75rem;">Switch</button>' +
  '    </div>' +
  '  </div>' +
  '</div>' +

  '<!-- 4. NAVIGATION TABS -->' +
  '<div class="tab-bar">' +
  '  <button class="tab-btn active" id="btnTabQr" onclick="showTab(\'qr\')"><i class="bi bi-qr-code"></i> QR Pass</button>' +
  '  <button class="tab-btn" id="btnTabProject" onclick="showTab(\'project\')"><i class="bi bi-code-slash"></i> Project' + (isSubmitted ? ' ✓' : '') + '</button>' +
  '  <button class="tab-btn" id="btnTabTeam" onclick="showTab(\'team\')"><i class="bi bi-people-fill"></i> Team</button>' +
  (areCertsReleased ? '<button class="tab-btn" id="btnTabCerts" onclick="showTab(\'certs\')"><i class="bi bi-award-fill text-warning"></i> Certificates</button>' : '') +
  '</div>' +

  '<!-- ================= TAB 1: QR CHECK-IN PASS ================= -->' +
  '<div class="tab-content-panel active" id="tabPanel_qr">' +
  '  <div class="easy-card text-center" style="border-left:5px solid var(--emerald);">' +
  '    <h5 class="text-white fw-bold mb-1">📱 Check-In QR Badge</h5>' +
  '    <p class="small text-secondary mb-3">Show this QR badge at the registration desk for fast check-in.</p>' +
  '    <div id="passQrCanvas" class="d-flex justify-content-center p-3 bg-white rounded-3 mx-auto shadow-sm" style="width:190px;height:190px;"></div>' +
  '    <div class="mt-2 small text-info fw-bold font-monospace">TOKEN: ' + escapeHtml(team.qrCodeToken || lookupToken) + '</div>' +
  '    <div class="row g-2 mt-3">' +
  '      <div class="col-6"><button class="btn-soft w-100 fw-bold" onclick="downloadPassImage()"><i class="bi bi-download"></i> Save to Photos</button></div>' +
  '      <div class="col-6"><button class="btn-soft w-100 fw-bold" onclick="window.print()"><i class="bi bi-printer"></i> Print Pass</button></div>' +
  '    </div>' +
  '  </div>' +
  '</div>' +

  '<!-- ================= TAB 2: PROJECT & PROBLEM STATEMENT ================= -->' +
  '<div class="tab-content-panel" id="tabPanel_project">' +
  '  <div class="easy-card" id="projectDetailsBox" style="border-left:5px solid ' + (isSubmitted ? "var(--emerald)" : "var(--amber)") + ';">' +
  (isSubmitted ? (
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '  <h5 class="text-success fw-bold mb-0">🔒 Submitted Project Details</h5>' +
    '  <span class="badge-pill emerald">✓ Locked &amp; Saved</span>' +
    '</div>' +
    '<div class="mb-2"><span class="badge bg-info text-dark fw-bold px-3 py-1 fs-6">🏷️ ' + escapeHtml(team.domain || "AI/ML") + '</span></div>' +
    '<div class="small text-secondary fw-bold text-uppercase mb-1">Project Title</div>' +
    '<h5 class="text-white fw-bold mb-3 p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">' + escapeHtml(team.projectTitle || "Project Submission") + '</h5>' +
    '<div class="small text-secondary fw-bold text-uppercase mb-1">Problem Statement &amp; Solution Summary</div>' +
    '<div class="p-3 rounded mb-3 text-light" style="background:#070B19;border:1px solid #1E293B;white-space:pre-wrap;font-size:0.95rem;line-height:1.65;">' + escapeHtml(team.problemStatement || "No description provided.") + '</div>' +
    '<div class="alert py-2 small mb-0" style="background:#082F49;border:1px solid #0284C7;color:#BAE6FD;">' +
    '  <i class="bi bi-shield-check me-1"></i> <b>Cloud Secured:</b> Project permanently locked on live ledger.</div>'
  ) : (
    '<div class="d-flex justify-content-between align-items-center mb-2">' +
    '  <h5 class="text-warning fw-bold mb-0">📝 Submit Your Project Details</h5>' +
    '  <span class="badge-pill amber">1-Time Entry</span>' +
    '</div>' +
    '<p class="small text-secondary mb-3">Please submit your project domain, title, and approach. Once submitted, it will be <b>locked permanently</b>.</p>' +
    '<form id="easyProblemForm" onsubmit="handleEasySubmit(event)">' +
    '  <label class="small text-secondary fw-bold mb-1">Project Domain / Track *</label>' +
    '  <select id="easyDomain" required>' +
    '    <option value="">Choose Domain...</option>' +
    '    <option>AI/ML</option><option>Cyber Security</option><option>Cloud &amp; DevOps</option>' +
    '    <option>Web Development</option><option>IoT &amp; Smart Hardware</option>' +
    '    <option>FinTech &amp; Open Banking</option><option>Healthcare &amp; Blockchain</option><option>Agriculture &amp; ML</option>' +
    '  </select>' +
    '  <label class="small text-secondary fw-bold mb-1">Project Title *</label>' +
    '  <input type="text" id="easyTitle" placeholder="e.g. Autonomous Solar Energy Optimizer" required>' +
    '  <label class="small text-secondary fw-bold mb-1">Problem Statement &amp; Solution Approach *</label>' +
    '  <textarea id="easyPS" rows="4" placeholder="Briefly describe the problem you are solving and your solution architecture..." required></textarea>' +
    '  <button type="submit" id="easyLockBtn" class="btn-main mt-1">🔒 Submit &amp; Permanently Lock In</button>' +
    '</form>' +
    '<div id="easySubmitStatus" class="mt-2"></div>'
  )) +
  '  </div>' +
  '</div>' +

  '<!-- ================= TAB 3: TEAM MEMBERS (ZERO PII EXPOSED) ================= -->' +
  '<div class="tab-content-panel" id="tabPanel_team">' +
  '  <div class="easy-card">' +
  '    <h6 class="text-white fw-bold mb-3">👥 Registered Team Members</h6>' +
  '    <div class="d-flex flex-column gap-2">' +
  (team.leaderName ? ('<div class="d-flex align-items-center justify-content-between p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">' +
    '<div class="d-flex align-items-center gap-2"><div class="avatar-circle">' + escapeHtml(team.leaderName.charAt(0).toUpperCase()) + '</div>' +
    '<div class="fw-bold text-white">👑 ' + escapeHtml(team.leaderName) + ' <span class="badge bg-warning text-dark ms-1">Leader</span></div></div>' +
    '<span class="badge-pill emerald">Verified</span></div>') : '') +
  (team.member2Name ? ('<div class="d-flex align-items-center justify-content-between p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">' +
    '<div class="d-flex align-items-center gap-2"><div class="avatar-circle">' + escapeHtml(team.member2Name.charAt(0).toUpperCase()) + '</div>' +
    '<div class="fw-bold text-white">👤 ' + escapeHtml(team.member2Name) + '</div></div>' +
    '<span class="badge-pill emerald">Verified</span></div>') : '') +
  (team.member3Name ? ('<div class="d-flex align-items-center justify-content-between p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">' +
    '<div class="d-flex align-items-center gap-2"><div class="avatar-circle">' + escapeHtml(team.member3Name.charAt(0).toUpperCase()) + '</div>' +
    '<div class="fw-bold text-white">👤 ' + escapeHtml(team.member3Name) + '</div></div>' +
    '<span class="badge-pill emerald">Verified</span></div>') : '') +
  (team.member4Name ? ('<div class="d-flex align-items-center justify-content-between p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">' +
    '<div class="d-flex align-items-center gap-2"><div class="avatar-circle">' + escapeHtml(team.member4Name.charAt(0).toUpperCase()) + '</div>' +
    '<div class="fw-bold text-white">👤 ' + escapeHtml(team.member4Name) + '</div></div>' +
    '<span class="badge-pill emerald">Verified</span></div>') : '') +
  '    </div>' +
  '  </div>' +
  '</div>' +

  '<!-- ================= TAB 4: CERTIFICATES (If Released) ================= -->' +
  (areCertsReleased ? (
    '<div class="tab-content-panel" id="tabPanel_certs">' +
    '  <div class="easy-card text-center py-4" style="border:2px solid var(--amber);background:linear-gradient(180deg, rgba(245,158,11,0.15) 0%, rgba(15,23,42,1) 100%);">' +
    '    <div style="font-size:2.8rem;margin-bottom:4px;">🎓</div>' +
    '    <span class="badge-pill amber mb-2">OFFICIAL CREDENTIALS RELEASED</span>' +
    '    <h4 class="text-white fw-bold mb-1">' + escapeHtml(team.teamName) + '</h4>' +
    '    <div class="alert py-2 text-start my-3" style="background:#070B19;border:1px solid #1E293B;color:#BAE6FD;font-size:0.88rem;">' +
    '      🏆 <b>Standing:</b> ' + escapeHtml(teamCerts[0] ? teamCerts[0].Achievement : "Participation") + '<br/>Your official certificates are issued and digitally verifiable on Google Cloud.' +
    '    </div>' +
    '    <div class="d-flex flex-column gap-2" id="certButtonsList"></div>' +
    '  </div>' +
    '</div>'
  ) : '') +

  '<div id="easyToast" class="toast-msg"></div>' +
  '<div class="text-center text-secondary small py-2" style="font-size:0.75rem;">⚙ Synora\'26 Live Participant Pass • Google Cloud Verified</div>' +
  '</div>' +

  '<script>' +
  'var TEAM = ' + teamJson + ';' +
  'var CERTS = ' + certsJson + ';' +
  'var areCertsReleased = ' + (areCertsReleased ? "true" : "false") + ';' +
  'var verifiedMember = null;' +

  'function showTab(tabId) {' +
  '  document.querySelectorAll(".tab-btn").forEach(function(b){ b.classList.remove("active"); });' +
  '  document.querySelectorAll(".tab-content-panel").forEach(function(p){ p.classList.remove("active"); });' +
  '  var btn = document.getElementById("btnTab" + tabId.charAt(0).toUpperCase() + tabId.slice(1));' +
  '  var panel = document.getElementById("tabPanel_" + tabId);' +
  '  if (btn) btn.classList.add("active");' +
  '  if (panel) panel.classList.add("active");' +
  '}' +

  'function selectMemberToVerify(name, role) {' +
  '  document.querySelectorAll(".member-chip").forEach(function(c){ c.classList.remove("selected"); });' +
  '  if (event && event.currentTarget) event.currentTarget.classList.add("selected");' +
  '  var inputArea = document.getElementById("verifyEmailInputArea");' +
  '  var label = document.getElementById("verifyingNameLabel");' +
  '  var input = document.getElementById("quickVerifyEmail");' +
  '  label.textContent = name;' +
  '  inputArea.style.display = "block";' +
  '  input.value = "";' +
  '  input.focus();' +
  '}' +

  'function executeQuickVerify() {' +
  '  var email = (document.getElementById("quickVerifyEmail").value || "").trim().toLowerCase();' +
  '  var err = document.getElementById("quickVerifyError");' +
  '  err.style.display = "none";' +
  '  if (!email || !email.includes("@")) {' +
  '    err.textContent = "Please enter your valid registered email address."; err.style.display = "block"; return;' +
  '  }' +
  '  google.script.run' +
  '    .withSuccessHandler(function(res) {' +
  '      verifiedMember = res;' +
  '      try { localStorage.setItem("hacktrack_pass_user_" + (TEAM.qrCodeToken||TEAM.teamId), JSON.stringify(res)); } catch(e){}' +
  '      applyVerifiedState(res);' +
  '      showToast("✓ Identity verified as " + (res.viewerName || res.memberRole));' +
  '      try { confetti({ particleCount: 40, spread: 50, origin: { y: 0.4 } }); } catch(e){}' +
  '    })' +
  '    .withFailureHandler(function(e) {' +
  '      err.textContent = e.message || String(e); err.style.display = "block";' +
  '    })' +
  '    .verifyAndLoadTeamPortal(TEAM.qrCodeToken || TEAM.teamId, email);' +
  '}' +

  'function applyVerifiedState(v) {' +
  '  var badge = document.getElementById("verifiedStatusBadge");' +
  '  badge.innerHTML = \'<span class="badge-pill emerald"><i class="bi bi-patch-check-fill"></i> \' + esc(v.memberRole || "VERIFIED") + \'</span>\';' +
  '  document.getElementById("verifyEmailInputArea").style.display = "none";' +
  '  document.getElementById("memberChipsContainer").style.display = "none";' +
  '  var succ = document.getElementById("verifiedSuccessBox");' +
  '  succ.style.display = "block";' +
  '  document.getElementById("verifiedSuccessName").textContent = v.viewerEmail || v.memberRole;' +
  '  document.getElementById("verifiedSuccessRole").textContent = v.memberRole || "Member";' +
  '}' +

  'function resetVerification() {' +
  '  verifiedMember = null;' +
  '  try { localStorage.removeItem("hacktrack_pass_user_" + (TEAM.qrCodeToken||TEAM.teamId)); } catch(e){}' +
  '  document.getElementById("verifiedStatusBadge").innerHTML = \'<span class="badge-pill amber"><i class="bi bi-shield-lock"></i> VERIFICATION REQUIRED</span>\';' +
  '  document.getElementById("memberChipsContainer").style.display = "flex";' +
  '  document.getElementById("verifiedSuccessBox").style.display = "none";' +
  '  document.getElementById("verifyEmailInputArea").style.display = "none";' +
  '}' +

  'window.addEventListener("DOMContentLoaded", function() {' +
  '  // Check cached verified identity' +
  '  try {' +
  '    var cached = localStorage.getItem("hacktrack_pass_user_" + (TEAM.qrCodeToken||TEAM.teamId));' +
  '    if (cached) {' +
  '      var vObj = JSON.parse(cached);' +
  '      if (vObj && vObj.viewerEmail) {' +
  '        verifiedMember = vObj;' +
  '        applyVerifiedState(vObj);' +
  '      }' +
  '    }' +
  '  } catch(e){}' +
  '  // Render QR Code immediately' +
  '  var qrEl = document.getElementById("passQrCanvas");' +
  '  if (qrEl && typeof QRCode !== "undefined") {' +
  '    new QRCode(qrEl, {' +
  '      text: TEAM.qrCodeToken || "' + escapeHtml(lookupToken) + '",' +
  '      width: 160,' +
  '      height: 160,' +
  '      colorDark: "#070B19",' +
  '      colorLight: "#FFFFFF",' +
  '      correctLevel: QRCode.CorrectLevel.H' +
  '    });' +
  '  }' +
  '  // Render Certificate buttons' +
  '  if (areCertsReleased && CERTS.length > 0) {' +
  '    var btnList = document.getElementById("certButtonsList");' +
  '    if (btnList) {' +
  '      CERTS.forEach(function(c) {' +
  '        var b = document.createElement("button");' +
  '        b.className = "btn-soft w-100 fw-bold d-flex justify-content-between align-items-center py-2";' +
  '        b.innerHTML = "<span>📜 " + esc(c.ParticipantName) + " (" + esc(c.Role) + ")</span> <span class=\'badge bg-primary\'>🖨️ View / Print</span>";' +
  '        b.onclick = function() { printMemberCertificate(c.CertificateID, c.ParticipantName, c.Role, c.Achievement, TEAM.teamName, TEAM.college, c.VerificationToken); };' +
  '        btnList.appendChild(b);' +
  '      });' +
  '    }' +
  '    try { confetti({ particleCount: 50, spread: 60, origin: { y: 0.5 } }); } catch(e){}' +
  '  }' +
  '});' +

  'function showToast(msg) {' +
  '  var t = document.getElementById("easyToast");' +
  '  t.textContent = msg; t.style.display = "block";' +
  '  setTimeout(function(){ t.style.display = "none"; }, 2500);' +
  '}' +

  'function handleEasySubmit(e) {' +
  '  e.preventDefault();' +
  '  if (!verifiedMember || !verifiedMember.viewerEmail) {' +
  '    showToast("⚠ Please select your name and verify your email first.");' +
  '    var card = document.getElementById("easyVerificationCard");' +
  '    if (card) card.scrollIntoView({ behavior: "smooth" });' +
  '    return;' +
  '  }' +
  '  var domain = document.getElementById("easyDomain").value;' +
  '  var title = document.getElementById("easyTitle").value.trim();' +
  '  var ps = document.getElementById("easyPS").value.trim();' +
  '  var btn = document.getElementById("easyLockBtn");' +
  '  var status = document.getElementById("easySubmitStatus");' +
  '  if (!confirm("Are you sure you want to lock this project? Once submitted, it cannot be modified.")) return;' +
  '  btn.disabled = true;' +
  '  btn.innerHTML = \'<span class="spinner"></span>Locking in Google Cloud...\';' +
  '  google.script.run' +
  '    .withSuccessHandler(function() {' +
  '      var box = document.getElementById("projectDetailsBox");' +
  '      box.style.borderLeft = "5px solid var(--emerald)";' +
  '      box.innerHTML = \'<div class="d-flex justify-content-between align-items-center mb-2">\' +' +
  '        \'<h5 class="text-success fw-bold mb-0">🔒 Submitted Project Details</h5>\' +' +
  '        \'<span class="badge-pill emerald">✓ Locked &amp; Saved</span></div>\' +' +
  '        \'<div class="mb-2"><span class="badge bg-info text-dark fw-bold px-3 py-1 fs-6">🏷️ \' + esc(domain) + \'</span></div>\' +' +
  '        \'<div class="small text-secondary fw-bold text-uppercase mb-1">Project Title</div>\' +' +
  '        \'<h5 class="text-white fw-bold mb-3 p-2 rounded" style="background:#070B19;border:1px solid #1E293B;">\' + esc(title) + \'</h5>\' +' +
  '        \'<div class="small text-secondary fw-bold text-uppercase mb-1">Problem Statement &amp; Solution Summary</div>\' +' +
  '        \'<div class="p-3 rounded mb-2 text-light" style="background:#070B19;border:1px solid #1E293B;white-space:pre-wrap;font-size:0.95rem;line-height:1.65;">\' + esc(ps) + \'</div>\' +' +
  '        \'<div class="alert py-2 small mb-0" style="background:#082F49;border:1px solid #0284C7;color:#BAE6FD;">\' +' +
  '        \'<i class="bi bi-shield-check me-1"></i> <b>Cloud Secured:</b> Problem statement permanently locked on live ledger.</div>\';' +
  '      document.getElementById("btnTabProject").innerHTML = \'<i class="bi bi-code-slash"></i> Project ✓\';' +
  '      showToast("✓ Project details locked successfully!");' +
  '    })' +
  '    .withFailureHandler(function(err) {' +
  '      btn.disabled = false;' +
  '      btn.innerHTML = "🔒 Submit &amp; Permanently Lock In";' +
  '      status.innerHTML = \'<div class="alert alert-danger py-2 small">\' + (err.message||String(err)) + \'</div>\';' +
  '    })' +
  '    .submitTeamProblemDetailsVerified(TEAM.teamId, (TEAM.qrCodeToken || "' + escapeHtml(lookupToken) + '"), verifiedMember.viewerEmail, domain, title, ps);' +
  '}' +

  'function downloadPassImage() {' +
  '  var canvas = document.createElement("canvas");' +
  '  canvas.width = 400; canvas.height = 500;' +
  '  var ctx = canvas.getContext("2d");' +
  '  ctx.fillStyle = "#0F172A"; ctx.fillRect(0,0,400,500);' +
  '  ctx.fillStyle = "#06B6D4"; ctx.fillRect(0,0,400,8);' +
  '  ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 20px sans-serif"; ctx.textAlign = "center";' +
  '  ctx.fillText("SYNORA\'26 HACKPASS", 200, 45);' +
  '  ctx.fillStyle = "#94A3B8"; ctx.font = "14px sans-serif";' +
  '  ctx.fillText(TEAM.teamName + " (" + TEAM.teamId + ")", 200, 75);' +
  '  var qrImg = document.querySelector("#passQrCanvas img");' +
  '  if(qrImg) {' +
  '    ctx.drawImage(qrImg, 110, 110, 180, 180);' +
  '  }' +
  '  ctx.fillStyle = "#38BDF8"; ctx.font = "bold 15px monospace";' +
  '  ctx.fillText("TOKEN: " + (TEAM.qrCodeToken || "' + escapeHtml(lookupToken) + '"), 200, 330);' +
  '  ctx.fillStyle = "#34D399"; ctx.font = "13px sans-serif";' +
  '  ctx.fillText("✓ Verified Identity • Cloud Pass", 200, 380);' +
  '  var link = document.createElement("a");' +
  '  link.download = "HackTrack_Pass_" + TEAM.teamId + ".png";' +
  '  link.href = canvas.toDataURL("image/png");' +
  '  link.click();' +
  '  showToast("✓ Pass saved to your device photos!");' +
  '}' +

  'function printMemberCertificate(certId, name, role, achievement, teamName, college, token) {' +
  '  var printWindow = window.open("", "_blank");' +
  '  if (!printWindow) { alert("Please allow popups to view printable certificate."); return; }' +
  '  printWindow.document.write(' +
  '    "<!DOCTYPE html><html><head><title>Official Certificate - " + name + "</title>" +' +
  '    "<link rel=\'stylesheet\' href=\'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css\'>" +' +
  '    "<script src=\'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js\'><\\/script>" +' +
  '    "<style>" +' +
  '    "@page { size: landscape; margin: 10mm; }" +' +
  '    "body { background: #fff; color: #0F172A; font-family: Georgia, serif; padding: 25px; text-align: center; }" +' +
  '    ".cert-border { border: 12px double #1E3A8A; padding: 40px; border-radius: 8px; position: relative; }" +' +
  '    ".cert-title { font-size: 2.6rem; font-weight: bold; letter-spacing: 3px; color: #1E3A8A; text-transform: uppercase; margin-bottom: 5px; }" +' +
  '    ".cert-sub { font-size: 1.05rem; color: #475569; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 25px; }" +' +
  '    ".cert-name { font-size: 2.4rem; font-weight: bold; color: #0F172A; border-bottom: 2px solid #CBD5E1; display: inline-block; padding: 0 35px 6px; margin: 15px 0; }" +' +
  '    ".cert-text { font-size: 1.18rem; color: #334155; line-height: 1.6; max-width: 720px; margin: 0 auto 25px; }" +' +
  '    ".cert-meta { font-family: monospace; font-size: 0.88rem; color: #64748B; }" +' +
  '    "</style></head><body>" +' +
  '    "<div class=\'cert-border\'>" +' +
  '    "<div class=\'cert-title\'>Certificate of " + (achievement.indexOf("Winner")!==-1||achievement.indexOf("Runner")!==-1?"Excellence":"Participation") + "</div>" +' +
  '    "<div class=\'cert-sub\'>Synora\\\'26 National Flagship Hackathon</div>" +' +
  '    "<p style=\'font-style:italic;color:#64748B;margin-bottom:5px;\'>This is proudly presented to</p>" +' +
  '    "<div class=\'cert-name\'>" + name + "</div>" +' +
  '    "<div class=\'cert-text\'>of team <b>" + teamName + "</b> (" + (college||"") + ") in recognition of exemplary innovation and technical achievement in <b>Synora\\\'26 National Hackathon</b>.<br/><br/><span class=\'badge bg-primary px-3 py-2 fs-6\'>Achievement: " + achievement + "</span></div>" +' +
  '    "<div class=\'row mt-4 pt-3 border-top align-items-center\'>" +' +
  '    "<div class=\'col-4 text-start\'><div class=\'fw-bold\'>Dr. Arvind Kumar</div><div class=\'small text-muted\'>Convener, Synora\\\'26</div></div>" +' +
  '    "<div class=\'col-4 text-center\'><div id=\'pCertQr\' class=\'d-inline-block bg-white p-1\'></div><div class=\'cert-meta mt-1\'>ID: " + certId + "</div></div>" +' +
  '    "<div class=\'col-4 text-end\'><div class=\'fw-bold\'>Prof. R. S. Sharma</div><div class=\'small text-muted\'>Jury Head &amp; Dean</div></div>" +' +
  '    "</div>" +' +
  '    "</div>" +' +
  '    "<script>" +' +
  '    "window.onload = function() {" +' +
  '    "  new QRCode(document.getElementById(\'pCertQr\'), { text: \'" + certId + ":" + token + "\', width: 75, height: 75, correctLevel: QRCode.CorrectLevel.H });" +' +
  '    "  setTimeout(function(){ window.print(); }, 400);" +' +
  '    "};" +' +
  '    "<\\/script>" +' +
  '    "</body></html>"' +
  '  );' +
  '  printWindow.document.close();' +
  '}' +

  'function esc(s) {' +
  '  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#039;");' +
  '}' +
  '</script>' +
  '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setTitle(team.teamName + " — Synora'26 Pass")
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
  var teams = getTeams(ss, { _internal: true });
  var team = null;
  for (var i = 0; i < teams.length; i++) {
    if (teams[i].teamId === teamId || teams[i].qrCodeToken === token) {
      team = teams[i];
      break;
    }
  }
  if (!team) throw new Error("TEAM_NOT_FOUND: Team not found.");

  // Check ownership: must be active admin, active organizer, or a registered team member
  var users = getSheetObjects(ss.getSheetByName(SHEETS.USERS));
  var callerUser = null;
  for (var u = 0; u < users.length; u++) {
    if (String(users[u].Email || "").trim().toLowerCase() === verifiedEmail) {
      callerUser = users[u];
      break;
    }
  }

  var isStaff = callerUser &&
    String(callerUser.Status || "").toLowerCase() === "active" &&
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
 * ==========================================================================
 * Enterprise Architecture: Telemetry, Auditing & Bulk Ingestion
 * ==========================================================================
 */

function getSystemHealth(ss, data) {
  ss = ss || getSpreadsheet();
  var start = new Date().getTime();
  
  var counts = {};
  var allSheets = [
    SHEETS.USERS, SHEETS.SESSIONS, SHEETS.TEAMS, SHEETS.ATTENDANCE,
    SHEETS.JUDGE_ASSIGNMENTS, SHEETS.ROUND1, SHEETS.ROUND2,
    SHEETS.LEADERBOARD, SHEETS.CERTIFICATES, SHEETS.ACTIVITY_LOGS,
    SHEETS.LOGIN_ATTEMPTS, SHEETS.SCORE_AUDIT
  ];

  allSheets.forEach(function(sName) {
    var sh = ss.getSheetByName(sName);
    counts[sName] = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  });

  var sessSheet = ss.getSheetByName(SHEETS.SESSIONS);
  var sessRows = sessSheet ? getSheetObjects(sessSheet) : [];
  var activeSessions = sessRows.filter(function(s) {
    return String(s.Status).toUpperCase() === "ACTIVE" && new Date(s.ExpiresAt) > new Date();
  }).length;

  var elapsedMs = new Date().getTime() - start;

  return {
    status: "HEALTHY",
    version: "3.5.0-ENTERPRISE",
    serverTimestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss z"),
    databaseUrl: ss.getUrl(),
    latencyMs: elapsedMs,
    activeSessionsCount: activeSessions,
    tableRecords: counts,
    security: {
      passwordHashing: "SHA-256 (64-character hex)",
      qrSigning: "HMAC-SHA256 Cryptographic Tokens",
      rateLimiting: "5 attempts / 15-min rolling window",
      concurrencyEngine: "Atomic Script Mutex Lock (LockService)",
      cacheLayer: "Tiered ScriptCache (TTL 180s)"
    }
  };
}

function getScoreAuditLogs(ss, data) {
  ss = ss || getSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.SCORE_AUDIT);
  return getSheetObjects(sheet);
}

function bulkRegisterTeams(ss, data) {
  return withScriptLock(function() {
    ss = ss || getSpreadsheet();
    data = data || {};
    var rawTeams = data.teams || [];
    if (!Array.isArray(rawTeams) || rawTeams.length === 0) {
      throw new Error("VALIDATION_ERROR: 'teams' must be a non-empty array of team objects.");
    }

    var registered = [];
    var errors = [];

    rawTeams.forEach(function(t) {
      try {
        var res = registerTeam(ss, Object.assign({}, t, { _session: data._session }));
        registered.push(res);
      } catch (err) {
        errors.push({ teamName: t.teamName, error: err.message });
      }
    });

    return {
      success: true,
      registeredCount: registered.length,
      errorCount: errors.length,
      registered: registered,
      errors: errors
    };
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
