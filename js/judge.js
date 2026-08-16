/**
 * HackTrack | Synora'26 — Judge Portal Logic (2 Rounds, 100 Marks Each)
 * Jury Matrix, Dynamic Multi-Criteria Evaluation & Strict Duplicate Prevention
 */

const Judge = {
  currentTeam: null,
  currentRound: 'round1',

  async initDashboard() {
    if (!Auth.requireRole('judge')) return;

    const session = Auth.getSession();
    const welcomeEl = document.getElementById('judgeWelcomeName');
    const specEl = document.getElementById('judgeSpecTag');

    if (welcomeEl && session) welcomeEl.textContent = session.name;
    if (specEl && session) specEl.textContent = session.specialization || "Jury Panelist";

    await this.renderJudgeMatrix();
  },

  async renderJudgeMatrix() {
    const session = Auth.getSession();
    if (!session) return;

    try {
      const teams = await API.request('getTeams');
      const configs = await API.request('getRoundConfig');
      const r1Evals = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R1) || '[]');
      const r2Evals = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEYS.EVALUATIONS_R2) || '[]');

      const isR1Active = configs.find(c => c.roundId === 'round1')?.status === 'active';
      const isR2Active = configs.find(c => c.roundId === 'round2')?.status === 'active';

      const pillR1 = document.getElementById('statusPillR1');
      const pillR2 = document.getElementById('statusPillR2');

      if (pillR1) {
        pillR1.className = `ht-badge ${isR1Active ? 'badge-active' : 'badge-locked'}`;
        pillR1.textContent = isR1Active ? 'Active' : 'Locked';
      }
      if (pillR2) {
        pillR2.className = `ht-badge ${isR2Active ? 'badge-active' : 'badge-locked'}`;
        pillR2.textContent = isR2Active ? 'Active' : 'Locked';
      }

      const tbody = document.getElementById('judgeTeamsMatrixBody');
      if (!tbody) return;

      tbody.innerHTML = teams.map(t => {
        const e1 = r1Evals.find(e => e.judgeId === session.userId && e.teamId === t.teamId);
        const e2 = r2Evals.find(e => e.judgeId === session.userId && e.teamId === t.teamId);

        const getBadge = (evalObj, isActive, roundKey) => {
          if (!isActive) {
            return `<span class="ht-badge badge-disabled"><i class="bi bi-lock-fill"></i> Locked</span>`;
          }
          if (evalObj) {
            return `<span class="ht-badge badge-active"><i class="bi bi-check-circle-fill"></i> ${evalObj.total}/100</span>`;
          }
          return `<a href="evaluate.html?teamId=${t.teamId}&round=${roundKey}" class="btn-table-action btn-action-primary"><i class="bi bi-pencil-square"></i> Evaluate</a>`;
        };

        const totalScore = (e1 ? e1.total : 0) + (e2 ? e2.total : 0);

        return `
          <tr>
            <td><span class="team-id-badge">${t.teamId}</span></td>
            <td>
              <div class="team-title-cell">
                <a href="team-details.html?teamId=${t.teamId}" class="team-name-text text-primary">${t.teamName}</a>
                <span class="project-title-sub">${t.projectTitle || 'Pending Statement'}</span>
              </div>
            </td>
            <td><span class="domain-badge">${t.domain || 'TBD'}</span></td>
            <td>${getBadge(e1, isR1Active, 'round1')}</td>
            <td>${getBadge(e2, isR2Active, 'round2')}</td>
            <td><b class="mono fs-6 text-primary">${totalScore}</b> / 200</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.error(e);
    }
  },

  async initEvaluationPage() {
    if (!Auth.requireRole('judge')) return;

    const params = new URLSearchParams(window.location.search);
    const teamId = params.get('teamId') || 'HT2026001';
    const roundId = params.get('round') || 'round1';
    this.currentRound = roundId;

    try {
      const team = await API.request('getTeam', { teamId });
      this.currentTeam = team;

      document.getElementById('evalTeamName').textContent = team.teamName;
      document.getElementById('evalTeamId').textContent = team.teamId;
      document.getElementById('evalLeaderName').textContent = team.leaderName;
      document.getElementById('evalCollege').textContent = team.college;
      document.getElementById('evalDepartment').textContent = team.department;
      document.getElementById('evalProjectTitle').textContent = team.projectTitle || 'Pending Statement';
      document.getElementById('evalDomain').textContent = team.domain || 'TBD';
      document.getElementById('evalProblemStatement').textContent = team.problemStatement || 'Pending Release';

      const configs = await API.request('getRoundConfig');
      const roundConfig = configs.find(c => c.roundId === roundId);
      const roundTitleEl = document.getElementById('evalRoundTitle');
      if (roundTitleEl) roundTitleEl.textContent = roundConfig ? roundConfig.roundName : roundId.toUpperCase();

      if (roundConfig && roundConfig.status !== 'active') {
        document.getElementById('evalFormWrapper').innerHTML = `
          <div class="alert alert-danger border-danger p-4 text-center">
            <i class="bi bi-lock-fill fs-1 text-danger mb-2"></i>
            <h4>Round is Currently Locked</h4>
            <p>This evaluation round is locked by administrators. Scoring access will be enabled once announced.</p>
            <a href="dashboard.html" class="btn-ht-primary mt-2">Return to Dashboard</a>
          </div>
        `;
        return;
      }

      // Duplicate Submission Check: Judge ID + Team ID + Round
      const session = Auth.getSession();
      const storageKey = roundId === 'round2' ? CONFIG.STORAGE_KEYS.EVALUATIONS_R2 : CONFIG.STORAGE_KEYS.EVALUATIONS_R1;
      const existingEvals = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const alreadyEval = existingEvals.find(e => e.judgeId === session.userId && e.teamId === teamId);

      if (alreadyEval) {
        document.getElementById('evalFormWrapper').innerHTML = `
          <div class="alert alert-success border-success p-4">
            <div class="d-flex align-items-center gap-3">
              <i class="bi bi-check-circle-fill fs-1 text-success"></i>
              <div>
                <h4 class="fw-bold mb-1">Score Already Submitted</h4>
                <p class="mb-0">You have already submitted an evaluation for <b>${team.teamName}</b> in <b>${roundId.toUpperCase()}</b> on <span class="mono">${alreadyEval.timestamp}</span>.</p>
                <div class="mt-2 fs-5 fw-bold text-primary">Final Total: ${alreadyEval.total} / 100</div>
              </div>
            </div>
            <hr>
            <p class="small text-muted mb-3"><b>Comments:</b> ${alreadyEval.comments || 'No written comments provided.'}</p>
            <a href="dashboard.html" class="btn-ht-primary">Return to Jury Dashboard</a>
          </div>
        `;
        return;
      }

      this.renderScoringCriteria(roundId);

      const submitBtn = document.getElementById('openSubmitModalBtn');
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          const total = this.calculateTotal();
          document.getElementById('confirmModalTeamName').textContent = team.teamName;
          document.getElementById('confirmModalTotal').textContent = `${total} / 100`;
          Utils.openModal('evalConfirmModal');
        });
      }

      const confirmSubmitBtn = document.getElementById('finalConfirmSubmitBtn');
      if (confirmSubmitBtn) {
        confirmSubmitBtn.addEventListener('click', async () => {
          await this.submitScores();
        });
      }

    } catch (e) {
      Utils.showToast(e.message, "danger");
    }
  },

  renderScoringCriteria(roundId) {
    const roundDef = roundId === 'round2' ? CONFIG.ROUNDS.ROUND_2 : CONFIG.ROUNDS.ROUND_1;
    const container = document.getElementById('criteriaContainer');
    if (!container) return;

    container.innerHTML = roundDef.criteria.map((crit, idx) => `
      <div class="scoring-criterion-card">
        <div class="criterion-header">
          <div>
            <div class="criterion-title">${idx + 1}. ${crit.name}</div>
            <div class="criterion-desc">${crit.desc}</div>
          </div>
          <div class="criterion-score-badge" id="badge_c${idx + 1}">20 / ${crit.max}</div>
        </div>
        <div class="score-slider-wrap">
          <input type="range" class="score-range-input" id="range_c${idx + 1}" min="0" max="${crit.max}" value="20" 
                 oninput="Judge.syncScore(${idx + 1}, this.value)">
          <input type="number" class="ht-input score-number-input" id="num_c${idx + 1}" min="0" max="${crit.max}" value="20" 
                 oninput="Judge.syncScore(${idx + 1}, this.value)">
        </div>
      </div>
    `).join('');

    this.calculateTotal();
  },

  syncScore(index, value) {
    let num = parseInt(value, 10);
    if (isNaN(num)) num = 0;
    if (num < 0) num = 0;
    if (num > 25) num = 25;

    const range = document.getElementById(`range_c${index}`);
    const numInput = document.getElementById(`num_c${index}`);
    const badge = document.getElementById(`badge_c${index}`);

    if (range) range.value = num;
    if (numInput) numInput.value = num;
    if (badge) badge.textContent = `${num} / 25`;

    this.calculateTotal();
  },

  calculateTotal() {
    let total = 0;
    for (let i = 1; i <= 4; i++) {
      const el = document.getElementById(`num_c${i}`);
      if (el) total += parseInt(el.value, 10) || 0;
    }

    const totalEl = document.getElementById('liveTotalScoreDisplay');
    if (totalEl) totalEl.textContent = `${total} / 100`;
    return total;
  },

  async submitScores() {
    const session = Auth.getSession();
    const c1 = parseInt(document.getElementById('num_c1')?.value, 10) || 0;
    const c2 = parseInt(document.getElementById('num_c2')?.value, 10) || 0;
    const c3 = parseInt(document.getElementById('num_c3')?.value, 10) || 0;
    const c4 = parseInt(document.getElementById('num_c4')?.value, 10) || 0;
    const comments = document.getElementById('evalCommentsInput')?.value.trim() || '';

    try {
      const result = await API.request('submitEvaluation', {
        round: this.currentRound,
        judgeId: session.userId,
        judgeName: session.name,
        teamId: this.currentTeam.teamId,
        teamName: this.currentTeam.teamName,
        c1, c2, c3, c4,
        comments
      });

      // Synchronize in local storage immediately
      const storageKey = this.currentRound === 'round2' ? CONFIG.STORAGE_KEYS.EVALUATIONS_R2 : CONFIG.STORAGE_KEYS.EVALUATIONS_R1;
      let evals = JSON.parse(localStorage.getItem(storageKey) || '[]');
      evals = evals.filter(e => !(e.judgeId === session.userId && e.teamId === this.currentTeam.teamId));
      evals.push({
        evalId: (result && result.evalId) || `EV-${this.currentRound.toUpperCase()}-${Date.now()}`,
        judgeId: session.userId,
        judgeName: session.name,
        teamId: this.currentTeam.teamId,
        teamName: this.currentTeam.teamName,
        c1, c2, c3, c4,
        total: (c1 + c2 + c3 + c4),
        comments,
        timestamp: new Date().toLocaleString()
      });
      localStorage.setItem(storageKey, JSON.stringify(evals));

      Utils.closeModal('evalConfirmModal');
      Utils.showToast(`✓ Evaluation (${c1 + c2 + c3 + c4}/100) submitted and locked in Google Cloud!`, "success");
      setTimeout(() => {
        window.location.href = 'dashboard.html';
      }, 600);
    } catch (err) {
      Utils.closeModal('evalConfirmModal');
      Utils.showToast(err.message, "danger");
    }
  },

  async initTeamDetailsPage() {
    if (!Auth.requireRole(['judge', 'admin', 'organizer'])) return;
    const params = new URLSearchParams(window.location.search);
    const teamId = params.get('teamId') || 'HT2026001';

    try {
      const team = await API.request('getTeam', { teamId });
      document.getElementById('detailTeamName').textContent = team.teamName;
      document.getElementById('detailTeamId').textContent = team.teamId;
      document.getElementById('detailProjectTitle').textContent = team.projectTitle || 'Pending Statement';
      document.getElementById('detailDomain').textContent = team.domain || 'TBD';
      document.getElementById('detailProblemStatement').textContent = team.problemStatement || 'Pending Release';
      document.getElementById('detailCollege').textContent = `${team.college} • ${team.department}`;

      document.getElementById('detailLeader').textContent = `${team.leaderName} (${team.leaderEmail})`;
      document.getElementById('detailM2').textContent = team.member2Name ? `${team.member2Name} (${team.member2Email})` : 'Not Registered';
      document.getElementById('detailM3').textContent = team.member3Name ? `${team.member3Name} (${team.member3Email})` : 'Not Registered';
      document.getElementById('detailM4').textContent = team.member4Name ? `${team.member4Name} (${team.member4Email})` : 'Not Registered';
    } catch (e) {
      Utils.showToast(e.message, 'danger');
    }
  }
};

if (typeof window !== "undefined") {
  window.Judge = Judge;
}
