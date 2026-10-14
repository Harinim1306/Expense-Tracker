// ==========================================================================
// TrackFlow CloudSync – Authentication, Session & Cross-Device Sync
// ==========================================================================
// API base: automatically detects Netlify or local server
// No external libs needed – uses fetch() only.

const CloudSync = (() => {

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------
  const AUTHORIZED_NUMBERS = []; // Server validates identity and permissions.
  const SESSION_KEY = 'trackflow_session_v1';

  // Detect API base: Netlify Functions or local server
  function getApiBase() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return ''; // Local server handles /api/* directly
    }
    // Netlify: functions are at /api/* via redirect in netlify.toml
    return '';
  }

  function apiUrl(path) {
    return getApiBase() + '/api' + path;
  }

  // -------------------------------------------------------------------------
  // Session Management (persists in localStorage – only cleared on Log Out)
  // -------------------------------------------------------------------------
  function saveSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      phone: user.phone,
      name: user.name,
      role: user.role,
      accounts: user.accounts,
      partnerPhone: user.partnerPhone,
      token: user.token || null,
      loginTime: Date.now()
    }));
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() {
    const session = getSession();
    // Expire legacy client-only sessions and sessions without a server token.
    return !!(session && session.token && session.loginTime && Date.now() - session.loginTime < 12 * 60 * 60 * 1000);
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[^0-9]/g, '').slice(-10);
  }

  // -------------------------------------------------------------------------
  // Auth – Login (calls /api/auth/login)
  // -------------------------------------------------------------------------
  async function login(phone, password) {
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone || !password) return { success: false, error: 'Enter your phone number and password.' };

    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, password })
      });
      const data = await res.json();

      if (data.success) {
        saveSession({ ...data.user, token: data.token });
      }
      return data;
    } catch (err) {
      // Never create a session when the server cannot verify credentials.
      return { success: false, error: 'Server unavailable. Connect and try again.' };
    }
  }

  function logout() {
    clearSession();
  }

  // -------------------------------------------------------------------------
  // Sync – Pull latest cloud data (GET /api/sync/pull?phone=...)
  // -------------------------------------------------------------------------
  async function pullFromCloud(phone) {
    const session = getSession();
    if (!session?.token) return { success: false, error: 'Please sign in again.' };
    try {
      const res = await fetch(apiUrl('/sync/pull'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` }
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn('CloudSync pull failed (offline?):', err.message);
      return { success: false, offline: true };
    }
  }

  // -------------------------------------------------------------------------
  // Sync – Push local data to cloud (POST /api/sync/push)
  // -------------------------------------------------------------------------
  async function pushToCloud(phone, bobData, privateData, partnerProfile) {
    const session = getSession();
    if (!session?.token) return { success: false, error: 'Please sign in again.' };
    try {
      const res = await fetch(apiUrl('/sync/push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
        body: JSON.stringify({
          bob: bobData,
          private: privateData,
          partnerProfile
        })
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn('CloudSync push failed (offline?):', err.message);
      return { success: false, offline: true };
    }
  }

  // -------------------------------------------------------------------------
  // Add private account (POST /api/accounts/add)
  // -------------------------------------------------------------------------
  async function addPrivateAccount(phone, accountName, initialBalance) {
    const session = getSession();
    if (!session?.token) return { success: false, error: 'Please sign in again.' };
    try {
      const res = await fetch(apiUrl('/accounts/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.token}` },
        body: JSON.stringify({ accountName, initialBalance })
      });
      return await res.json();
    } catch (err) {
      return { success: false, error: 'Server unavailable' };
    }
  }

  // -------------------------------------------------------------------------
  // Role-Based Visibility Helpers
  // -------------------------------------------------------------------------
  function isPrimary() {
    const session = getSession();
    return session && session.role === 'primary';
  }

  function isPartner() {
    const session = getSession();
    return session && session.role === 'partner';
  }

  function getUserPhone() {
    return (getSession() || {}).phone || '';
  }

  function getUserName() {
    return (getSession() || {}).name || 'User';
  }

  function getUserRole() {
    return (getSession() || {}).role || 'unknown';
  }

  function getUserAccounts() {
    return (getSession() || {}).accounts || ['BOB'];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  return {
    login,
    logout,
    isLoggedIn,
    getSession,
    pullFromCloud,
    pushToCloud,
    addPrivateAccount,
    isPrimary,
    isPartner,
    getUserPhone,
    getUserName,
    getUserRole,
    getUserAccounts,
    normalizePhone,
    AUTHORIZED_NUMBERS
  };
})();
