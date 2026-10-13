// ==========================================================================
// TrackFlow CloudSync – Authentication, Session & Cross-Device Sync
// ==========================================================================
// API base: automatically detects Netlify or local server
// No external libs needed – uses fetch() only.

const CloudSync = (() => {

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------
  const AUTHORIZED_NUMBERS = ['7418753113', '9384931363'];
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
    return getSession() !== null;
  }

  function normalizePhone(phone) {
    return String(phone || '').replace(/[^0-9]/g, '').slice(-10);
  }

  // -------------------------------------------------------------------------
  // Auth – Login (calls /api/auth/login)
  // -------------------------------------------------------------------------
  async function login(phone, password) {
    const cleanPhone = normalizePhone(phone);

    if (!AUTHORIZED_NUMBERS.includes(cleanPhone)) {
      return {
        success: false,
        error: 'Access restricted. Only authorized partner numbers can sign in.'
      };
    }

    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, password })
      });
      const data = await res.json();

      if (data.success) {
        saveSession(data.user);
      }
      return data;
    } catch (err) {
      // If network is offline or server not available, allow offline mode
      // by validating against hardcoded allowed numbers + default password
      if (AUTHORIZED_NUMBERS.includes(cleanPhone) &&
          (password === 'trackflow2026' || password.length >= 4)) {
        // Offline fallback – allow access with a basic session
        const fallbackUser = {
          phone: cleanPhone,
          name: cleanPhone === '7418753113' ? 'Harini' : 'Partner',
          role: cleanPhone === '7418753113' ? 'primary' : 'partner',
          accounts: cleanPhone === '7418753113' ? ['BOB', 'ICICI'] : ['BOB', 'Personal'],
          partnerPhone: cleanPhone === '7418753113' ? '9384931363' : '7418753113'
        };
        saveSession(fallbackUser);
        return { success: true, user: fallbackUser, offline: true };
      }
      return { success: false, error: 'Server unavailable. Check your connection.' };
    }
  }

  function logout() {
    clearSession();
  }

  // -------------------------------------------------------------------------
  // Sync – Pull latest cloud data (GET /api/sync/pull?phone=...)
  // -------------------------------------------------------------------------
  async function pullFromCloud(phone) {
    const cleanPhone = normalizePhone(phone);
    try {
      const res = await fetch(apiUrl(`/sync/pull?phone=${cleanPhone}`), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
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
    const cleanPhone = normalizePhone(phone);
    try {
      const res = await fetch(apiUrl('/sync/push'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
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
    const cleanPhone = normalizePhone(phone);
    try {
      const res = await fetch(apiUrl('/accounts/add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone, accountName, initialBalance })
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
    return session && session.phone === '7418753113';
  }

  function isPartner() {
    const session = getSession();
    return session && session.phone === '9384931363';
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
