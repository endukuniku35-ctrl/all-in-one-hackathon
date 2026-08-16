/**
 * HackTrack | Synora'26 — Master Teams Manager (Admin & Organizer)
 * Search, Filters, Cryptographic QR Pass Generation, Lock/Unlock & Role-Based Editing
 */

const Teams = {
  allTeams: [],

  async init(role = 'admin') {
    if (!Auth.requireRole([role, 'admin', 'organizer'])) return;
    await this.loadTeams(role);
    this.setupFilters(role);
    this.setupEditForm(role);
  },

  async loadTeams(role = 'admin') {
    try {
      this.allTeams = await API.request('getTeams');
      this.renderTable(this.allTeams, role);
      this.populateDomainFilter();
    } catch (e) {
      console.error("Error fetching teams", e);
    }
  },

  renderTable(teams, role = 'admin') {
    const tbody = document.getElementById('teamsTableBody');
    if (!tbody) return;

    if (!teams.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No teams match the search criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = teams.map(t => {
      let memberCount = 1;
      if (t.member2Name) memberCount++;
      if (t.member3Name) memberCount++;
      if (t.member4Name) memberCount++;

      const isLocked = t.locked;
      const isProblemSubmitted = t.problemSubmitted || t.submissionLocked;

      return `
        <tr>
          <td><span class="team-id-badge">${t.teamId}</span></td>
          <td>
            <div class="team-title-cell">
              <span class="team-name-text">${t.teamName} <span class="badge-primary ht-badge" style="font-size:0.68rem;">${memberCount} Members</span></span>
              <span class="project-title-sub" title="${t.projectTitle}">${t.projectTitle || 'Pending Statement'}</span>
              <div style="margin-top: 4px; display:flex; gap:6px; align-items:center;">
                <span class="domain-badge">${t.domain || 'TBD'}</span>
                <span class="ht-badge ${isProblemSubmitted ? 'badge-active' : 'badge-warning'}" style="font-size:0.65rem;">
                  ${isProblemSubmitted ? '✓ PS Locked' : 'PS Pending'}
                </span>
              </div>
            </div>
          </td>
          <td>
            <div class="contact-cell">
              <span class="contact-name">${t.college}</span>
              <span class="contact-sub">${t.department}</span>
            </div>
          </td>
          <td>
            <div class="contact-cell">
              <span class="contact-name"><i class="bi bi-person-fill text-primary"></i> ${t.leaderName}</span>
              <span class="contact-sub"><i class="bi bi-envelope"></i> ${t.leaderEmail}</span>
              <span class="contact-sub"><i class="bi bi-telephone"></i> ${t.leaderPhone || '-'}</span>
            </div>
          </td>
          <td>
            <button class="btn-table-action" onclick="Teams.showQrModal('${t.teamId}', '${t.teamName}', '${t.qrCodeToken}')">
              <i class="bi bi-qr-code"></i> View QR Pass
            </button>
          </td>
          <td>
            <span class="ht-badge ${isLocked ? 'badge-locked' : 'badge-active'}">
              <i class="bi ${isLocked ? 'bi-lock-fill' : 'bi-unlock-fill'}"></i> ${isLocked ? 'Locked' : 'Unlocked'}
            </span>
          </td>
          <td>
            <div class="table-actions-group">
              <button class="btn-table-action" title="View Team Dossier" onclick="Teams.viewTeamDetails('${t.teamId}')">
                <i class="bi bi-eye"></i> View
              </button>
              <button class="btn-table-action btn-action-primary" title="Edit Team (Admin/Organizer)" onclick="Teams.openEditModal('${t.teamId}')">
                <i class="bi bi-pencil-square"></i> Edit
              </button>
              ${role === 'admin' ? `
                <button class="btn-table-action" title="Toggle Lock Status" onclick="Teams.toggleLock('${t.teamId}')">
                  <i class="bi ${isLocked ? 'bi-unlock' : 'bi-lock'}"></i> ${isLocked ? 'Unlock' : 'Lock'}
                </button>
                <button class="btn-table-action btn-action-danger" title="Delete Team" onclick="Teams.deleteTeam('${t.teamId}')">
                  <i class="bi bi-trash"></i>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  setupFilters(role) {
    const searchInput = document.getElementById('teamSearchInput');
    const domainSelect = document.getElementById('domainFilterSelect');
    const statusSelect = document.getElementById('statusFilterSelect');

    const applyFilter = () => {
      const q = (searchInput ? searchInput.value : '').toLowerCase();
      const domain = domainSelect ? domainSelect.value : '';
      const status = statusSelect ? statusSelect.value : '';

      const filtered = this.allTeams.filter(t => {
        const matchesQuery = 
          t.teamName.toLowerCase().includes(q) ||
          t.teamId.toLowerCase().includes(q) ||
          t.leaderName.toLowerCase().includes(q) ||
          t.college.toLowerCase().includes(q) ||
          (t.projectTitle && t.projectTitle.toLowerCase().includes(q));

        const matchesDomain = !domain || t.domain === domain;
        const matchesStatus = !status || (status === 'locked' && t.locked) || (status === 'unlocked' && !t.locked);

        return matchesQuery && matchesDomain && matchesStatus;
      });

      this.renderTable(filtered, role);
    };

    if (searchInput) searchInput.addEventListener('input', applyFilter);
    if (domainSelect) domainSelect.addEventListener('change', applyFilter);
    if (statusSelect) statusSelect.addEventListener('change', applyFilter);
  },

  populateDomainFilter() {
    const domainSelect = document.getElementById('domainFilterSelect');
    if (!domainSelect) return;

    domainSelect.innerHTML = `<option value="">All Domains</option>` + 
      CONFIG.DOMAINS.map(d => `<option value="${d}">${d}</option>`).join('');
  },

  showQrModal(teamId, teamName, qrToken) {
    document.getElementById('qrModalTeamName').textContent = teamName;
    document.getElementById('qrModalTeamId').textContent = teamId;
    document.getElementById('qrModalTokenText').textContent = qrToken;

    // Use Live Cloud Web App URL so any mobile phone can scan from anywhere in the world!
    let portalUrl = "";
    if (CONFIG.API_URL && CONFIG.API_URL.startsWith("http")) {
      portalUrl = `${CONFIG.API_URL}?page=team&teamId=${teamId}&token=${qrToken}`;
    } else {
      const origin = window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
      const rootPath = origin.replace('/admin', '').replace('/organizer', '');
      portalUrl = `${rootPath}/team-portal.html?teamId=${teamId}&token=${qrToken}`;
    }

    const linkEl = document.getElementById('qrModalPortalLink');
    if (linkEl) {
      linkEl.href = portalUrl;
      linkEl.textContent = `Open Live Cloud Team Portal (${teamId})`;
    }

    Utils.renderQrCode('qrModalCanvas', portalUrl, 200, 200);
    Utils.openModal('teamQrModal');
  },

  async viewTeamDetails(teamId) {
    try {
      const team = await API.request('getTeam', { teamId });
      const modalBody = document.getElementById('viewTeamModalBody');
      if (!modalBody) return;

      modalBody.innerHTML = `
        <div class="mb-3">
          <div class="d-flex justify-content-between align-items-center">
            <h4 class="mb-0 text-primary">${team.teamName}</h4>
            <span class="team-id-badge">${team.teamId}</span>
          </div>
          <p class="text-muted mt-1"><i class="bi bi-geo-alt"></i> ${team.college} • ${team.department}</p>
        </div>

        <div class="ht-card mb-3 p-3 bg-subtle">
          <div class="small fw-bold text-muted text-uppercase">Project Abstract & Domain</div>
          <div class="fw-bold fs-6 mt-1">${team.projectTitle}</div>
          <div class="mt-2"><span class="domain-badge">${team.domain}</span></div>
          <p class="small text-secondary mt-2 mb-0"><b>Problem Statement:</b> ${team.problemStatement}</p>
        </div>

        <h6 class="fw-bold mb-2">Team Members Roster</h6>
        <div class="list-group mb-3">
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <span class="badge bg-primary me-2">Leader</span> <b>${team.leaderName}</b>
              <div class="small text-muted">${team.leaderEmail} • ${team.leaderPhone || 'No Phone'}</div>
            </div>
          </div>
          ${team.member2Name ? `
            <div class="list-group-item">
              <div><b>${team.member2Name}</b></div>
              <div class="small text-muted">${team.member2Email} • ${team.member2Phone || '-'}</div>
            </div>
          ` : ''}
          ${team.member3Name ? `
            <div class="list-group-item">
              <div><b>${team.member3Name}</b></div>
              <div class="small text-muted">${team.member3Email} • ${team.member3Phone || '-'}</div>
            </div>
          ` : ''}
          ${team.member4Name ? `
            <div class="list-group-item">
              <div><b>${team.member4Name}</b></div>
              <div class="small text-muted">${team.member4Email} • ${team.member4Phone || '-'}</div>
            </div>
          ` : ''}
        </div>
      `;

      Utils.openModal('viewTeamModal');
    } catch (e) {
      Utils.showToast(e.message, 'danger');
    }
  },

  async openEditModal(teamId) {
    try {
      const team = await API.request('getTeam', { teamId });
      document.getElementById('editTeamId').value = team.teamId;
      document.getElementById('editTeamName').value = team.teamName;
      document.getElementById('editProjectTitle').value = team.projectTitle || '';
      document.getElementById('editDomain').value = team.domain || '';
      document.getElementById('editProblemStatement').value = team.problemStatement || '';
      document.getElementById('editCollege').value = team.college || '';
      document.getElementById('editDepartment').value = team.department || '';
      document.getElementById('editLeaderName').value = team.leaderName || '';
      document.getElementById('editLeaderEmail').value = team.leaderEmail || '';
      document.getElementById('editLeaderPhone').value = team.leaderPhone || '';

      document.getElementById('editM2Name').value = team.member2Name || '';
      document.getElementById('editM2Email').value = team.member2Email || '';
      document.getElementById('editM3Name').value = team.member3Name || '';
      document.getElementById('editM3Email').value = team.member3Email || '';
      document.getElementById('editM4Name').value = team.member4Name || '';
      document.getElementById('editM4Email').value = team.member4Email || '';

      Utils.openModal('editTeamModal');
    } catch (e) {
      Utils.showToast(e.message, 'danger');
    }
  },

  setupEditForm(role) {
    const form = document.getElementById('editTeamForm');
    if (!form) return;

    // Populate domain select
    const domainSelect = document.getElementById('editDomain');
    if (domainSelect) {
      domainSelect.innerHTML = `<option value="">Select Domain</option>` + 
        CONFIG.DOMAINS.map(d => `<option value="${d}">${d}</option>`).join('');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const teamId = document.getElementById('editTeamId').value;
      const teamName = document.getElementById('editTeamName').value.trim();
      const projectTitle = document.getElementById('editProjectTitle').value.trim();
      const domain = document.getElementById('editDomain').value;
      const problemStatement = document.getElementById('editProblemStatement').value.trim();
      const college = document.getElementById('editCollege').value.trim();
      const department = document.getElementById('editDepartment').value.trim();
      const leaderName = document.getElementById('editLeaderName').value.trim();
      const leaderEmail = document.getElementById('editLeaderEmail').value.trim();
      const leaderPhone = document.getElementById('editLeaderPhone').value.trim();

      const member2Name = document.getElementById('editM2Name').value.trim();
      const member2Email = document.getElementById('editM2Email').value.trim();
      const member3Name = document.getElementById('editM3Name').value.trim();
      const member3Email = document.getElementById('editM3Email').value.trim();
      const member4Name = document.getElementById('editM4Name').value.trim();
      const member4Email = document.getElementById('editM4Email').value.trim();

      try {
        await API.request('updateTeam', {
          teamId,
          teamName,
          projectTitle,
          domain,
          problemStatement,
          college,
          department,
          leaderName,
          leaderEmail,
          leaderPhone,
          member2Name,
          member2Email,
          member3Name,
          member3Email,
          member4Name,
          member4Email
        });

        Utils.closeModal('editTeamModal');
        Utils.showToast(`Team ${teamName} updated successfully by ${role.toUpperCase()}!`, 'success');
        await this.loadTeams(role);
      } catch (err) {
        Utils.showToast(err.message, 'danger');
      }
    });
  },

  async toggleLock(teamId) {
    try {
      const updated = await API.request('unlockTeam', { teamId });
      Utils.showToast(`Team ${teamId} is now ${updated.locked ? 'LOCKED' : 'UNLOCKED'}.`, 'info');
      await this.loadTeams('admin');
    } catch (e) {
      Utils.showToast(e.message, 'danger');
    }
  },

  async deleteTeam(teamId) {
    if (confirm(`Are you sure you want to permanently delete team ${teamId}? This action cannot be undone.`)) {
      try {
        await API.request('deleteTeam', { teamId });
        Utils.showToast(`Team ${teamId} deleted.`, 'success');
        await this.loadTeams('admin');
      } catch (e) {
        Utils.showToast(e.message, 'danger');
      }
    }
  }
};

if (typeof window !== "undefined") {
  window.Teams = Teams;
}
