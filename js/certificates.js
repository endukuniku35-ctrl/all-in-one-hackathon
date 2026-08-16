/**
 * HackTrack | Synora'26 — Certificate Generation & Management Engine
 * Canvas Certificate Renderer, Asset Upload & Batch Release
 */

const Certificates = {
  teams: [],
  certs: [],

  /**
   * Initialize Certificate Management Page
   */
  async init() {
    if (!Auth.requireRole('admin')) return;
    await this.loadData();
    this.setupAssetForm();
  },

  async loadData() {
    try {
      this.teams = await API.request('getTeams');
      this.certs = await API.request('getCertificates');
      this.renderTable();
    } catch (e) {
      console.error(e);
    }
  },

  renderTable() {
    const tbody = document.getElementById('certificatesTableBody');
    if (!tbody) return;

    tbody.innerHTML = this.teams.map((t, idx) => {
      const teamCerts = this.certs.filter(c => c.teamId === t.teamId);
      const isReleased = teamCerts.length > 0;

      let memberCount = 1;
      if (t.member2Name) memberCount++;
      if (t.member3Name) memberCount++;
      if (t.member4Name) memberCount++;

      return `
        <tr>
          <td>
            <div class="team-title-cell">
              <span class="team-name-text">${t.teamName}</span>
              <span class="small text-muted">${t.projectTitle}</span>
            </div>
          </td>
          <td>${t.college}</td>
          <td><b>${memberCount}</b> Members</td>
          <td>
            <span class="ht-badge ${isReleased ? 'badge-released' : 'badge-pending'}">
              <i class="bi ${isReleased ? 'bi-check-circle-fill' : 'bi-clock-fill'}"></i>
              ${isReleased ? `${memberCount} Released` : 'Pending'}
            </span>
          </td>
          <td>
            <div class="table-actions-group">
              <button class="btn-table-action btn-action-primary" onclick="Certificates.previewCertificate('${t.teamId}', '${t.leaderName}', 'Team Leader & Lead Developer')">
                <i class="bi bi-award"></i> View Leader Cert
              </button>
              ${t.member2Name ? `
                <button class="btn-table-action" onclick="Certificates.previewCertificate('${t.teamId}', '${t.member2Name}', 'Core Team Developer')">
                  <i class="bi bi-person"></i> M2
                </button>
              ` : ''}
              ${t.member3Name ? `
                <button class="btn-table-action" onclick="Certificates.previewCertificate('${t.teamId}', '${t.member3Name}', 'Core Team Developer')">
                  <i class="bi bi-person"></i> M3
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  /**
   * Render Live Certificate on HTML5 Canvas
   */
  previewCertificate(teamId, participantName, roleTitle = "Team Member") {
    const team = this.teams.find(t => t.teamId === teamId);
    if (!team) return;

    const certId = `CERT-HT-2026-${teamId.replace('HT2026', '')}01`;
    document.getElementById('certModalName').textContent = participantName;
    document.getElementById('certModalId').textContent = certId;

    const canvas = document.getElementById('certCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 1200;
    canvas.height = 850;

    // Background Gradient & Outer Border
    const bgGrad = ctx.createLinearGradient(0, 0, 1200, 850);
    bgGrad.addColorStop(0, '#FFFFFF');
    bgGrad.addColorStop(1, '#F8FAFC');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1200, 850);

    // Decorative Borders
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth = 14;
    ctx.strokeRect(20, 20, 1160, 810);

    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.strokeRect(32, 32, 1136, 786);

    // Gold Corner Accents
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(20, 20, 40, 40);
    ctx.fillRect(1140, 20, 40, 40);
    ctx.fillRect(20, 790, 40, 40);
    ctx.fillRect(1140, 790, 40, 40);

    // Header Branding
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2563EB';
    ctx.font = '800 24px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("SYNORA'26 NATIONAL FLAGSHIP HACKATHON", 600, 110);

    ctx.fillStyle = '#0F172A';
    ctx.font = '800 44px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("CERTIFICATE OF EXCELLENCE", 600, 175);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("THIS IS PROUDLY PRESENTED TO", 600, 230);

    // Participant Name
    ctx.fillStyle = '#1E3A8A';
    ctx.font = 'bold 42px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(participantName, 600, 305);

    // Divider Line
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(350, 330);
    ctx.lineTo(850, 330);
    ctx.stroke();

    // Body Text
    ctx.fillStyle = '#334155';
    ctx.font = '400 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`representing team "${team.teamName}" from ${team.college}`, 600, 380);
    ctx.fillText(`for developing the project "${team.projectTitle}"`, 600, 415);
    ctx.fillText(`in the domain of ${team.domain} during the 36-hour Synora'26 Innovation Hackathon.`, 600, 450);

    // Verification Footer Elements
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748B';
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillText(`CERTIFICATE ID: ${certId}`, 80, 740);
    ctx.fillText(`VERIFIED ON: 16-AUG-2026`, 80, 765);

    // Signatures
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("Dr. Rachel Adams", 950, 715);
    ctx.fillStyle = '#64748B';
    ctx.font = '14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText("Chief Convener & Jury Chair", 950, 740);

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(820, 690);
    ctx.lineTo(1080, 690);
    ctx.stroke();

    Utils.openModal('viewCertModal');
  },

  downloadCurrentCertificate() {
    const canvas = document.getElementById('certCanvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `Synora26_Certificate_${document.getElementById('certModalName').textContent.replace(/\s+/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    Utils.showToast("Certificate downloaded successfully!", "success");
  },

  async releaseAllCertificates() {
    if (confirm("Are you sure you want to approve and release certificates for all registered teams?")) {
      try {
        await API.request('releaseCertificates');
        Utils.showToast("✓ All certificates successfully released to participants!", "success");
        await this.loadData();
      } catch (e) {
        Utils.showToast(e.message, "danger");
      }
    }
  },

  setupAssetForm() {
    const btn = document.getElementById('saveCertAssetsBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        Utils.showToast("Certificate template branding assets saved.", "success");
      });
    }
  }
};

if (typeof window !== "undefined") {
  window.Certificates = Certificates;
}
