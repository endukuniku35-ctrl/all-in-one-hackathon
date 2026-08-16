/**
 * HackTrack | Synora'26 — Leaderboard, Standings & Winner Declaration (2 Rounds, 200 Max)
 * Multi-Judge Score Aggregation, 3D Podium & Winner Security Lock
 */

const Leaderboard = {
  standings: [],

  async init() {
    await this.loadLeaderboard();
    this.setupSearch();
    this.checkWinnerLockStatus();
  },

  async loadLeaderboard() {
    try {
      this.standings = await API.request('getLeaderboard');
      this.renderPodium(this.standings.slice(0, 3));
      this.renderTable(this.standings);
    } catch (e) {
      console.error("Leaderboard load failed", e);
    }
  },

  renderPodium(top3) {
    const gold = top3[0] || { teamName: "TBD", leaderName: "-", grandTotal: 0, college: "-" };
    const silver = top3[1] || { teamName: "TBD", leaderName: "-", grandTotal: 0, college: "-" };
    const bronze = top3[2] || { teamName: "TBD", leaderName: "-", grandTotal: 0, college: "-" };

    const podiumContainer = document.getElementById('podiumWrapper');
    if (!podiumContainer) return;

    podiumContainer.innerHTML = `
      <!-- 2nd Place Silver -->
      <div class="podium-card silver">
        <div>
          <div class="podium-badge">🥈</div>
          <div class="podium-rank-tag">2nd Place Silver</div>
          <h3 class="podium-team-name">${silver.teamName}</h3>
          <p class="podium-leader"><i class="bi bi-person-fill"></i> ${silver.leaderName}<br><span class="small text-muted">${silver.college}</span></p>
        </div>
        <div class="podium-score-box">
          <div class="small fw-bold text-muted text-uppercase">Grand Total</div>
          <div class="podium-score-value">${silver.grandTotal.toFixed(1)} <span class="fs-6 text-muted">/ 200</span></div>
        </div>
      </div>

      <!-- 1st Place Gold -->
      <div class="podium-card gold">
        <div>
          <div class="podium-badge">🥇</div>
          <div class="podium-rank-tag">1st Place Champion</div>
          <h3 class="podium-team-name">${gold.teamName}</h3>
          <p class="podium-leader"><i class="bi bi-person-fill"></i> ${gold.leaderName}<br><span class="small text-muted">${gold.college}</span></p>
        </div>
        <div class="podium-score-box">
          <div class="small fw-bold text-muted text-uppercase">Grand Total</div>
          <div class="podium-score-value">${gold.grandTotal.toFixed(1)} <span class="fs-6 text-muted">/ 200</span></div>
        </div>
      </div>

      <!-- 3rd Place Bronze -->
      <div class="podium-card bronze">
        <div>
          <div class="podium-badge">🥉</div>
          <div class="podium-rank-tag">3rd Place Bronze</div>
          <h3 class="podium-team-name">${bronze.teamName}</h3>
          <p class="podium-leader"><i class="bi bi-person-fill"></i> ${bronze.leaderName}<br><span class="small text-muted">${bronze.college}</span></p>
        </div>
        <div class="podium-score-box">
          <div class="small fw-bold text-muted text-uppercase">Grand Total</div>
          <div class="podium-score-value">${bronze.grandTotal.toFixed(1)} <span class="fs-6 text-muted">/ 200</span></div>
        </div>
      </div>
    `;
  },

  renderTable(list) {
    const tbody = document.getElementById('leaderboardTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No ranked teams found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(t => `
      <tr>
        <td>
          <span class="mono fw-bold fs-6 ${t.rank <= 3 ? 'text-primary' : 'text-muted'}">#${t.rank}</span>
        </td>
        <td>
          <div class="team-title-cell">
            <span class="team-name-text">${t.teamName}</span>
            <span class="small text-muted">${t.domain || 'TBD'}</span>
          </div>
        </td>
        <td><b>${t.leaderName}</b></td>
        <td><span class="small">${t.college}</span></td>
        <td class="score-cell-value">${t.round1.toFixed(1)}</td>
        <td class="score-cell-value">${t.round2.toFixed(1)}</td>
        <td class="grand-total-highlight">${t.grandTotal.toFixed(1)} <span class="small text-muted">/ 200</span></td>
      </tr>
    `).join('');
  },

  setupSearch() {
    const search = document.getElementById('leaderboardSearchInput');
    if (search) {
      search.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        const filtered = this.standings.filter(t => 
          t.teamName.toLowerCase().includes(q) ||
          t.leaderName.toLowerCase().includes(q) ||
          t.college.toLowerCase().includes(q) ||
          (t.domain && t.domain.toLowerCase().includes(q))
        );
        this.renderTable(filtered);
      });
    }
  },

  async checkWinnerLockStatus() {
    const settings = await API.request('getSettings');
    const lockBanner = document.getElementById('winnerLockBanner');
    const declareBtn = document.getElementById('declareWinnersBtn');

    if (settings.areWinnersDeclared) {
      if (lockBanner) lockBanner.style.display = 'flex';
      if (declareBtn) {
        declareBtn.disabled = true;
        declareBtn.innerHTML = `<i class="bi bi-check2-all"></i> Winners Officially Declared`;
      }
    }
  },

  openDeclareWinnersModal() {
    Utils.openModal('declareWinnersModal');
  },

  async confirmDeclareWinners() {
    try {
      await API.request('declareWinners');
      Utils.closeModal('declareWinnersModal');
      Utils.showToast("🏆 Official Winners Declared & Rankings Locked!", "success");
      await this.checkWinnerLockStatus();
    } catch (e) {
      Utils.showToast(e.message, "danger");
    }
  }
};

if (typeof window !== "undefined") {
  window.Leaderboard = Leaderboard;
}
