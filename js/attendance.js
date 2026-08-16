/**
 * HackTrack | Synora'26 — QR Attendance Scanner & Logs Engine
 * Camera Scanning (Html5Qrcode) + Manual Entry + Duplicate Prevention
 */

const Attendance = {
  html5QrCode: null,
  isScanning: false,

  /**
   * Play feedback beep using Web Audio API
   */
  playBeep(success = true) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = success ? 880 : 330; // A5 for success, E4 for warning
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  },

  /**
   * Initialize Attendance Scanner Page
   */
  initScanner() {
    if (!Auth.requireRole(['organizer', 'admin'])) return;

    const startBtn = document.getElementById('startCameraBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    const manualForm = document.getElementById('manualCheckInForm');

    if (startBtn) startBtn.addEventListener('click', () => this.startCamera());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopCamera());

    if (manualForm) {
      manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('manualTeamIdInput');
        const teamId = input ? input.value.trim() : '';
        if (!teamId) {
          Utils.showToast("Please enter a valid Team ID or Token.", "warning");
          return;
        }
        await this.processAttendance(teamId);
        if (input) input.value = '';
      });
    }
  },

  /**
   * Start Live Camera
   */
  startCamera() {
    if (typeof Html5Qrcode === 'undefined') {
      Utils.showToast("QR Camera library is still loading. Please use manual entry.", "warning");
      return;
    }

    const readerEl = document.getElementById('qr-reader');
    if (!readerEl) return;

    this.html5QrCode = new Html5Qrcode("qr-reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    this.html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        // Debounce scan
        if (this._lastScanned === decodedText) return;
        this._lastScanned = decodedText;
        setTimeout(() => { this._lastScanned = null; }, 3000);

        this.processAttendance(decodedText);
      },
      (errorMessage) => {
        // Frame scan misses - silent
      }
    ).then(() => {
      this.isScanning = true;
      document.getElementById('startCameraBtn').style.display = 'none';
      document.getElementById('stopCameraBtn').style.display = 'inline-flex';
      Utils.showToast("Camera scanner active. Position QR in frame.", "info");
    }).catch(err => {
      Utils.showToast("Unable to access camera: " + err, "danger");
    });
  },

  stopCamera() {
    if (this.html5QrCode && this.isScanning) {
      this.html5QrCode.stop().then(() => {
        this.isScanning = false;
        document.getElementById('startCameraBtn').style.display = 'inline-flex';
        document.getElementById('stopCameraBtn').style.display = 'none';
      });
    }
  },

  /**
   * Process Check-in Payload
   */
  async processAttendance(teamIdOrToken) {
    const session = Auth.getSession();
    const resultBox = document.getElementById('scanResultContainer');

    // Clean up input: If scanned text is a full URL, extract teamId or token query parameter!
    let cleanedId = (teamIdOrToken || "").trim();
    if (cleanedId.includes("?")) {
      try {
        const urlParams = new URLSearchParams(cleanedId.substring(cleanedId.indexOf("?")));
        cleanedId = urlParams.get("teamId") || urlParams.get("token") || cleanedId;
      } catch (e) {}
    }

    try {
      const res = await API.request('markAttendance', {
        teamId: cleanedId,
        markedBy: session ? session.name : "Organizer Desk"
      });

      const team = res.team || {
        teamName: res.teamName || cleanedId,
        teamId: res.teamId || cleanedId,
        college: res.college || "Verified Institution",
        leaderName: res.leaderName || "Team Leader",
        leaderPhone: res.leaderPhone || "-"
      };

      if (res.alreadyCheckedIn) {
        this.playBeep(false);
        Utils.showToast(`⚠ Team already checked in at ${res.checkInTime || 'Earlier'}`, "warning");
        if (resultBox) {
          resultBox.innerHTML = `
            <div class="alert alert-warning border-warning d-flex align-items-center gap-3">
              <i class="bi bi-exclamation-triangle-fill fs-3 text-warning"></i>
              <div>
                <h6 class="fw-bold mb-1">Team Already Checked In</h6>
                <p class="small mb-0"><b>${team.teamName}</b> (${team.teamId}) checked in at <span class="mono">${res.checkInTime || 'Earlier'}</span>.</p>
              </div>
            </div>
          `;
        }
      } else {
        this.playBeep(true);
        Utils.showToast(`✓ Check-in Verified: ${team.teamName}`, "success");
        if (resultBox) {
          resultBox.innerHTML = `
            <div class="alert alert-success border-success d-flex align-items-center gap-3">
              <i class="bi bi-check-circle-fill fs-3 text-success"></i>
              <div>
                <h6 class="fw-bold mb-1">Check-in Confirmed!</h6>
                <p class="small mb-1"><b>${team.teamName}</b> (${team.teamId}) from <b>${team.college}</b>.</p>
                <div class="small text-muted">Leader: ${team.leaderName} (${team.leaderPhone || '-'})</div>
              </div>
            </div>
          `;
        }
      }
    } catch (err) {
      this.playBeep(false);
      Utils.showToast(err.message || "Error processing check-in", "danger");
    }  if (resultBox) {
        resultBox.innerHTML = `
          <div class="alert alert-danger border-danger d-flex align-items-center gap-3">
            <i class="bi bi-x-circle-fill fs-3 text-danger"></i>
            <div>
              <h6 class="fw-bold mb-0">Check-in Error</h6>
              <p class="small mb-0">${err.message}</p>
            </div>
          </div>
        `;
      }
    }
  },

  /**
   * Initialize Attendance Logs Table Page
   */
  async initLogs() {
    if (!Auth.requireRole(['admin', 'organizer'])) return;

    try {
      const teams = await API.request('getTeams');
      const attList = await API.request('getAttendance');
      const attMap = {};
      attList.forEach(a => { attMap[a.teamId] = a; });

      const fullList = teams.map(t => {
        const check = attMap[t.teamId];
        return {
          teamId: t.teamId,
          teamName: t.teamName,
          college: t.college,
          department: t.department,
          status: check ? 'Present' : 'Absent',
          checkInTime: check ? check.checkInTime : '-'
        };
      });

      this.renderAttendanceTable(fullList);
      this.setupAttendanceFilter(fullList);
    } catch (e) {
      console.error(e);
    }
  },

  renderAttendanceTable(list) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No records found.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(item => `
      <tr>
        <td><span class="team-id-badge">${item.teamId}</span></td>
        <td><b>${item.teamName}</b></td>
        <td>${item.college}</td>
        <td>${item.department}</td>
        <td>
          <span class="ht-badge ${item.status === 'Present' ? 'badge-present' : 'badge-absent'}">
            <i class="bi ${item.status === 'Present' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}"></i>
            ${item.status}
          </span>
        </td>
        <td><span class="mono">${item.checkInTime}</span></td>
      </tr>
    `).join('');
  },

  setupAttendanceFilter(list) {
    const search = document.getElementById('attSearchInput');
    const filter = document.getElementById('attStatusFilter');

    const apply = () => {
      const q = (search ? search.value : '').toLowerCase();
      const status = filter ? filter.value : '';

      const filtered = list.filter(item => {
        const matchesQ = item.teamName.toLowerCase().includes(q) ||
                         item.teamId.toLowerCase().includes(q) ||
                         item.college.toLowerCase().includes(q);
        const matchesStatus = !status || item.status === status;
        return matchesQ && matchesStatus;
      });

      this.renderAttendanceTable(filtered);
    };

    if (search) search.addEventListener('input', apply);
    if (filter) filter.addEventListener('change', apply);
  }
};

if (typeof window !== "undefined") {
  window.Attendance = Attendance;
}
