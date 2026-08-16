/**
 * HackTrack | Synora'26 — Authentication & Role Protection Guard
 */

const Auth = {
  /**
   * Get current logged-in session
   */
  getSession() {
    try {
      const sess = localStorage.getItem(CONFIG.STORAGE_KEYS.SESSION);
      return sess ? JSON.parse(sess) : null;
    } catch (e) {
      return null;
    }
  },

  /**
   * Set user session
   */
  setSession(user) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.SESSION, JSON.stringify(user));
  },

  /**
   * Clear session & logout
   */
  logout() {
    const session = this.getSession();
    if (session) {
      API.logActivity("User Logout", `${session.name} (${session.role}) logged out.`);
    }
    localStorage.removeItem(CONFIG.STORAGE_KEYS.SESSION);
    
    // Determine relative path to login.html
    const path = window.location.pathname;
    if (path.includes('/admin/') || path.includes('/organizer/') || path.includes('/judge/')) {
      window.location.href = '../login.html';
    } else {
      window.location.href = 'login.html';
    }
  },

  /**
   * Route Guard: Require one or more specific roles
   * @param {string|string[]} allowedRoles 
   */
  requireRole(allowedRoles) {
    const session = this.getSession();
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!session || !session.role) {
      // Not logged in -> redirect to login
      const prefix = (window.location.pathname.includes('/admin/') || 
                      window.location.pathname.includes('/organizer/') || 
                      window.location.pathname.includes('/judge/')) ? '../' : '';
      window.location.href = `${prefix}login.html?msg=unauthorized`;
      return false;
    }

    if (!roles.includes(session.role.toLowerCase())) {
      // Unauthorized access
      alert(`Unauthorized access! Your account role (${session.role.toUpperCase()}) does not have access to this portal.`);
      
      const prefix = (window.location.pathname.includes('/admin/') || 
                      window.location.pathname.includes('/organizer/') || 
                      window.location.pathname.includes('/judge/')) ? '../' : '';

      if (session.role.toLowerCase() === 'admin') {
        window.location.href = `${prefix}admin/dashboard.html`;
      } else if (session.role.toLowerCase() === 'organizer') {
        window.location.href = `${prefix}organizer/dashboard.html`;
      } else if (session.role.toLowerCase() === 'judge') {
        window.location.href = `${prefix}judge/dashboard.html`;
      } else {
        window.location.href = `${prefix}login.html`;
      }
      return false;
    }

    // Populate topbar user elements if present
    this.updateUserUI(session);
    return true;
  },

  /**
   * Update header user profile UI
   */
  updateUserUI(user) {
    document.addEventListener('DOMContentLoaded', () => {
      const nameEl = document.getElementById('topbar-user-name');
      const roleEl = document.getElementById('topbar-user-role');
      const avatarEl = document.getElementById('topbar-user-avatar');

      if (nameEl) nameEl.textContent = user.name || 'User';
      if (roleEl) roleEl.textContent = user.role ? user.role.toUpperCase() : '';
      if (avatarEl && user.name) {
        const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        avatarEl.textContent = initials || 'U';
      }
    });
  }
};

if (typeof window !== "undefined") {
  window.Auth = Auth;
}
