/**
 * HackTrack | Synora'26 — Utility Toolkit
 * Notifications, Modals, Theme Engine, Exporters & Formatters
 */

const Utils = {
  /**
   * Display modern toast message
   * @param {string} message 
   * @param {'success'|'danger'|'warning'|'info'} type 
   * @param {number} duration 
   */
  showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById('ht-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ht-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `ht-toast ${type}`;

    let iconClass = 'bi-info-circle-fill';
    if (type === 'success') iconClass = 'bi-check-circle-fill';
    if (type === 'danger') iconClass = 'bi-exclamation-triangle-fill';
    if (type === 'warning') iconClass = 'bi-exclamation-circle-fill';

    toast.innerHTML = `
      <i class="bi ${iconClass} ht-toast-icon"></i>
      <div style="flex-grow: 1;">${message}</div>
      <button style="background:none; border:none; color:var(--ht-text-muted); cursor:pointer; font-size:1rem;" onclick="this.parentElement.remove()">
        <i class="bi bi-x"></i>
      </button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * Theme Engine: Dark / Light Mode
   */
  initTheme() {
    const savedTheme = localStorage.getItem(CONFIG.STORAGE_KEYS.THEME) || 
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.setTheme(savedTheme);
  },

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(CONFIG.STORAGE_KEYS.THEME, theme);
    const themeIcon = document.getElementById('theme-toggle-icon');
    if (themeIcon) {
      themeIcon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
    }
  },

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    this.setTheme(next);
  },

  /**
   * Modal Management
   */
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  /**
   * Mobile Drawer Toggle
   */
  toggleSidebar() {
    const sidebar = document.querySelector('.ht-sidebar');
    const overlay = document.querySelector('.ht-sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open');
  },

  closeSidebar() {
    const sidebar = document.querySelector('.ht-sidebar');
    const overlay = document.querySelector('.ht-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  },

  /**
   * Export Array of Objects to CSV
   */
  exportToCsv(filename, rows) {
    if (!rows || !rows.length) {
      Utils.showToast("No data available to export.", "warning");
      return;
    }
    const separator = ',';
    const keys = Object.keys(rows[0]);
    const csvContent =
      '\uFEFF' + // UTF-8 BOM
      keys.join(separator) +
      '\n' +
      rows.map(row => {
        return keys.map(k => {
          let cell = row[k] === null || row[k] === undefined ? '' : row[k].toString();
          cell = cell.replace(/"/g, '""');
          if (cell.search(/("|,|\n)/g) >= 0) {
            cell = `"${cell}"`;
          }
          return cell;
        }).join(separator);
      }).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      Utils.showToast(`Exported ${filename} successfully!`, 'success');
    }
  },

  /**
   * Trigger Print Report
   */
  printReport() {
    window.print();
  },

  /**
   * Generate QR Code into DOM element
   */
  renderQrCode(elementId, text, width = 160, height = 160) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = "";
    if (typeof QRCode !== "undefined") {
      new QRCode(el, {
        text: text,
        width: width,
        height: height,
        colorDark: "#0F172A",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      // Fallback SVG QR placeholder
      el.innerHTML = `<div style="padding:10px; font-size:11px; text-align:center;"><b>QR Token:</b><br/>${text}</div>`;
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString();
  }
};

// Initialize Theme on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  Utils.initTheme();
});

if (typeof window !== "undefined") {
  window.Utils = Utils;
}
