/**
 * HackTrack | Synora'26 — Admin Portal Logic (2-Round Architecture)
 * Dashboard Stats, Domain Distribution Chart, Workflow Controls, User & Audit Management
 */

const Admin = {
  domainChart: null,

  async initDashboard() {
    if (!Auth.requireRole('admin')) return;

    await this.loadStats();
    await this.loadWorkflowStatus();
    this.renderDomainChart();
  },

  async loadStats() {
    try {
      const stats = await API.request('getDashboardStats');
      
      const elTeams = document.getElementById('stat-total-teams');
      const elParts = document.getElementById('stat-total-participants');
      const elAtt = document.getElementById('stat-attendance-rate');
      const elRounds = document.getElementById('stat-round-status');

      if (elTeams) elTeams.textContent = stats.totalTeams;
      if (elParts) elParts.textContent = stats.totalParticipants;
      if (elAtt) elAtt.textContent = stats.attendanceRate;
      if (elRounds) elRounds.textContent = `${stats.r1Count} / ${stats.r2Count}`;

      window._currentStats = stats;
    } catch (e) {
      console.error("Failed to load dashboard stats", e);
    }
  },

  async renderDomainChart() {
    const canvas = document.getElementById('domainChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const stats = window._currentStats || await API.request('getDashboardStats');
    const domainCounts = stats.domainCounts || {};

    const labels = Object.keys(domainCounts);
    const data = Object.values(domainCounts);

    const colors = [
      '#2563EB', '#06B6D4', '#10B981', '#F59E0B', '#8B5CF6',
      '#EC4899', '#3B82F6', '#14B8A6', '#F97316', '#6366F1'
    ];

    if (this.domainChart) this.domainChart.destroy();

    this.domainChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['Pending Submission'],
        datasets: [{
          data: data.length ? data : [1],
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#131E33' : '#FFFFFF'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              font: { family: 'Plus Jakarta Sans', size: 12 },
              color: document.documentElement.getAttribute('data-theme') === 'dark' ? '#94A3B8' : '#475569'
            }
          }
        },
        cutout: '65%'
      }
    });
  },

  async loadWorkflowStatus() {
    try {
      const configs = await API.request('getRoundConfig');
      configs.forEach(c => {
        const toggle = document.getElementById(`toggle-${c.roundId}`);
        if (toggle) {
          toggle.checked = (c.status === 'active');
        }
      });
    } catch (e) {
      console.error("Error loading workflow status", e);
    }
  },

  async handleToggleRound(roundId, checkbox) {
    const status = checkbox.checked ? 'active' : 'disabled';
    try {
      await API.request('updateRoundStatus', { roundId, status });
      Utils.showToast(`Workflow updated: ${roundId.replace('_', ' ').toUpperCase()} is now ${status.toUpperCase()}`, 'success');
    } catch (e) {
      checkbox.checked = !checkbox.checked;
      Utils.showToast(e.message, 'danger');
    }
  },

  async exportReport(type, format) {
    try {
      if (type === 'attendance') {
        const data = await API.request('getAttendance');
        if (format === 'csv') Utils.exportToCsv('Synora26_Attendance_Report.csv', data);
        else window.print();
      } else if (type === 'round1') {
        const evals = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1) || '[]');
        if (format === 'csv') Utils.exportToCsv('Synora26_Round1_Marks.csv', evals);
        else window.print();
      } else if (type === 'round2') {
        const evals = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2) || '[]');
        if (format === 'csv') Utils.exportToCsv('Synora26_Round2_Marks.csv', evals);
        else window.print();
      } else if (type === 'leaderboard') {
        const lb = await API.request('getLeaderboard');
        if (format === 'csv') Utils.exportToCsv('Synora26_Final_Leaderboard.csv', lb);
        else window.print();
      }
    } catch (e) {
      Utils.showToast("Export failed: " + e.message, "danger");
    }
  },

  async initUsers() {
    if (!Auth.requireRole('admin')) return;
    await this.renderUserTables();

    const form = document.getElementById('createUserForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('newUserName').value.trim();
        const email = document.getElementById('newUserEmail').value.trim();
        const password = document.getElementById('newUserPassword').value.trim() || 'admin';
        const role = document.getElementById('newUserRole').value;
        const specialization = document.getElementById('newUserSpec').value.trim();

        try {
          await API.request('createUser', { name, email, password, role, specialization });
          Utils.showToast(`User account for ${name} created successfully!`, 'success');
          form.reset();
          Utils.closeModal('createUserModal');
          await this.renderUserTables();
        } catch (err) {
          Utils.showToast(err.message, 'danger');
        }
      });
    }
  },

  async renderUserTables() {
    const users = await API.request('getUsers');
    const orgTbody = document.getElementById('organizersTableBody');
    const jdgTbody = document.getElementById('judgesTableBody');

    if (orgTbody) {
      const orgs = users.filter(u => u.role.toLowerCase() === 'organizer');
      orgTbody.innerHTML = orgs.map(u => `
        <tr>
          <td><b>${u.name}</b></td>
          <td>${u.email}</td>
          <td><span class="ht-badge badge-info">${u.specialization || 'Operations'}</span></td>
          <td><span class="mono">${Utils.formatDate(u.createdAt)}</span></td>
          <td>
            <button class="btn-table-action btn-action-danger" onclick="Admin.deleteUser('${u.userId}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No organizers found.</td></tr>`;
    }

    if (jdgTbody) {
      const judges = users.filter(u => u.role.toLowerCase() === 'judge');
      jdgTbody.innerHTML = judges.map(u => `
        <tr>
          <td><b>${u.name}</b></td>
          <td>${u.email}</td>
          <td><span class="ht-badge badge-primary">${u.specialization || 'General'}</span></td>
          <td><span class="mono">${Utils.formatDate(u.createdAt)}</span></td>
          <td>
            <button class="btn-table-action btn-action-danger" onclick="Admin.deleteUser('${u.userId}')">
              <i class="bi bi-trash"></i> Delete
            </button>
          </td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No judges found.</td></tr>`;
    }
  },

  async deleteUser(userId) {
    if (confirm(`Are you sure you want to delete user ${userId}?`)) {
      try {
        await API.request('deleteUser', { userId });
        Utils.showToast("User deleted successfully.", "success");
        await this.renderUserTables();
      } catch (e) {
        Utils.showToast(e.message, "danger");
      }
    }
  },

  async initActivityLogs() {
    if (!Auth.requireRole('admin')) return;
    const logs = await API.request('getActivityLogs');
    const tbody = document.getElementById('activityLogsTableBody');
    if (!tbody) return;

    const render = (items) => {
      tbody.innerHTML = items.map(l => `
        <tr>
          <td class="mono" style="font-size:0.8rem;">${l.timestamp}</td>
          <td><b>${l.userName}</b></td>
          <td><span class="ht-badge ${l.role === 'admin' ? 'badge-danger' : (l.role === 'judge' ? 'badge-primary' : 'badge-info')}">${l.role.toUpperCase()}</span></td>
          <td><span class="ht-badge badge-active">${l.action}</span></td>
          <td style="font-size:0.85rem;">${l.details}</td>
        </tr>
      `).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No activity logs recorded yet.</td></tr>`;
    };

    render(logs);

    const searchInput = document.getElementById('logSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = logs.filter(l => 
          l.userName.toLowerCase().includes(query) ||
          l.action.toLowerCase().includes(query) ||
          l.details.toLowerCase().includes(query) ||
          l.role.toLowerCase().includes(query)
        );
        render(filtered);
      });
    }
  }
};

if (typeof window !== "undefined") {
  window.Admin = Admin;
}
