/**
 * HackTrack | Synora'26 — Organizer Portal Logic
 * Registration Engine (with Strong QR Token), Event Operations Console & Round Workflow Switches
 */

const Organizer = {
  async initDashboard() {
    if (!Auth.requireRole('organizer')) return;

    try {
      const stats = await API.request('getDashboardStats');
      const elReg = document.getElementById('stat-registered-teams');
      const elPres = document.getElementById('stat-checkedin-teams');
      const elPend = document.getElementById('stat-pending-teams');

      if (elReg) elReg.textContent = stats.totalTeams;
      if (elPres) elPres.textContent = stats.checkedInTeams;
      if (elPend) elPend.textContent = stats.pendingCheckIn;

      await this.loadWorkflowSwitches();
    } catch (e) {
      console.error("Organizer Dashboard init error", e);
    }
  },

  async loadWorkflowSwitches() {
    try {
      const configs = await API.request('getRoundConfig');
      configs.forEach(c => {
        const toggle = document.getElementById(`toggle-${c.roundId}`);
        const badge = document.getElementById(`badge-${c.roundId}`);
        if (toggle) {
          toggle.checked = (c.status === 'active');
        }
        if (badge) {
          badge.className = `ht-badge ${c.status === 'active' ? 'badge-active' : 'badge-locked'}`;
          badge.innerHTML = `<i class="bi ${c.status === 'active' ? 'bi-unlock-fill' : 'bi-lock-fill'}"></i> ${c.status === 'active' ? 'UNLOCKED / ACTIVE' : 'LOCKED'}`;
        }
      });
    } catch (e) {
      console.error("Error loading workflow switches", e);
    }
  },

  async handleToggleRound(roundId, checkbox) {
    const status = checkbox.checked ? 'active' : 'disabled';
    const badge = document.getElementById(`badge-${roundId}`);

    try {
      await API.request('updateRoundStatus', { roundId, status });
      if (badge) {
        badge.className = `ht-badge ${status === 'active' ? 'badge-active' : 'badge-locked'}`;
        badge.innerHTML = `<i class="bi ${status === 'active' ? 'bi-unlock-fill' : 'bi-lock-fill'}"></i> ${status === 'active' ? 'UNLOCKED / ACTIVE' : 'LOCKED'}`;
      }
      Utils.showToast(`✓ Google Cloud Updated: ${roundId.replace('_', ' ').toUpperCase()} is now ${status === 'active' ? 'UNLOCKED' : 'LOCKED'}!`, 'success');
    } catch (e) {
      checkbox.checked = !checkbox.checked;
      Utils.showToast(e.message, 'danger');
    }
  },

  initRegistrationForm() {
    if (!Auth.requireRole('organizer')) return;

    const domainSelect = document.getElementById('regDomain');
    if (domainSelect) {
      domainSelect.innerHTML = `<option value="TBD">Domain TBD (To be selected via Team QR Portal)</option>` + 
        CONFIG.DOMAINS.map(d => `<option value="${d}">${d}</option>`).join('');
    }

    const form = document.getElementById('teamRegistrationForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const teamName = document.getElementById('regTeamName').value.trim();
        const college = document.getElementById('regCollege').value.trim();
        const department = document.getElementById('regDepartment').value.trim();
        const domain = document.getElementById('regDomain') ? document.getElementById('regDomain').value : 'TBD';

        const leaderName = document.getElementById('regLeaderName').value.trim();
        const leaderEmail = document.getElementById('regLeaderEmail').value.trim();
        const leaderPhone = document.getElementById('regLeaderPhone').value.trim();

        const member2Name = document.getElementById('regM2Name').value.trim();
        const member2Email = document.getElementById('regM2Email').value.trim();
        const member2Phone = document.getElementById('regM2Phone').value.trim();

        const member3Name = document.getElementById('regM3Name').value.trim();
        const member3Email = document.getElementById('regM3Email').value.trim();
        const member3Phone = document.getElementById('regM3Phone').value.trim();

        const member4Name = document.getElementById('regM4Name').value.trim();
        const member4Email = document.getElementById('regM4Email').value.trim();
        const member4Phone = document.getElementById('regM4Phone').value.trim();

        if (!teamName || !college || !department || !leaderName || !leaderEmail) {
          Utils.showToast("Please fill in Team Name, College, Department, and Leader Info (*)", "warning");
          return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(leaderEmail)) {
          Utils.showToast("Please enter a valid Team Leader email address.", "danger");
          return;
        }

        const session = Auth.getSession();

        try {
          const newTeam = await API.request('registerTeam', {
            teamName,
            domain: domain || "TBD",
            projectTitle: "Pending Statement Submission",
            problemStatement: "Pending Organizer Release",
            college,
            department,
            leaderName,
            leaderEmail,
            leaderPhone,
            member2Name,
            member2Email,
            member2Phone,
            member3Name,
            member3Email,
            member3Phone,
            member4Name,
            member4Email,
            member4Phone,
            markedBy: session ? session.name : "Organizer Desk"
          });

          // Render Strong QR pass pointing to Live Cloud Web App URL
          document.getElementById('regSuccessTeamName').textContent = newTeam.teamName;
          document.getElementById('regSuccessTeamId').textContent = newTeam.teamId;
          document.getElementById('regSuccessToken').textContent = newTeam.qrCodeToken;
          const elPass = document.getElementById('regSuccessPassword');
          if (elPass) elPass.textContent = newTeam.teamPassword || "N/A";

          let portalUrl = "";
          if (CONFIG.API_URL && CONFIG.API_URL.startsWith("http")) {
            portalUrl = `${CONFIG.API_URL}?page=team&teamId=${newTeam.teamId}&token=${newTeam.qrCodeToken}`;
          } else {
            const origin = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
            const rootPath = origin.replace('/organizer', '');
            portalUrl = `${rootPath}/team-portal.html?teamId=${newTeam.teamId}&token=${newTeam.qrCodeToken}`;
          }

          Utils.renderQrCode('regSuccessQrCanvas', portalUrl, 200, 200);

          const portalLink = document.getElementById('regSuccessPortalLink');
          if (portalLink) {
            portalLink.href = portalUrl;
          }

          Utils.openModal('registrationSuccessModal');
          form.reset();
          Utils.showToast(`✓ Team '${newTeam.teamName}' saved in Google Cloud Database!`, 'success');
        } catch (err) {
          Utils.showToast(err.message, 'danger');
        }
      });
    }
  },

  async initRoundsMonitor() {
    if (!Auth.requireRole('organizer')) return;
    await this.loadWorkflowSwitches();

    try {
      const configs = await API.request('getRoundConfig');
      const stats = await API.request('getDashboardStats');

      const tbody = document.getElementById('juryRoundsStatusBody');
      if (tbody) {
        tbody.innerHTML = configs.map(c => {
          let count = 0;
          if (c.roundId === 'round1') count = stats.r1Count;
          if (c.roundId === 'round2') count = stats.r2Count;

          return `
            <tr>
              <td><b>${c.roundName}</b></td>
              <td>${c.description}</td>
              <td>
                <span class="ht-badge ${c.status === 'active' ? 'badge-active' : 'badge-locked'}">
                  ${c.status === 'active' ? 'UNLOCKED / ACTIVE' : 'LOCKED'}
                </span>
              </td>
              <td><b>${c.roundId === 'problem_statements' ? 'All Registered Teams' : `${count} / ${stats.totalTeams} evaluated`}</b></td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {
      console.error(e);
    }
  }
};

if (typeof window !== "undefined") {
  window.Organizer = Organizer;
}
