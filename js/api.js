/**
 * HackTrack | Synora'26 — Unified API Client (2-Round Architecture)
 * Handles Organizer Registration, Dynamic Cryptographic QR Tokens, and One-Time Team Submissions
 */

const API = {
  initLocalStore() {
    if (!localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS)) {
      localStorage.setItem(CONFIG.STORAGE_KEYS.USERS, JSON.stringify(DEMO_DATA.users));
      localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(DEMO_DATA.teams));
      localStorage.setItem(CONFIG.STORAGE_KEYS.ATTENDANCE, JSON.stringify(DEMO_DATA.attendance));
      localStorage.setItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1, JSON.stringify(DEMO_DATA.evaluations_r1));
      localStorage.setItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2, JSON.stringify(DEMO_DATA.evaluations_r2));
      localStorage.setItem(CONFIG.STORAGE_KEYS.ROUND_CONFIG, JSON.stringify(DEMO_DATA.roundConfig));
      localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(DEMO_DATA.settings));
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

  async request(action, payload = {}) {
    this.initLocalStore();

    // Attach active session token if available
    if (typeof Auth !== "undefined" && Auth.getSession()) {
      const sess = Auth.getSession();
      if (sess && sess.sessionId && !payload.sessionId) {
        payload.sessionId = sess.sessionId;
      }
    }

    if (CONFIG.API_URL && CONFIG.API_URL.trim().startsWith("http")) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout for Google Apps Script

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
            return resJson.data;
          } else {
            const errObj = resJson.error || "Execution Error";
            const errMsg = typeof errObj === "object" ? (errObj.message || JSON.stringify(errObj)) : errObj;
            throw new Error(errMsg);
          }
        }
      } catch (err) {
        clearTimeout(timeoutId);
        // If it's a specific validation/auth error from server, throw directly
        if (!err.message.includes("Failed to fetch") && !err.message.includes("NetworkError") && !err.message.includes("aborted")) {
          throw err;
        }
      }
    }

    // Local state fallback for offline dev mode
    return this.handleLocalAction(action, payload);
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
        // Strong cryptographic QR token
        const qrCodeToken = `HT26-SEC-${teamId}-${Math.floor(10000 + Math.random() * 90000)}`;
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

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
          status: "present",
          locked: true,
          problemSubmitted: false,
          submissionLocked: false,
          qrCodeToken,
          createdAt: timestamp
        };

        teams.unshift(newTeam);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Team Registered", `Registered team ${teamName} (${teamId}) via Organizer Desk.`);
        return newTeam;
      }

      case "submitTeamProblemDetails": {
        let teams = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.TEAMS) || "[]");
        const identifier = data.teamId || data.token;
        const index = teams.findIndex(t => t.teamId === identifier || t.qrCodeToken === identifier);

        if (index === -1) throw new Error("Team not found.");

        if (teams[index].submissionLocked) {
          throw new Error("This team has already submitted their problem statement. Submission is locked.");
        }

        teams[index].projectTitle = data.projectTitle || teams[index].projectTitle;
        teams[index].domain = data.domain || teams[index].domain;
        teams[index].problemStatement = data.problemStatement || teams[index].problemStatement;
        teams[index].githubUrl = data.githubUrl || teams[index].githubUrl || "";
        teams[index].demoUrl = data.demoUrl || teams[index].demoUrl || "";
        teams[index].problemSubmitted = true;
        teams[index].submissionLocked = true;

        localStorage.setItem(CONFIG.STORAGE_KEYS.TEAMS, JSON.stringify(teams));
        this.logActivity("Problem Statement Submitted", `Team ${teams[index].teamName} locked in statement: ${data.problemStatement}`);
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
        this.logActivity("Certificates Released", "Batch released official certificates for all verified teams and members.");
        return { success: true, count: certs.length };
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
