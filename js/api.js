/**
 * HackTrack | Synora'26 — Unified API Client (2-Round Architecture)
 * Handles Organizer Registration, Dynamic Cryptographic QR Tokens, and One-Time Team Submissions
 */

const API = {
  initLocalStore() {
    if (!localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS)) {
      const teams = DEMO_DATA.teams.map(t => {
        const cleanTeamName = t.teamName.replace(/[^a-zA-Z0-9]/g, "");
        const cleanLeaderName = (t.leaderName || "").replace(/[^a-zA-Z0-9]/g, "");
        const cleanMobile = (t.leaderPhone || "").replace(/\D/g, "");
        const part1 = cleanTeamName.slice(0, 4);
        const part2 = cleanLeaderName.slice(0, 4);
        const part3 = cleanMobile.length >= 4 ? cleanMobile.slice(-4) : cleanMobile;
        t.teamPassword = part1 + part2 + part3;
        return t;
      });
      localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(DEMO_DATA.users));
      localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
      localStorage.setItem(CONFIG.STORAGE_KEYS.ATTENDANCE, JSON.stringify(DEMO_DATA.attendance));
      localStorage.setItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1, JSON.stringify(DEMO_DATA.evaluations_r1));
      localStorage.setItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2, JSON.stringify(DEMO_DATA.evaluations_r2));
      localStorage.setItem(CONFIG.STORAGE_KEYS.ROUND_CONFIG, JSON.stringify(DEMO_DATA.roundConfig));
      localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify({ ...DEMO_DATA.settings, currentStage: "REGISTRATION" }));
      localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(DEMO_DATA.activityLogs));

      const certs = [];
      DEMO_DATA.teams.slice(0, 5).forEach((t, i) => {
        certs.push({
          certId: `CERT-HT-2026-000${i+1}`,
          teamId: t.teamId,
          teamName: t.teamName,
          participantName: t.leaderName,
          status: "RELEASED",
          releasedAt: "2026-08-16 18:00:00"
        });
      });
      localStorage.setItem(CONFIG.STORAGE_KEYS.CERTIFICATES, JSON.stringify(certs));
    }
  },

  // In-memory client cache for fast tab-switching during peak events
  _clientCache: new Map(),

  async request(action, payload = {}) {
    this.initLocalStore();

    // Attach active session token if available
    if (typeof Auth !== "undefined" && Auth.getSession()) {
      const sess = Auth.getSession();
      if (sess && sess.sessionId && !payload.sessionId) {
        payload.sessionId = sess.sessionId;
      }
    }

    // Client cache check for read-only actions (30s TTL)
    const isReadAction = ["getRoundConfig", "getSettings", "getLeaderboard"].includes(action);
    const cacheKey = `${action}_${JSON.stringify(payload)}`;
    if (isReadAction && this._clientCache.has(cacheKey)) {
      const cached = this._clientCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 30000) {
        return cached.data;
      }
    }

    if (CONFIG.API_URL && CONFIG.API_URL.trim().startsWith("http")) {
      const MAX_RETRIES = 3;
      let lastError = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          // Exponential backoff + randomized jitter (400ms, 1000ms, 2200ms + 0-200ms)
          const baseDelay = Math.min(2500, Math.pow(2.5, attempt) * 160);
          const jitter = Math.random() * 200;
          await new Promise(r => setTimeout(r, baseDelay + jitter));
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for high-concurrency peak

        try {
          const response = await fetch(CONFIG.API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action, ...payload }),
            redirect: "follow",
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            const resJson = await response.json();
            if (resJson.success) {
              if (isReadAction) {
                this._clientCache.set(cacheKey, { data: resJson.data, timestamp: Date.now() });
              } else {
                this._clientCache.clear(); // Clear client cache on any write
              }
              return resJson.data;
            } else {
              const errObj = resJson.error || "Execution Error";
              const errMsg = typeof errObj === "object" ? (errObj.message || JSON.stringify(errObj)) : errObj;
              // Don't retry validation or auth failures
              if (errMsg.includes("AUTH_REQUIRED") || errMsg.includes("ACCESS_DENIED") || errMsg.includes("VALIDATION_ERROR") || errMsg.includes("INVALID_CREDENTIALS")) {
                throw new Error(errMsg);
              }
              lastError = new Error(errMsg);
            }
          } else {
            lastError = new Error(`HTTP_${response.status}: Server busy`);
          }
        } catch (err) {
          clearTimeout(timeoutId);
          // If it's a permanent auth/validation error, throw directly
          if (err.message.includes("AUTH_REQUIRED") || err.message.includes("ACCESS_DENIED") || err.message.includes("VALIDATION_ERROR") || err.message.includes("INVALID_CREDENTIALS")) {
            throw err;
          }
          lastError = err;
        }
      }

      // All retries exhausted.
      // In production mode (DEMO_MODE off), throw an error — never silently swap to a local database.
      // This prevents judges/organizers from believing data was saved when the backend was unreachable.
      if (!CONFIG.DEMO_MODE) {
        throw new Error(
          "BACKEND_UNAVAILABLE: The cloud backend could not be reached after " + MAX_RETRIES + " attempts. " +
          "Please check your internet connection and try again. Do NOT refresh — your data has NOT been saved."
        );
      }

      // DEMO_MODE only: fall back to local store for offline development
      console.warn("[HackTrack] Backend unreachable — falling back to local demo store (DEMO_MODE).");
    }

    // DEMO_MODE: local state fallback for offline / offline dev mode
    if (CONFIG.DEMO_MODE || !CONFIG.API_URL || !CONFIG.API_URL.trim().startsWith("http")) {
      return this.handleLocalAction(action, payload);
    }

    // Should not reach here in production
    throw new Error("CONFIGURATION_ERROR: No API URL configured and DEMO_MODE is not enabled.");
  },

  handleLocalAction(action, data) {
    switch (action) {
      case "login": {
        const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || "[]");
        const email = (data.email || "").trim().toLowerCase();
        const pwd = (data.password || "").trim();
        const role = (data.role || "").trim().toLowerCase();

        const user = users.find(u => u.email.toLowerCase() === email);
        if (!user) throw new Error("No user registered with this email.");
        if (user.password !== pwd) throw new Error("Incorrect password provided.");
        if (role && user.role.toLowerCase() !== role) {
          throw new Error(`Unauthorized role! Your registered role is: ${user.role.toUpperCase()}`);
        }
        this.logActivity("User Login", `${user.name} logged into ${user.role} portal.`);
        return {
          userId: user.userId,
          name: user.name,
          email: user.email,
          role: user.role,
          specialization: user.specialization || ""
        };
      }

      case "getDashboardStats": {
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const att = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ATTENDANCE) || "[]");
        const r1 = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1) || "[]");
        const r2 = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2) || "[]");

        let totalParticipants = 0;
        teams.forEach(t => {
          let count = 1;
          if (t.member2Name) count++;
          if (t.member3Name) count++;
          if (t.member4Name) count++;
          totalParticipants += count;
        });

        const checkedInTeams = att.length;
        const totalTeams = teams.length;
        const attRate = totalTeams > 0 ? ((checkedInTeams / totalTeams) * 100).toFixed(1) : "0.0";

        const domainCounts = {};
        teams.forEach(t => {
          if (t.domain && t.domain !== 'TBD') {
            domainCounts[t.domain] = (domainCounts[t.domain] || 0) + 1;
          }
        });

        return {
          totalTeams,
          totalParticipants,
          attendanceRate: `${attRate}%`,
          checkedInTeams,
          pendingCheckIn: Math.max(0, totalTeams - checkedInTeams),
          r1Count: new Set(r1.map(e => e.teamId)).size,
          r2Count: new Set(r2.map(e => e.teamId)).size,
          domainCounts
        };
      }

      case "getTeams": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
      }

      case "getTeam": {
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const identifier = data.teamId || data.token;
        const team = teams.find(t => t.teamId === identifier || t.qrCodeToken === identifier);
        if (!team) throw new Error(`Team not found matching '${identifier}'.`);
        return team;
      }

      case "registerTeam": {
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const teamName = (data.teamName || "").trim();
        const leaderEmail = (data.leaderEmail || "").trim().toLowerCase();

        if (teams.some(t => t.teamName.toLowerCase() === teamName.toLowerCase())) {
          throw new Error(`A team named '${teamName}' already exists.`);
        }
        if (teams.some(t => t.leaderEmail.toLowerCase() === leaderEmail)) {
          throw new Error(`Leader email '${leaderEmail}' is already registered.`);
        }

        const count = teams.length + 1;
        const teamId = `HT2026${("000" + count).slice(-3)}`;
        // Cryptographically strong high-entropy HMAC-styled V2 token
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const sig = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const tsHex = Math.floor(Date.now() / 1000).toString(16).toUpperCase();
        const qrCodeToken = `HT26-V2-${teamId}-${nonce}-${tsHex}-${sig}`;
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

        const cleanTeamName = teamName.replace(/\s+/g, "");
        const cleanLeaderName = (data.leaderName || "").replace(/\s+/g, "");
        const cleanMobile = (data.leaderPhone || "").replace(/\D+/g, "");
        const part1 = cleanTeamName.slice(0, 4);
        const part2 = cleanLeaderName.slice(0, 4);
        const part3 = cleanMobile.length >= 4 ? cleanMobile.slice(-4) : cleanMobile;
        const teamPassword = part1 + part2 + part3;

        const newTeam = {
          teamId,
          teamName,
          projectTitle: data.projectTitle || "Pending Statement Submission",
          domain: data.domain || "TBD",
          problemStatement: data.problemStatement || "Pending Organizer Release",
          college: data.college || "",
          department: data.department || "",
          leaderName: data.leaderName || "",
          leaderEmail: leaderEmail,
          leaderPhone: data.leaderPhone || "",
          member2Name: data.member2Name || "",
          member2Email: data.member2Email || "",
          member2Phone: data.member2Phone || "",
          member3Name: data.member3Name || "",
          member3Email: data.member3Email || "",
          member3Phone: data.member3Phone || "",
          member4Name: data.member4Name || "",
          member4Email: data.member4Email || "",
          member4Phone: data.member4Phone || "",
          teamPassword,
          status: "present",
          locked: true,
          problemSubmitted: false,
          submissionLocked: false,
          qrCodeToken,
          createdAt: timestamp
        };

        teams.unshift(newTeam);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Team Registered", `Registered team ${teamName} (${teamId}) via Organizer Desk. Password: ${teamPassword}`);
        return newTeam;
      }

      case "submitTeamProblemDetails":
      case "submitTeamProblemDetailsVerified": {
        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const identifier = data.teamId || data.token || data.qrCodeToken;
        const index = teams.findIndex(t => t.teamId === identifier || t.qrCodeToken === identifier);

        if (index === -1) throw new Error("Team not found.");

        if (teams[index].submissionLocked) {
          throw new Error("This team has already submitted their problem statement. Submission is permanently locked.");
        }

        const email = (data.password || data.confirmPassword || data.email || data.verifiedEmail || "").trim().toLowerCase();
        if (action === "submitTeamProblemDetailsVerified" && !email) {
          throw new Error("AUTH_REQUIRED: Registered email is required to lock in submission.");
        }

        if (email) {
          const team = teams[index];
          const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || "[]");
          const callerUser = users.find(u => u.email.toLowerCase() === email);
          const isAdminOrOrganizer = callerUser && (callerUser.role === "admin" || callerUser.role === "organizer");

          if (!isAdminOrOrganizer) {
            const isLeader = team.leaderEmail && team.leaderEmail.toLowerCase() === email;
            const isM2 = team.member2Email && team.member2Email.toLowerCase() === email;
            const isM3 = team.member3Email && team.member3Email.toLowerCase() === email;
            const isM4 = team.member4Email && team.member4Email.toLowerCase() === email;

            if (!isLeader && !isM2 && !isM3 && !isM4) {
              throw new Error("ACCESS_DENIED: The email '" + email + "' is not registered for this team.");
            }
          }
        }

        teams[index].projectTitle = data.projectTitle || data.title || teams[index].projectTitle;
        teams[index].domain = data.domain || teams[index].domain;
        teams[index].problemStatement = data.problemStatement || data.ps || teams[index].problemStatement;
        teams[index].githubUrl = data.githubUrl || teams[index].githubUrl || "";
        teams[index].demoUrl = data.demoUrl || teams[index].demoUrl || "";
        teams[index].problemSubmitted = true;
        teams[index].submissionLocked = true;

        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Problem Statement Submitted", `Team ${teams[index].teamName} locked in statement${verifiedEmail ? " by " + verifiedEmail : ""}.`);
        return teams[index];
      }

      case "updateTeam": {
        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const index = teams.findIndex(t => t.teamId === data.teamId);
        if (index === -1) throw new Error("Team not found.");
        
        teams[index] = { ...teams[index], ...data };
        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Team Updated", `Admin/Organizer updated team ${data.teamName} (${data.teamId}).`);
        return teams[index];
      }

      case "deleteTeam": {
        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        teams = teams.filter(t => t.teamId !== data.teamId);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Team Deleted", `Deleted team ${data.teamId}.`);
        return { success: true };
      }

      case "unlockTeam": {
        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const index = teams.findIndex(t => t.teamId === data.teamId);
        if (index !== -1) {
          teams[index].locked = !teams[index].locked;
          localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
          this.logActivity("Team Lock Changed", `Toggled lock status for ${data.teamId}.`);
          return teams[index];
        }
        throw new Error("Team not found.");
      }

      case "markAttendance": {
        const teamId = (data.teamId || "").trim();
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const found = teams.find(t => t.teamId === teamId || t.qrCodeToken === teamId);

        if (!found) throw new Error(`No registered team found matching '${teamId}'.`);

        const att = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ATTENDANCE) || "[]");
        const already = att.find(a => a.teamId === found.teamId);

        if (already) {
          return {
            alreadyCheckedIn: true,
            message: `Team ${found.teamName} (${found.teamId}) is already marked PRESENT.`,
            team: found,
            checkInTime: already.checkInTime
          };
        }

        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const newAtt = {
          attendanceId: `ATT-${("000" + (att.length + 1)).slice(-3)}`,
          teamId: found.teamId,
          teamName: found.teamName,
          status: "present",
          checkInTime: timestamp,
          markedBy: data.markedBy || "Alex Rivera"
        };

        att.unshift(newAtt);
        localStorage.setItem(CONFIG.STORAGE_KEYS.ATTENDANCE, JSON.stringify(att));
        this.logActivity("Attendance Check-in", `Checked in team ${found.teamName} (${found.teamId}).`);

        return {
          alreadyCheckedIn: false,
          success: true,
          message: `Team ${found.teamName} marked PRESENT successfully!`,
          team: found,
          checkInTime: timestamp
        };
      }

      case "getAttendance": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ATTENDANCE) || "[]");
      }

      case "createUser": {
        const users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || "[]");
        const email = (data.email || "").trim().toLowerCase();
        if (users.some(u => u.email.toLowerCase() === email)) {
          throw new Error("User with this email already exists.");
        }

        const newUser = {
          userId: `USR-${data.role.substring(0, 3).toUpperCase()}-${("00" + (users.length + 1)).slice(-2)}`,
          name: data.name,
          email: email,
          password: data.password || "admin",
          role: data.role.toLowerCase(),
          specialization: data.specialization || "General",
          status: "active",
          createdAt: new Date().toISOString().replace('T', ' ').substring(0, 19)
        };

        users.push(newUser);
        localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(users));
        this.logActivity("User Created", `Created ${newUser.role} user: ${newUser.name} (${newUser.email}).`);
        return newUser;
      }

      case "deleteUser": {
        let users = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || "[]");
        users = users.filter(u => u.userId !== data.userId);
        localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(users));
        this.logActivity("User Deleted", `Deleted user ${data.userId}.`);
        return { success: true };
      }

      case "getUsers": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.USERS) || "[]");
      }

      case "getRoundConfig": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ROUND_CONFIG) || "[]");
      }

      case "updateRoundStatus": {
        let configs = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ROUND_CONFIG) || "[]");
        let settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        const target = configs.find(c => c.roundId === data.roundId);
        if (target) {
          target.status = data.status;
          if (data.roundId === "round1") settings.round1Active = (data.status === "active");
          if (data.roundId === "round2") settings.round2Active = (data.status === "active");
          if (data.roundId === "problem_statements") settings.problemStatementsReleased = (data.status === "active");
          
          localStorage.setItem(CONFIG.STORAGE_KEYS.ROUND_CONFIG, JSON.stringify(configs));
          localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
          this.logActivity("Workflow Update", `${target.roundName} set to ${data.status.toUpperCase()}.`);
          return target;
        }
        throw new Error("Round not found.");
      }

      case "submitEvaluation": {
        const round = data.round || "round1";
        const key = round === "round2" ? CONFIG.STORAGE_KEYS.EVALUATIONS_R2 : CONFIG.STORAGE_KEYS.EVALUATIONS_R1;
        
        let evals = JSON.parse(localStorage.getItem(key) || "[]");

        const duplicate = evals.find(e => e.judgeId === data.judgeId && e.teamId === data.teamId);
        if (duplicate) {
          throw new Error(`You have already submitted an evaluation for team ${data.teamName} in this round.`);
        }

        const c1 = parseFloat(data.c1);
        const c2 = parseFloat(data.c2);
        const c3 = parseFloat(data.c3);
        const c4 = parseFloat(data.c4);

        if (isNaN(c1) || c1 < 0 || c1 > 25 || isNaN(c2) || c2 < 0 || c2 > 25 || isNaN(c3) || c3 < 0 || c3 > 25 || isNaN(c4) || c4 < 0 || c4 > 25) {
          throw new Error("Invalid scoring marks! Each criterion must be a number between 0 and 25.");
        }

        const total = parseFloat((c1 + c2 + c3 + c4).toFixed(2));
        if (total > 100) {
          throw new Error("Total score cannot exceed 100 marks per round.");
        }
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

        const newEval = {
          evalId: `EV-${round.toUpperCase()}-${evals.length + 1}`,
          judgeId: data.judgeId,
          judgeName: data.judgeName,
          teamId: data.teamId,
          teamName: data.teamName,
          c1, c2, c3, c4,
          total,
          comments: data.comments || "",
          timestamp
        };

        evals.push(newEval);
        localStorage.setItem(key, JSON.stringify(evals));
        this.logActivity("Score Submitted", `${data.judgeName} evaluated ${data.teamName} (${total}/100 in ${round.toUpperCase()}).`);
        return newEval;
      }

      case "getLeaderboard": {
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const r1 = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1) || "[]");
        const r2 = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2) || "[]");

        const calcAvg = (evalArray) => {
          const map = {};
          const count = {};
          evalArray.forEach(e => {
            map[e.teamId] = (map[e.teamId] || 0) + e.total;
            count[e.teamId] = (count[e.teamId] || 0) + 1;
          });
          const res = {};
          for (let tid in map) {
            res[tid] = parseFloat((map[tid] / count[tid]).toFixed(2));
            res[tid + "_count"] = count[tid];
          }
          return res;
        };

        const r1Map = calcAvg(r1);
        const r2Map = calcAvg(r2);

        const list = teams.map(t => {
          const s1 = r1Map[t.teamId] || 0;
          const s2 = r2Map[t.teamId] || 0;
          const grandTotal = parseFloat((s1 + s2).toFixed(2));
          return {
            teamId: t.teamId,
            teamName: t.teamName,
            leaderName: t.leaderName,
            college: t.college,
            department: t.department,
            domain: t.domain,
            round1: s1,
            round2: s2,
            grandTotal: grandTotal,
            r1JudgeCount: r1Map[t.teamId + "_count"] || 0,
            r2JudgeCount: r2Map[t.teamId + "_count"] || 0
          };
        });

        list.sort((a, b) => {
          if (b.grandTotal !== a.grandTotal) return b.grandTotal - a.grandTotal;
          if (b.round2 !== a.round2) return b.round2 - a.round2;
          if (b.round1 !== a.round1) return b.round1 - a.round1;
          return a.teamName.localeCompare(b.teamName);
        });

        list.forEach((item, idx) => {
          item.rank = idx + 1;
          if (idx === 0) item.winnerStatus = "1st Place Gold";
          else if (idx === 1) item.winnerStatus = "2nd Place Silver";
          else if (idx === 2) item.winnerStatus = "3rd Place Bronze";
          else item.winnerStatus = "Finalist";
        });

        return list;
      }

      case "declareWinners": {
        let settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        settings.areWinnersDeclared = true;
        settings.isLeaderboardLocked = true;
        settings.lastWinnerLockTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        this.logActivity("Winners Declared", "Grand rankings locked and official winners published.");
        return { success: true, settings };
      }

      case "getCertificates": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CERTIFICATES) || "[]");
      }

      case "releaseCertificates": {
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        let certs = [];
        teams.forEach((t, i) => {
          certs.push({
            certId: `CERT-HT-2026-${("000" + (i + 1)).slice(-4)}-LDR`,
            teamId: t.teamId,
            teamName: t.teamName,
            participantName: t.leaderName,
            role: "Team Leader",
            status: "RELEASED",
            releasedAt: new Date().toLocaleString()
          });
          if (t.member2Name) {
            certs.push({
              certId: `CERT-HT-2026-${("000" + (i + 1)).slice(-4)}-M2`,
              teamId: t.teamId,
              teamName: t.teamName,
              participantName: t.member2Name,
              role: "Core Team Member",
              status: "RELEASED",
              releasedAt: new Date().toLocaleString()
            });
          }
          if (t.member3Name) {
            certs.push({
              certId: `CERT-HT-2026-${("000" + (i + 1)).slice(-4)}-M3`,
              teamId: t.teamId,
              teamName: t.teamName,
              participantName: t.member3Name,
              role: "Core Team Member",
              status: "RELEASED",
              releasedAt: new Date().toLocaleString()
            });
          }
          if (t.member4Name) {
            certs.push({
              certId: `CERT-HT-2026-${("000" + (i + 1)).slice(-4)}-M4`,
              teamId: t.teamId,
              teamName: t.teamName,
              participantName: t.member4Name,
              role: "Core Team Member",
              status: "RELEASED",
              releasedAt: new Date().toLocaleString()
            });
          }
        });

        let settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        settings.isCertificateSystemEnabled = true;
        localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        localStorage.setItem(CONFIG.STORAGE_KEYS.CERTIFICATES, JSON.stringify(certs));
        return { success: true, count: certs.length };
      }

      case "verifyCertificate": {
        const certId = (data.certId || data.certificateId || data.id || "").trim().toUpperCase();
        const verifyToken = (data.token || data.verificationToken || "").trim().toUpperCase();

        if (!certId) throw new Error("CERTIFICATE_NOT_FOUND: Certificate ID is required for verification.");

        const certs = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.CERTIFICATES) || "[]");
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");

        let foundCert = certs.find(c => (c.certId && c.certId.toUpperCase() === certId) || (c.CertificateID && c.CertificateID.toUpperCase() === certId));

        if (!foundCert) {
          throw new Error("CERTIFICATE_NOT_FOUND: No certificate found for ID: " + certId);
        }

        if (verifyToken && foundCert.verificationToken && foundCert.verificationToken.toUpperCase() !== verifyToken) {
          throw new Error("CERTIFICATE_INVALID: Verification token does not match.");
        }

        const team = teams.find(t => t.teamId === (foundCert.teamId || foundCert.TeamID)) || {};

        return {
          valid: true,
          certificate: {
            CertificateID: foundCert.certId || foundCert.CertificateID,
            ParticipantName: foundCert.participantName || foundCert.ParticipantName,
            Role: foundCert.role || foundCert.Role || "Team Member",
            TeamID: foundCert.teamId || foundCert.TeamID,
            TeamName: foundCert.teamName || foundCert.TeamName || team.teamName || "",
            Achievement: foundCert.achievement || foundCert.Achievement || "Participation",
            Status: foundCert.status || foundCert.Status || "VALID",
            IssuedAt: foundCert.releasedAt || foundCert.IssuedAt || ""
          }
        };
      }

      case "getCurrentStage": {
        const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        return { success: true, stage: settings.CURRENT_STAGE || settings.currentStage || "REGISTRATION" };
      }

      case "authenticateTeam": {
        const teamId = (data.teamId || "").trim().toUpperCase();
        const password = (data.password || "").trim();
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const team = teams.find(t => t.teamId === teamId);
        if (!team) return { success: true, authenticated: false };
        const expected = (team.teamPassword || "").trim();
        return { success: true, authenticated: expected && expected === password };
      }

      case "getTeamPortalData": {
        const teamId = (data.teamId || "").trim().toUpperCase();
        const password = (data.password || "").trim();
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const team = teams.find(t => t.teamId === teamId);
        if (!team) throw new Error("TEAM_NOT_FOUND: Team not found.");
        const expected = (team.teamPassword || "").trim();
        if (expected !== password) throw new Error("INVALID_PASSWORD: Incorrect password.");

        const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        const stage = settings.CURRENT_STAGE || settings.currentStage || "REGISTRATION";
        const pStatus = (team.submissionLocked || team.problemSubmitted) ? "SUBMITTED" : "NOT_SUBMITTED";

        if (stage === "REGISTRATION") {
          return {
            success: true,
            stage: "REGISTRATION",
            team: {
              teamId: team.teamId,
              teamName: team.teamName,
              leader: team.leaderName,
              members: [team.leaderName, team.member2Name, team.member3Name, team.member4Name].filter(Boolean),
              status: team.status || "Successfully Registered"
            }
          };
        }

        if (stage === "PROBLEM_STATEMENT") {
          if (pStatus === "NOT_SUBMITTED") {
            return {
              success: true,
              stage: "PROBLEM_STATEMENT",
              status: "NOT_SUBMITTED",
              team: {
                teamId: team.teamId,
                teamName: team.teamName,
                leader: team.leaderName
              }
            };
          } else {
            return {
              success: true,
              stage: "PROBLEM_STATEMENT",
              status: "SUBMITTED",
              team: {
                teamId: team.teamId,
                teamName: team.teamName,
                leader: team.leaderName,
                problemStatement: team.projectTitle || "",
                problemDescription: team.problemStatement || "",
                technology: team.domain || "",
                submissionTime: team.createdAt || new Date().toLocaleString()
              },
              message: "Problem statement submitted successfully."
            };
          }
        }

        if (stage === "CERTIFICATE") {
          return {
            success: true,
            stage: "CERTIFICATE",
            certificate: team.certificateUrl || "certificate.html?certId=CERT-MOCK-" + team.teamId
          };
        }

        throw new Error("UNKNOWN_STAGE");
      }

      case "submitProblemStatement": {
        const teamId = (data.teamId || "").trim().toUpperCase();
        const password = (data.password || "").trim();
        const payload = data.data || data;

        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const index = teams.findIndex(t => t.teamId === teamId);
        if (index === -1) throw new Error("TEAM_NOT_FOUND");

        const team = teams[index];
        const expected = (team.teamPassword || "").trim();
        if (expected !== password) throw new Error("INVALID_PASSWORD");

        const settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        const stage = settings.CURRENT_STAGE || settings.currentStage || "REGISTRATION";
        if (stage !== "PROBLEM_STATEMENT") throw new Error("STAGE_LOCKED");

        if (team.submissionLocked) throw new Error("SUBMISSION_LOCKED");

        teams[index].projectTitle = payload.problemStatement;
        teams[index].problemStatement = payload.problemDescription;
        teams[index].domain = payload.technology;
        teams[index].problemSubmitted = true;
        teams[index].submissionLocked = true;

        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        return { success: true, message: "Problem statement locked." };
      }

      case "getCertificate": {
        const teamId = (data.teamId || "").trim().toUpperCase();
        const password = (data.password || "").trim();
        const teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const team = teams.find(t => t.teamId === teamId);
        if (!team) throw new Error("TEAM_NOT_FOUND");
        const expected = (team.teamPassword || "").trim();
        if (expected !== password) throw new Error("INVALID_PASSWORD");
        return { success: true, certificate: team.certificateUrl || "certificate.html?certId=CERT-MOCK-" + team.teamId };
      }

      case "verifyAndLoadTeamPortal": {
        return this.request("getTeamPortalData", {
          teamId: data.token || data.teamId,
          password: data.email || data.password
        });
      }

      case "getActivityLogs": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOGS) || "[]");
      }

      case "getSettings": {
        return JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
      }

      case "updateSettings": {
        let settings = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS) || "{}");
        settings = { ...settings, ...data };
        localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        return settings;
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  },

  logActivity(action, details) {
    try {
      const logs = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOGS) || "[]");
      const session = Auth.getSession() || { userId: "SYSTEM", name: "System Desk", role: "organizer" };
      const logId = `LOG-${("0000" + (logs.length + 1)).slice(-4)}`;
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

      logs.unshift({
        logId,
        timestamp,
        userId: session.userId,
        userName: session.name,
        role: session.role,
        action,
        details
      });

      localStorage.setItem(CONFIG.STORAGE_KEYS.ACTIVITY_LOGS, JSON.stringify(logs.slice(0, 150)));
    } catch (e) {}
  }
};

if (typeof window !== "undefined") {
  window.API = API;
  API.initLocalStore();
}
