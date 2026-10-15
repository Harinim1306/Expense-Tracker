// ==========================================================================
// TrackFlow - Core Logic & Editorial Ledger Engine
// ==========================================================================

const STORAGE_KEYS = {
  INITIAL: 'trackflow_initial_balances_v1',
  TRANSACTIONS: 'trackflow_transactions_v1',
  SETTINGS: 'trackflow_settings_v1',
  REMINDERS: 'trackflow_reminders_v1',
  NOTIFICATIONS: 'trackflow_notifications_v1',
  PRIVATE_ACCOUNTS: 'trackflow_private_accounts_v1',
  DELETED_TRANSACTIONS: 'trackflow_deleted_transactions_v1'
};

// Application State
let state = {
  initialBalances: {
    BOB: 5000,
    ICICI: 10000
  },
  transactions: [],
  deletedTransactionIds: { BOB: [], PRIVATE: [] },
  partnerReminders: [],
  privateAccounts: {   // Private accounts for the logged-in user only (never synced cross-partner)
    accounts: [],      // e.g. ['ICICI'] for primary, ['Personal'] for partner
    initialBalances: {},
    transactions: []
  },
  selectedMonth: getCurrentYearMonth(),
  activeTab: 'tab-dashboard',
  warningDismissed: false,
  isCustomTimeEnabled: false,
  partner: {
    name: 'Partner',
    phone: '',
    upiId: '',
    autoNotifyBob: true
  },
  notificationSettings: {
    enabled: true,
    intervalMinutes: 15,
    soundChime: true,
    lowBalanceAlerts: true,
    notifySystem: true
  },
  currentNotifyTx: null,
  currentAlertReminder: null,
  deferredInstallPrompt: null,
  lastCloudSync: null
};

// ==========================================================================
// Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Show auth gate if not logged in
  const isLoggedIn = (typeof CloudSync !== 'undefined') && CloudSync.isLoggedIn();

  if (!isLoggedIn) {
    showAuthOverlay();
    return; // Don't load app until authenticated
  }

  // 2. Apply role-based UI before loading data
  applyUserRoleUI();

  // 3. Load local data
  loadData();
  setupEventListeners();
  setupAuthListeners();
  setupReportListeners();
  setupTimestampEngine();
  setupServiceWorker();
  setupRecurringReminderEngine();
  handleUrlParameters();
  renderAll();
  renderPrivateAccountsPanel();

  // 4. Try cloud sync in background & set up automatic polling
  performCloudSync();

  window.addEventListener('focus', () => {
    if (typeof CloudSync !== 'undefined' && CloudSync.isLoggedIn()) {
      performCloudSync();
    }
  });

  setInterval(() => {
    if (typeof CloudSync !== 'undefined' && CloudSync.isLoggedIn() && document.visibilityState === 'visible') {
      performCloudSync();
    }
  }, 30000);

  // 5. First-time welcome
  if (!localStorage.getItem(STORAGE_KEYS.INITIAL)) {
    openModal('welcomeModal');
  }
});

// ==========================================================================
// Auth Overlay – Login Screen
// ==========================================================================
function showAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'flex';

  // Wire login form
  const form = document.getElementById('authLoginForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleAuthLogin();
    });
  }

  // Toggle password visibility
  const toggleBtn = document.getElementById('toggleAuthPassBtn');
  const passInput = document.getElementById('authPasswordInput');
  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    });
  }
}

async function handleAuthLogin() {
  const phoneInput = document.getElementById('authPhoneInput');
  const passInput = document.getElementById('authPasswordInput');
  const errorBanner = document.getElementById('authErrorBanner');
  const submitBtn = document.getElementById('authSubmitBtn');

  const phone = (phoneInput.value || '').trim();
  const password = (passInput.value || '').trim();

  if (!phone || phone.length < 10) {
    showAuthError('Please enter your 10-digit mobile number.');
    return;
  }
  if (!password) {
    showAuthError('Please enter your access password.');
    return;
  }

  // Disable button during login
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';
  }
  if (errorBanner) errorBanner.style.display = 'none';

  try {
    const result = await CloudSync.login(phone, password);
    if (result.success) {
      // Hide overlay and boot app
      const overlay = document.getElementById('authOverlay');
      if (overlay) overlay.style.display = 'none';

      applyUserRoleUI();
      loadData();
      setupEventListeners();
      setupAuthListeners();
      setupReportListeners();
      setupTimestampEngine();
      setupServiceWorker();
      setupRecurringReminderEngine();
      handleUrlParameters();
      renderAll();
      renderPrivateAccountsPanel();

      if (result.offline) {
        showToast('Logged in (offline mode). Data syncs when connection is restored.');
      } else {
        showToast(`Welcome back, ${CloudSync.getUserName()}! Syncing your data...`);
        await performCloudSync();
      }

      if (!localStorage.getItem(STORAGE_KEYS.INITIAL)) {
        openModal('welcomeModal');
      }
    } else {
      showAuthError(result.error || 'Login failed. Check your credentials.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Enter Ledger</span><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';
      }
    }
  } catch (err) {
    showAuthError('Unexpected error. Please try again.');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Enter Ledger</span>';
    }
  }
}

function showAuthError(msg) {
  const banner = document.getElementById('authErrorBanner');
  if (banner) {
    banner.textContent = msg;
    banner.style.display = 'block';
  }
}

function handleLogout() {
  if (confirm('Log out? You will need your mobile number and password to sign back in.')) {
    CloudSync.logout();
    // Clear session UI and reload
    window.location.reload();
  }
}

// ==========================================================================
// Apply Role-Based UI (Primary vs Partner)
// ==========================================================================
function applyUserRoleUI() {
  if (typeof CloudSync === 'undefined' || !CloudSync.isLoggedIn()) return;

  const session = CloudSync.getSession();
  const phone = session.phone;
  const name = session.name;
  const role = session.role;
  const userAccounts = session.accounts || ['BOB'];

  // Update sidebar user box
  const sidebarRole = document.getElementById('sidebarUserRole');
  const sidebarPhone = document.getElementById('sidebarUserPhone');
  const mobileUserBadge = document.getElementById('mobileUserBadge');
  const topbarSub = document.getElementById('topbarBrandSub');

  if (sidebarRole) sidebarRole.textContent = role === 'primary' ? `${name} (Primary)` : `${name} (Partner)`;
  if (sidebarPhone) sidebarPhone.textContent = `+91 ${phone}`;
  if (mobileUserBadge) mobileUserBadge.textContent = phone;
  if (topbarSub) topbarSub.textContent = role === 'primary' ? 'BOB + ICICI Ledger' : 'Shared BOB + My Vault';

  // Settings page user info
  const settingsBadge = document.getElementById('settingsUserBadge');
  const settingsPhone = document.getElementById('settingsUserPhone');
  if (settingsBadge) settingsBadge.textContent = role === 'primary' ? `${name} — Primary` : `${name} — Partner`;
  if (settingsPhone) settingsPhone.textContent = `+91 ${phone}`;

  // Update second account column label
  const sidebarSecondTag = document.getElementById('sidebarSecondAccTag');
  const iciciCard = document.getElementById('iciciCard');
  const sidebarSecondRow = document.getElementById('sidebarSecondAccRow');

  if (CloudSync.isPrimary()) {
    // Primary sees BOB + ICICI
    if (sidebarSecondTag) sidebarSecondTag.textContent = 'ICICI';
    if (iciciCard) iciciCard.style.display = '';
    if (sidebarSecondRow) sidebarSecondRow.style.display = '';
  } else {
    // Partner sees BOB + their private account (not ICICI)
    const partnerFirstPrivate = (state.privateAccounts.accounts || [])[0] || 'Personal';
    if (sidebarSecondTag) sidebarSecondTag.textContent = partnerFirstPrivate;
    if (iciciCard) {
      // Rename ICICI label to partner's private account
      const iciciPill = iciciCard.querySelector('.icici-pill');
      const iciciDesc = iciciCard.querySelector('.acc-desc');
      if (iciciPill) iciciPill.textContent = partnerFirstPrivate;
      if (iciciDesc) iciciDesc.textContent = 'Private Account';
    }
    if (sidebarSecondRow) sidebarSecondRow.style.display = '';
  }

  // Private vault label
  const vaultTitle = document.getElementById('privateVaultTitle');
  const vaultSub = document.getElementById('privateVaultSub');
  if (vaultTitle) vaultTitle.textContent = CloudSync.isPrimary() ? 'My ICICI Account' : 'My Private Vault';
  if (vaultSub) vaultSub.textContent = CloudSync.isPrimary()
    ? 'Your ICICI account data is private and never visible to your partner.'
    : 'Your private accounts are only visible to you — never shared with your partner.';
}

// ==========================================================================
// Auth Event Listeners (Logout buttons)
// ==========================================================================
function setupAuthListeners() {
  document.getElementById('sidebarLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('mobileLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('settingsLogoutBtn')?.addEventListener('click', handleLogout);

  // Manual cloud sync button
  document.getElementById('manualSyncNowBtn')?.addEventListener('click', async () => {
    showToast('Syncing...');
    const result = await performCloudSync();
    if (result && result.success !== false) {
      showToast('Sync complete! Data is up to date across all devices.');
    } else {
      showToast('Sync failed — check your connection.', 'warning');
    }
  });

  // Add private account form
  document.getElementById('addPrivateAccountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newPrivateAccName').value.trim();
    const balance = parseFloat(document.getElementById('newPrivateAccBalance').value || '0');

    if (!name) {
      showToast('Please enter an account name', 'warning');
      return;
    }

    const phone = CloudSync.getUserPhone();
    if (!phone) {
      showToast('Not logged in', 'warning');
      return;
    }

    // Add to local private accounts state
    if (!state.privateAccounts.accounts.includes(name)) {
      state.privateAccounts.accounts.push(name);
    }
    state.privateAccounts.initialBalances[name] = balance;

    // Save locally and push to cloud
    saveData();
    renderPrivateAccountsPanel();
    applyUserRoleUI();

    // Cloud sync
    await CloudSync.addPrivateAccount(phone, name, balance);
    showToast(`Private account "${name}" added to your personal vault.`);

    document.getElementById('newPrivateAccName').value = '';
    document.getElementById('newPrivateAccBalance').value = '';
  });
}

// ==========================================================================
// Cloud Sync – Pull & Push (with automatic background sync)
// ==========================================================================
let isCloudSyncing = false;
let autoSyncTimer = null;
let fundsMode = 'deposit';
const PARTNER_SETTINGS_PENDING_KEY = 'trackflow_partner_settings_pending_v1';

function hasPendingPartnerSettings() {
  try { return localStorage.getItem(PARTNER_SETTINGS_PENDING_KEY) === '1'; }
  catch { return false; }
}

function triggerAutoCloudSync() {
  if (isCloudSyncing) return;
  if (typeof CloudSync === 'undefined' || !CloudSync.isLoggedIn()) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    performCloudSync();
  }, 1000);
}

async function performCloudSync() {
  if (typeof CloudSync === 'undefined' || !CloudSync.isLoggedIn()) return null;
  if (isCloudSyncing) return null;
  isCloudSyncing = true;

  const phone = CloudSync.getUserPhone();
  const syncBadge = document.getElementById('cloudSyncStatusBadge');
  const sidebarSync = document.getElementById('sidebarSyncStatus');

  function setSyncStatus(text, color) {
    if (syncBadge) {
      syncBadge.textContent = text;
      syncBadge.style.background = color === 'ok' ? 'var(--sage-tint)' : 'var(--bob-tint)';
      syncBadge.style.color = color === 'ok' ? 'var(--sage-dark)' : 'var(--bob-accent)';
    }
    if (sidebarSync) {
      sidebarSync.innerHTML = `<span class="status-pip" style="background:${color === 'ok' ? 'var(--sage-primary)' : '#F59E0B'}"></span> ${text}`;
    }
  }

  try {
    setSyncStatus('Syncing…', 'warn');

    // 1. Pull from cloud
    const pullResult = await CloudSync.pullFromCloud(phone);

    if (pullResult.success) {
      // Merge BOB shared data (cloud data takes precedence for shared)
      if (pullResult.bob) {
        if (pullResult.bob.initial !== undefined) {
          state.initialBalances.BOB = Number(pullResult.bob.initial);
        }
        if (Array.isArray(pullResult.bob.transactions)) {
          // Merge cloud + local, honoring server-side deletion tombstones.
          const deletedBob = new Set([...(state.deletedTransactionIds.BOB || []), ...(pullResult.bob.deletedIds || [])]);
          state.deletedTransactionIds.BOB = Array.from(deletedBob);
          const localMap = new Map(state.transactions.filter(t => t.account === 'BOB' && !deletedBob.has(t.id)).map(t => [t.id, t]));
          pullResult.bob.transactions.filter(t => !deletedBob.has(t.id)).forEach(t => localMap.set(t.id, t));
          // Keep non-BOB local txs + merged BOB
          state.transactions = [
            ...state.transactions.filter(t => t.account !== 'BOB'),
            ...Array.from(localMap.values())
          ].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
        }
        if (Array.isArray(pullResult.bob.reminders)) {
          state.partnerReminders = pullResult.bob.reminders;
        }
      }

      // 2. Merge private account data
      if (pullResult.private) {
        if (Array.isArray(pullResult.private.accounts)) {
          state.privateAccounts.accounts = pullResult.private.accounts;
        }
        if (pullResult.private.initialBalances) {
          // Primary's ICICI is stored in private
          if (CloudSync.isPrimary() && pullResult.private.initialBalances.ICICI !== undefined) {
            state.initialBalances.ICICI = Number(pullResult.private.initialBalances.ICICI);
          }
          state.privateAccounts.initialBalances = { ...state.privateAccounts.initialBalances, ...pullResult.private.initialBalances };
        }
        if (Array.isArray(pullResult.private.transactions)) {
          const deletedPrivate = new Set([...(state.deletedTransactionIds.PRIVATE || []), ...(pullResult.private.deletedIds || [])]);
          state.deletedTransactionIds.PRIVATE = Array.from(deletedPrivate);
          const privMap = new Map((state.privateAccounts.transactions || []).filter(t => !deletedPrivate.has(t.id)).map(t => [t.id, t]));
          pullResult.private.transactions.filter(t => !deletedPrivate.has(t.id)).forEach(t => privMap.set(t.id, t));
          state.privateAccounts.transactions = Array.from(privMap.values()).sort(
            (a, b) => new Date(b.datetime) - new Date(a.datetime)
          );
        }
      }

      // 3. Partner profile
      if (pullResult.partnerProfile) {
        // Server environment variables are the source of truth for partner contact settings.
        state.partner = { ...state.partner, ...pullResult.partnerProfile };
      }

      saveData({ skipSync: true });
      renderAll();
      renderPrivateAccountsPanel();
    }

    // 4. Push local state to cloud
    const bobPayload = {
      initial: state.initialBalances.BOB,
      transactions: state.transactions.filter(t => t.account === 'BOB'),
      reminders: state.partnerReminders,
      deletedIds: state.deletedTransactionIds.BOB || []
    };

    // Build private payload (primary sends ICICI under private)
    let privatePayload = {
      accounts: state.privateAccounts.accounts,
      initialBalances: { ...state.privateAccounts.initialBalances },
      transactions: state.privateAccounts.transactions,
      deletedIds: state.deletedTransactionIds.PRIVATE || []
    };
    if (CloudSync.isPrimary()) {
      privatePayload.accounts = ['ICICI', ...privatePayload.accounts.filter(a => a !== 'ICICI')];
      privatePayload.initialBalances.ICICI = state.initialBalances.ICICI;
      privatePayload.transactions = state.transactions.filter(t => t.account === 'ICICI');
    }

    const pushResult = await CloudSync.pushToCloud(phone, bobPayload, privatePayload, state.partner);
    if (!pushResult || pushResult.success !== true) {
      throw new Error(pushResult?.error || 'Cloud save failed');
    }

    // Clear the pending marker only after the server confirms the save.
    if (hasPendingPartnerSettings()) {
      localStorage.removeItem(PARTNER_SETTINGS_PENDING_KEY);
    }
    state.lastCloudSync = Date.now();
    setSyncStatus('Synced', 'ok');
    return { success: true };

  } catch (err) {
    setSyncStatus('Offline', 'warn');
    return { success: false };
  } finally {
    isCloudSyncing = false;
  }
}

// ==========================================================================
// Render Private Accounts Panel in Settings
// ==========================================================================
function renderPrivateAccountsPanel() {
  const container = document.getElementById('privateAccountsList');
  if (!container) return;

  container.innerHTML = '';

  const accounts = state.privateAccounts.accounts || [];
  const initials = state.privateAccounts.initialBalances || {};

  // Also include ICICI for primary user
  let displayAccounts = [...accounts];
  if (CloudSync && CloudSync.isPrimary() && !displayAccounts.includes('ICICI')) {
    displayAccounts = ['ICICI', ...displayAccounts];
  }

  if (displayAccounts.length === 0) {
    container.innerHTML = `<p style="font-size: 0.8rem; color: var(--ink-muted);">No private accounts yet. Add one below.</p>`;
    return;
  }

  displayAccounts.forEach(accName => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--bg-cream); border: 1px solid var(--border-subtle); border-radius: 4px;';
    row.innerHTML = `
      <span style="font-size: 0.85rem; font-weight: 600; color: var(--ink-primary);">${escapeHtml(accName)}</span>
      <span style="font-family: var(--font-numerics); font-size: 0.85rem; color: var(--sage-dark);">Starting: ${formatINR(initials[accName] || 0)}</span>
    `;
    container.appendChild(row);
  });
}



function getCurrentYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function loadData() {
  try {
    const savedInitial = localStorage.getItem(STORAGE_KEYS.INITIAL);
    if (savedInitial) {
      state.initialBalances = JSON.parse(savedInitial);
    }

    const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (savedSettings) {
      state.partner = { ...state.partner, ...JSON.parse(savedSettings) };
    }

    const savedReminders = localStorage.getItem(STORAGE_KEYS.REMINDERS);
    if (savedReminders) {
      state.partnerReminders = JSON.parse(savedReminders);
    }

    const savedNotifications = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (savedNotifications) {
      state.notificationSettings = { ...state.notificationSettings, ...JSON.parse(savedNotifications) };
    }

    const savedPrivate = localStorage.getItem(STORAGE_KEYS.PRIVATE_ACCOUNTS);
    if (savedPrivate) {
      state.privateAccounts = { ...state.privateAccounts, ...JSON.parse(savedPrivate) };
    }

    const savedDeleted = localStorage.getItem(STORAGE_KEYS.DELETED_TRANSACTIONS);
    if (savedDeleted) state.deletedTransactionIds = { ...state.deletedTransactionIds, ...JSON.parse(savedDeleted) };

    const savedTx = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
    if (savedTx) {
      state.transactions = JSON.parse(savedTx);
    } else {
      // Clean initial welcome sample transaction
      state.transactions = [
        {
          id: 'tx_' + Date.now(),
          type: 'expense',
          account: 'BOB',
          amount: 250,
          category: 'Food & Dining',
          description: 'Team Lunch',
          toWhom: 'Swiggy Cafe',
          datetime: new Date().toISOString()
        }
      ];
      saveData();
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }
}

function saveData(options = {}) {
  try {
    localStorage.setItem(STORAGE_KEYS.INITIAL, JSON.stringify(state.initialBalances));
    localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(state.transactions));
    localStorage.setItem(STORAGE_KEYS.DELETED_TRANSACTIONS, JSON.stringify(state.deletedTransactionIds));
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.partner));
    localStorage.setItem(STORAGE_KEYS.REMINDERS, JSON.stringify(state.partnerReminders));
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(state.notificationSettings));
    localStorage.setItem(STORAGE_KEYS.PRIVATE_ACCOUNTS, JSON.stringify(state.privateAccounts));

    if (!options.skipSync) {
      triggerAutoCloudSync();
    }
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

// ==========================================================================
// Balances & Ledger Calculations
// ==========================================================================
function calculateBalances() {
  let bobTotal = Number(state.initialBalances.BOB || 0);
  let iciciTotal = Number(state.initialBalances.ICICI || 0);
  let bobSpent = 0;
  let iciciSpent = 0;

  state.transactions.forEach((tx) => {
    const amt = Number(tx.amount || 0);
    if (tx.type === 'deposit') {
      if (tx.account === 'BOB') bobTotal += amt;
      if (tx.account === 'ICICI') iciciTotal += amt;
    } else {
      // Expenses and withdrawals both reduce balances; withdrawals are excluded from spending analytics.
      if (tx.account === 'BOB') {
        bobTotal -= amt;
        if (tx.type !== 'withdrawal') bobSpent += amt;
      }
      if (tx.account === 'ICICI') {
        iciciTotal -= amt;
        if (tx.type !== 'withdrawal') iciciSpent += amt;
      }
    }
  });

  const totalBalance = bobTotal + iciciTotal;
  const totalInitial = Number(state.initialBalances.BOB || 0) + Number(state.initialBalances.ICICI || 0);
  const totalSpent = bobSpent + iciciSpent;

  return {
    bobTotal,
    iciciTotal,
    totalBalance,
    bobSpent,
    iciciSpent,
    totalInitial,
    totalSpent
  };
}

// Currency Formatter
function formatINR(number) {
  return '₹' + Number(number || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatINRCompact(number) {
  return '₹' + Math.round(Number(number || 0)).toLocaleString('en-IN');
}

// Format exact timestamp for display
function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const dateStr = date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short'
  });
  const timeStr = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
  return `${dateStr} • ${timeStr}`;
}

// ==========================================================================
// Rendering Engine
// ==========================================================================
function renderAll() {
  const balances = calculateBalances();
  renderBalances(balances);
  renderWarnings(balances);
  renderPartnerReminders();
  renderRecentTransactions();
  renderMonthlyAnalytics();
  renderHistory();
  renderWidgetView(balances);
  renderPartnerSettings();
  renderNotificationSettings();
  updateAccountSegments(balances);
  updateDateBadges();
}

function renderBalances(balances) {
  // Hero Section
  document.getElementById('totalBalanceDisplay').textContent = formatINR(balances.totalBalance);
  document.getElementById('totalInitialDisplay').textContent = formatINRCompact(balances.totalInitial);
  document.getElementById('totalSpentDisplay').textContent = formatINRCompact(balances.totalSpent);

  // BOB Ledger Column
  document.getElementById('bobBalance').textContent = formatINR(balances.bobTotal);
  document.getElementById('bobSpent').textContent = formatINRCompact(balances.bobSpent);

  // ICICI Ledger Column
  document.getElementById('iciciBalance').textContent = formatINR(balances.iciciTotal);
  document.getElementById('iciciSpent').textContent = formatINRCompact(balances.iciciSpent);

  // Desktop Sidebar Balance Summary
  const sidebarBob = document.getElementById('sidebarBobBal');
  const sidebarIcici = document.getElementById('sidebarIciciBal');
  if (sidebarBob) sidebarBob.textContent = formatINR(balances.bobTotal);
  if (sidebarIcici) sidebarIcici.textContent = formatINR(balances.iciciTotal);

  // Settings inputs
  document.getElementById('setBobInitial').value = state.initialBalances.BOB;
  document.getElementById('setIciciInitial').value = state.initialBalances.ICICI;
}

function renderPartnerReminders() {
  const container = document.getElementById('partnerRemindersList');
  const section = document.getElementById('partnerRemindersSection');
  const badge = document.getElementById('reminderCountBadge');
  const partnerLabel = document.getElementById('spentPartnerLabel');

  if (partnerLabel) {
    partnerLabel.textContent = `${state.partner.name || 'Partner'} Spent`;
  }

  if (!container || !section) return;

  const count = state.partnerReminders.length;
  if (badge) {
    badge.textContent = `${count} pending`;
  }

  if (count === 0) {
    section.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = '';

  state.partnerReminders.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'reminder-card-item';

    const pName = r.partnerName || state.partner.name || 'Partner';
    const upiLink = (r.partnerUpi || state.partner.upiId)
      ? `<a href="upi://pay?pa=${encodeURIComponent(r.partnerUpi || state.partner.upiId)}&pn=${encodeURIComponent(pName)}&am=${r.amount}&tn=For%20${encodeURIComponent(r.description)}" class="secondary-outline-btn pay-upi-btn">Pay via UPI</a>`
      : '';

    card.innerHTML = `
      <div class="reminder-card-top">
        <span class="reminder-pill">BOB REIMBURSEMENT DUE</span>
        <span class="reminder-time">${formatTimestamp(r.datetime)}</span>
      </div>
      <div class="reminder-message-hero">
        You should send <strong class="reminder-amt">${formatINR(r.amount)}</strong> for <strong>${escapeHtml(r.description)}</strong> to your partner (${escapeHtml(pName)}).
      </div>
      <div class="reminder-meta-line">
        <span>Paid to: <strong>${escapeHtml(r.toWhom)}</strong></span>
        <span>• Category: <strong>${escapeHtml(r.category)}</strong></span>
        <span>• Target Account: <strong>BOB</strong></span>
      </div>
      <div class="reminder-actions-row">
        <button type="button" class="paid-settle-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
          <span>I Paid (Deduct from BOB)</span>
        </button>
        ${upiLink}
        <button type="button" class="dismiss-reminder-btn">Dismiss</button>
      </div>
    `;

    // Click handler for I Paid
    card.querySelector('.paid-settle-btn').addEventListener('click', () => {
      markReminderAsPaid(r.id);
    });

    // Click handler for dismiss
    card.querySelector('.dismiss-reminder-btn').addEventListener('click', () => {
      dismissReminder(r.id);
    });

    container.appendChild(card);
  });
}

function markReminderAsPaid(reminderId) {
  const index = state.partnerReminders.findIndex((r) => r.id === reminderId);
  if (index === -1) return;

  const reminder = state.partnerReminders[index];
  const pName = reminder.partnerName || state.partner.name || 'Partner';

  // 1. Remove from active reminders (stops the reminder)
  state.partnerReminders.splice(index, 1);

  // 2. Deduct from BOB account balance by recording settlement transaction
  const settlementTx = {
    id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    type: 'expense',
    amount: Number(reminder.amount),
    account: 'BOB',
    category: reminder.category || 'Other',
    toWhom: pName,
    description: `Reimbursed ${pName} for ${reminder.description} (${reminder.toWhom})`,
    datetime: new Date().toISOString()
  };

  state.transactions.unshift(settlementTx);
  saveData();
  renderAll();

  // 3. Feedback to user
  showToast(`Settled! ${formatINR(reminder.amount)} deducted from BOB balance. Reminder stopped.`);

  // Check low balance alert
  const balances = calculateBalances();
  if (balances.bobTotal < 500) {
    showToast(`Notice: BOB balance is now ${formatINR(balances.bobTotal)} (below ₹500)!`, 'warning');
  }

  // Automatic WhatsApp notification when paid
  const paidMsg = `TrackFlow BOB Payment Notice:\n` +
    `Hi ${pName}, I have sent ₹${reminder.amount} for "${reminder.description}".\n` +
    `Settled on: ${formatTimestamp(settlementTx.datetime)}\n` +
    `Updated BOB Balance: ${formatINR(balances.bobTotal)}`;
  sendToWhatsApp(paidMsg);
}

function dismissReminder(reminderId) {
  if (confirm('Dismiss this reminder without deducting the amount from BOB?')) {
    state.partnerReminders = state.partnerReminders.filter((r) => r.id !== reminderId);
    saveData();
    renderAll();
    showToast('Reminder dismissed');
  }
}

function showPartnerSpendAlert(reminder) {
  state.currentAlertReminder = reminder;
  const balances = calculateBalances();
  const pName = reminder.partnerName || state.partner.name || 'Partner';

  const headline = document.getElementById('partnerAlertHeadline');
  if (headline) {
    headline.textContent = `New BOB Spend from ${pName}`;
  }

  const body = document.getElementById('partnerAlertBody');
  if (body) {
    body.innerHTML = `You should send <strong>${formatINR(reminder.amount)}</strong> for <strong>${escapeHtml(reminder.description)}</strong> to your partner (${escapeHtml(pName)}).`;
  }

  document.getElementById('alertAmount').textContent = formatINR(reminder.amount);
  document.getElementById('alertDescription').textContent = reminder.description || '-';
  document.getElementById('alertToWhom').textContent = reminder.toWhom || '-';
  document.getElementById('alertPartnerName').textContent = pName;
  document.getElementById('alertBobCurBal').textContent = formatINR(balances.bobTotal);

  openModal('partnerSpendAlertModal');
}

function renderPartnerSettings() {
  const nameInput = document.getElementById('partnerNameInput');
  const phoneInput = document.getElementById('partnerPhoneInput');
  const upiInput = document.getElementById('partnerUpiInput');
  const autoCheckbox = document.getElementById('autoNotifyBobCheckbox');

  if (nameInput) nameInput.value = state.partner.name || '';
  if (phoneInput) phoneInput.value = state.partner.phone || '';
  if (upiInput) upiInput.value = state.partner.upiId || '';
  if (autoCheckbox) autoCheckbox.checked = state.partner.autoNotifyBob !== false;

  // Contact settings are controlled by Netlify environment variables, not per-device edits.
  [nameInput, phoneInput, upiInput].forEach((input) => { if (input) input.readOnly = true; });
  if (autoCheckbox) autoCheckbox.disabled = true;
  const saveButton = document.querySelector('#partnerSettingsForm button[type="submit"]');
  if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Managed by deployment settings'; }
}

function renderNotificationSettings() {
  const toggle = document.getElementById('recurringRemindersToggle');
  const select = document.getElementById('reminderIntervalSelect');
  const sound = document.getElementById('notifySoundToggle');
  const lowBal = document.getElementById('lowBalanceRepeatToggle');
  const sys = document.getElementById('systemNotifyToggle');
  const badge = document.getElementById('systemNotifyStatusBadge');

  if (toggle) toggle.checked = state.notificationSettings.enabled !== false;
  if (select) select.value = String(state.notificationSettings.intervalMinutes || 15);
  if (sound) sound.checked = state.notificationSettings.soundChime !== false;
  if (lowBal) lowBal.checked = state.notificationSettings.lowBalanceAlerts !== false;
  if (sys) sys.checked = state.notificationSettings.notifySystem !== false;

  if (badge) {
    if (!('Notification' in window)) {
      badge.textContent = 'Not Supported';
      badge.style.background = '#E5E7EB';
      badge.style.color = '#374151';
    } else if (Notification.permission === 'granted') {
      badge.textContent = 'Active: Granted';
      badge.style.background = 'var(--sage-tint)';
      badge.style.color = 'var(--sage-dark)';
    } else if (Notification.permission === 'denied') {
      badge.textContent = 'Blocked by Browser';
      badge.style.background = 'var(--alert-red-tint)';
      badge.style.color = 'var(--alert-red)';
    } else {
      badge.textContent = 'Tap to Enable';
      badge.style.background = 'var(--bob-tint)';
      badge.style.color = 'var(--bob-accent)';
    }
  }
}

// Synthesize pleasant two-tone chime via Web Audio API (100% offline)
function playReminderChime() {
  if (!state.notificationSettings.soundChime) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.14); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(440, now);
    osc2.frequency.exponentialRampToValueAtTime(659.25, now + 0.14); // E5

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  } catch (err) {
    // Autoplay restrictions or unsupported audio
  }
}

function triggerSystemNotification(title, body) {
  if (!state.notificationSettings.notifySystem || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, {
            body: body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'trackflow-reminder-' + Date.now()
          });
        }).catch(() => {
          new Notification(title, { body: body, icon: './icons/icon-192.png' });
        });
      } else {
        new Notification(title, { body: body, icon: './icons/icon-192.png' });
      }
    } catch (e) {
      // Fallback
    }
  }
}

// Display high-visibility Pop-up Reminder with actions on screen
function popReminderToast(title, body, reminderId) {
  playReminderChime();
  triggerSystemNotification(title, body.replace(/<[^>]*>?/gm, ''));

  const container = document.getElementById('toastContainer');
  if (!container) return;

  const popup = document.createElement('div');
  popup.className = 'recurring-popup-toast';

  popup.innerHTML = `
    <div class="popup-toast-top">
      <span class="popup-tag">${escapeHtml(title)}</span>
      <button type="button" class="popup-close-x" aria-label="Close">✕</button>
    </div>
    <div class="popup-toast-body">${body}</div>
    ${reminderId ? `
      <div class="popup-toast-actions">
        <button type="button" class="popup-pay-btn">✓ I Paid (Deduct BOB)</button>
        <button type="button" class="popup-later-btn">Remind Later</button>
      </div>
    ` : ''}
  `;

  popup.querySelector('.popup-close-x')?.addEventListener('click', () => {
    popup.remove();
  });

  if (reminderId) {
    popup.querySelector('.popup-pay-btn')?.addEventListener('click', () => {
      popup.remove();
      markReminderAsPaid(reminderId);
    });

    popup.querySelector('.popup-later-btn')?.addEventListener('click', () => {
      popup.remove();
      showToast('Reminder will pop up again');
    });
  } else {
    // Auto remove informational toast after 6 seconds
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, 6000);
  }

  container.appendChild(popup);
}

// Recurring reminder background ticker engine
let lastReminderPopTimestamp = Date.now();

function setupRecurringReminderEngine() {
  // Check every 10 seconds if it's time to pop a reminder
  setInterval(() => {
    if (!state.notificationSettings.enabled) return;

    const intervalMinutes = Number(state.notificationSettings.intervalMinutes) || 15;
    const intervalMs = intervalMinutes * 60 * 1000;
    const now = Date.now();
    const elapsed = now - lastReminderPopTimestamp;

    if (elapsed >= intervalMs) {
      lastReminderPopTimestamp = now;

      // 1. If there are active partner reminders, pop the reminder!
      if (state.partnerReminders && state.partnerReminders.length > 0) {
        const r = state.partnerReminders[0];
        const pName = r.partnerName || state.partner.name || 'Partner';
        const title = 'REMINDER: PARTNER REIMBURSEMENT DUE';
        const bodyText = `You should send <strong>${formatINR(r.amount)}</strong> for <strong>${escapeHtml(r.description)}</strong> to your partner (${escapeHtml(pName)}).`;

        popReminderToast(title, bodyText, r.id);
        return;
      }

      // 2. If accounts are low (< 500), keep popping low balance notice
      if (state.notificationSettings.lowBalanceAlerts) {
        const balances = calculateBalances();
        if (balances.bobTotal < 500 || balances.iciciTotal < 500) {
          const title = 'LOW BALANCE ALERT (< ₹500)';
          let msg = '';
          if (balances.bobTotal < 500 && balances.iciciTotal < 500) {
            msg = `Both BOB (${formatINR(balances.bobTotal)}) & ICICI (${formatINR(balances.iciciTotal)}) are below ₹500!`;
          } else if (balances.bobTotal < 500) {
            msg = `BOB balance is critically low: ${formatINR(balances.bobTotal)} left (below ₹500 threshold)!`;
          } else {
            msg = `ICICI balance is critically low: ${formatINR(balances.iciciTotal)} left (below ₹500 threshold)!`;
          }
          popReminderToast(title, msg, null);
        }
      }
    }
  }, 10000);
}

// Low Balance Warning Alert (< 500 Rs)
function renderWarnings(balances) {
  const isBobLow = balances.bobTotal < 500;
  const isIciciLow = balances.iciciTotal < 500;

  const bobCard = document.getElementById('bobCard');
  const iciciCard = document.getElementById('iciciCard');
  const bobWarningBadge = document.getElementById('bobWarningBadge');
  const iciciWarningBadge = document.getElementById('iciciWarningBadge');
  const globalWarning = document.getElementById('globalWarningBanner');
  const warningText = document.getElementById('warningBannerText');

  // BOB Low warning
  if (isBobLow) {
    bobCard.classList.add('low-balance-alert');
    bobWarningBadge.style.display = 'inline-flex';
  } else {
    bobCard.classList.remove('low-balance-alert');
    bobWarningBadge.style.display = 'none';
  }

  // ICICI Low warning
  if (isIciciLow) {
    iciciCard.classList.add('low-balance-alert');
    iciciWarningBadge.style.display = 'inline-flex';
  } else {
    iciciCard.classList.remove('low-balance-alert');
    iciciWarningBadge.style.display = 'none';
  }

  // Global Callout Banner
  if ((isBobLow || isIciciLow) && !state.warningDismissed) {
    globalWarning.style.display = 'block';
    if (isBobLow && isIciciLow) {
      warningText.textContent = `Both BOB (${formatINR(balances.bobTotal)}) & ICICI (${formatINR(balances.iciciTotal)}) have dropped below ₹500!`;
    } else if (isBobLow) {
      warningText.textContent = `BOB balance is critically low: only ${formatINR(balances.bobTotal)} left (below ₹500 threshold)!`;
    } else {
      warningText.textContent = `ICICI balance is critically low: only ${formatINR(balances.iciciTotal)} left (below ₹500 threshold)!`;
    }
  } else {
    globalWarning.style.display = 'none';
  }
}

// Update Account Selector Segments & Balance Hints
function updateAccountSegments(balances) {
  const bobSub = document.getElementById('segmentBobBal');
  const iciciSub = document.getElementById('segmentIciciBal');

  if (bobSub) {
    bobSub.textContent = `Avail: ${formatINRCompact(balances.bobTotal)}${balances.bobTotal < 500 ? ' (Low)' : ''}`;
  }
  if (iciciSub) {
    iciciSub.textContent = `Avail: ${formatINRCompact(balances.iciciTotal)}${balances.iciciTotal < 500 ? ' (Low)' : ''}`;
  }
}

// ==========================================================================
// Monthly Analytics & Category Insights
// ==========================================================================
function renderMonthlyAnalytics() {
  const monthInput = document.getElementById('selectedMonthInput');
  monthInput.value = state.selectedMonth;

  // Filter transactions for this month
  const monthTxs = state.transactions.filter(
    (tx) => tx.datetime && tx.datetime.startsWith(state.selectedMonth)
  );

  const monthExpenses = monthTxs.filter((tx) => tx.type === 'expense');

  let monthTotalSpent = 0;
  let monthBobSpent = 0;
  let monthIciciSpent = 0;
  const categoryTotals = {};
  const payeeTotals = {};

  monthExpenses.forEach((tx) => {
    const amt = Number(tx.amount || 0);
    monthTotalSpent += amt;

    if (tx.account === 'BOB') monthBobSpent += amt;
    if (tx.account === 'ICICI') monthIciciSpent += amt;

    const cat = tx.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;

    const payee = tx.toWhom ? tx.toWhom.trim() : 'Unknown';
    if (payee) {
      payeeTotals[payee] = (payeeTotals[payee] || 0) + amt;
    }
  });

  // Calculate Cumulative Balance left at the end of that month:
  const [selYear, selMonth] = state.selectedMonth.split('-').map(Number);
  const nextMonthFirstDay = new Date(selYear, selMonth, 1).toISOString();

  let balanceLeftEndOfMonth = Number(state.initialBalances.BOB || 0) + Number(state.initialBalances.ICICI || 0);
  state.transactions.forEach((tx) => {
    if (tx.datetime && tx.datetime < nextMonthFirstDay) {
      const amt = Number(tx.amount || 0);
      if (tx.type === 'deposit') {
        balanceLeftEndOfMonth += amt;
      } else {
        balanceLeftEndOfMonth -= amt;
      }
    }
  });

  // Update Monthly Figures Grid
  document.getElementById('monthTotalSpent').textContent = formatINR(monthTotalSpent);
  document.getElementById('monthTxCount').textContent = `${monthExpenses.length} transactions`;
  document.getElementById('monthRemainingBalance').textContent = formatINR(balanceLeftEndOfMonth);
  document.getElementById('monthBobSpent').textContent = formatINR(monthBobSpent);
  document.getElementById('monthIciciSpent').textContent = formatINR(monthIciciSpent);

  const curBalances = calculateBalances();
  document.getElementById('monthBobBalanceNow').textContent = `Bal: ${formatINRCompact(curBalances.bobTotal)}`;
  document.getElementById('monthIciciBalanceNow').textContent = `Bal: ${formatINRCompact(curBalances.iciciTotal)}`;

  // Find Top Category
  let topCat = null;
  let maxCatAmount = 0;

  Object.entries(categoryTotals).forEach(([cat, amount]) => {
    if (amount > maxCatAmount) {
      maxCatAmount = amount;
      topCat = cat;
    }
  });

  const topCatNameEl = document.getElementById('topCatName');
  const topCatStatsEl = document.getElementById('topCatStats');
  const topCatAmountEl = document.getElementById('topCatAmountDisplay');

  if (topCat && monthTotalSpent > 0) {
    const percentage = ((maxCatAmount / monthTotalSpent) * 100).toFixed(1);
    topCatNameEl.textContent = topCat;
    topCatStatsEl.textContent = `${percentage}% of total monthly spending (${monthExpenses.filter(t => t.category === topCat).length} transactions)`;
    topCatAmountEl.textContent = formatINR(maxCatAmount);

    // Dashboard quick preview
    document.getElementById('previewTopCat').textContent = topCat;
    document.getElementById('previewTopCatAmount').textContent = `${formatINR(maxCatAmount)} spent`;
    document.getElementById('previewMonthRemaining').textContent = formatINRCompact(balanceLeftEndOfMonth);
  } else {
    topCatNameEl.textContent = 'No Expenses Yet';
    topCatStatsEl.textContent = 'Add expenses to see top category analysis';
    topCatAmountEl.textContent = '₹0';

    // Dashboard quick preview
    document.getElementById('previewTopCat').textContent = 'None';
    document.getElementById('previewTopCatAmount').textContent = '₹0 spent';
    document.getElementById('previewMonthRemaining').textContent = formatINRCompact(balanceLeftEndOfMonth);
  }

  // Render Category Breakdown Bars
  renderCategoryBars(categoryTotals, monthTotalSpent);

  // Render Top Payees List
  renderPayeeList(payeeTotals);
}

function renderCategoryBars(categoryTotals, totalSpent) {
  const container = document.getElementById('categoryBreakdownList');
  container.innerHTML = '';

  const sortedCats = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);

  if (sortedCats.length === 0) {
    container.innerHTML = `
      <div class="empty-ledger-state">
        <p>No category expenses recorded for this month</p>
      </div>
    `;
    return;
  }

  sortedCats.forEach(([cat, amount]) => {
    const percent = totalSpent > 0 ? ((amount / totalSpent) * 100).toFixed(1) : 0;

    const item = document.createElement('div');
    item.className = 'cat-breakdown-item';
    item.innerHTML = `
      <div class="cat-breakdown-row">
        <div class="cat-label-wrap">
          <span>${cat}</span>
        </div>
        <div class="cat-amount-wrap">
          <span>${formatINR(amount)}</span>
          <span class="cat-percent-label">(${percent}%)</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${percent}%;"></div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderPayeeList(payeeTotals) {
  const container = document.getElementById('payeeBreakdownList');
  container.innerHTML = '';

  const sortedPayees = Object.entries(payeeTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (sortedPayees.length === 0) {
    container.innerHTML = `
      <div class="empty-ledger-state">
        <p>No recipients recorded this month</p>
      </div>
    `;
    return;
  }

  sortedPayees.forEach(([payee, amount]) => {
    const item = document.createElement('div');
    item.className = 'payee-item';
    item.innerHTML = `
      <span class="payee-name">${escapeHtml(payee)}</span>
      <span class="payee-amount">${formatINR(amount)}</span>
    `;
    container.appendChild(item);
  });
}

// ==========================================================================
// Transaction Rows (Card-Free Editorial Ledger)
// ==========================================================================
function renderRecentTransactions() {
  const container = document.getElementById('recentTransactionList');
  container.innerHTML = '';

  const recent = [...state.transactions].sort((a, b) => new Date(b.datetime) - new Date(a.datetime)).slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = `
      <div class="empty-ledger-state">
        <p>No transactions recorded yet. Tap "+ Record Expense" to start.</p>
      </div>
    `;
    return;
  }

  recent.forEach((tx) => {
    container.appendChild(createLedgerRow(tx, false));
  });
}

function renderHistory() {
  const container = document.getElementById('fullTransactionList');
  container.innerHTML = '';

  const query = (document.getElementById('historySearchInput').value || '').toLowerCase().trim();
  const accFilter = document.getElementById('historyAccountFilter').value;
  const catFilter = document.getElementById('historyCategoryFilter').value;

  let filtered = [...state.transactions].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  if (accFilter !== 'ALL') {
    filtered = filtered.filter((tx) => tx.account === accFilter);
  }

  if (catFilter !== 'ALL') {
    filtered = filtered.filter((tx) => tx.category === catFilter);
  }

  if (query) {
    filtered = filtered.filter((tx) => {
      const desc = (tx.description || '').toLowerCase();
      const toWhom = (tx.toWhom || '').toLowerCase();
      const cat = (tx.category || '').toLowerCase();
      return desc.includes(query) || toWhom.includes(query) || cat.includes(query);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-ledger-state">
        <p>No transactions match your search filter</p>
      </div>
    `;
    return;
  }

  filtered.forEach((tx) => {
    container.appendChild(createLedgerRow(tx, true));
  });
}

function createLedgerRow(tx, allowDelete = false) {
  const row = document.createElement('div');
  row.className = 'ledger-row';

  const isDeposit = tx.type === 'deposit';
  const timestampText = formatTimestamp(tx.datetime);
  const payee = tx.toWhom ? escapeHtml(tx.toWhom) : 'Self';
  const desc = escapeHtml(tx.description || tx.category || 'Expense');
  const isBob = tx.account === 'BOB';

  row.innerHTML = `
    <div class="row-left">
      <span class="row-payee">${payee}</span>
      <span class="row-desc">${desc}</span>
      <div class="row-meta-line">
        <span class="row-acc-pill ${tx.account}">${tx.account}</span>
        <span class="row-cat-pill">${escapeHtml(tx.category || 'General')}</span>
        <span>• ${timestampText}</span>
        ${isBob ? `
          <button class="partner-share-badge-btn notify-tx-btn" data-id="${tx.id}" title="Send notification directly in WhatsApp">
            WhatsApp
          </button>
        ` : ''}
      </div>
    </div>
    <div class="row-right">
      <span class="row-amount ${isDeposit ? 'deposit' : 'expense'}">
        ${isDeposit ? '+' : '-'}${formatINR(tx.amount)}
      </span>
      ${allowDelete ? `
        <button class="row-del-btn" data-id="${tx.id}">Delete</button>
      ` : ''}
    </div>
  `;

  // Attach direct WhatsApp trigger
  const notifyBtn = row.querySelector('.notify-tx-btn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const msg = generateBobNotifyText(tx);
      sendToWhatsApp(msg);
    });
  }

  if (allowDelete) {
    const delBtn = row.querySelector('.row-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTransaction(tx.id);
      });
    }
  }

  return row;
}

function deleteTransaction(id) {
  if (confirm('Delete this transaction?')) {
    const txToDelete = state.transactions.find((t) => t.id === id) || (state.privateAccounts.transactions || []).find((t) => t.id === id);
    if (txToDelete) {
      const bucket = txToDelete.account === 'BOB' ? 'BOB' : 'PRIVATE';
      state.deletedTransactionIds[bucket] = Array.from(new Set([...(state.deletedTransactionIds[bucket] || []), id]));
    }
    state.transactions = state.transactions.filter((t) => t.id !== id);
    state.privateAccounts.transactions = (state.privateAccounts.transactions || []).filter((t) => t.id !== id);
    saveData();
    renderAll();
    showToast('Transaction removed from ledger');
  }
}

// ==========================================================================
// BOB Partner Notification & Statement Engine
// ==========================================================================
function openPartnerNotifyModal(tx, customRemainingBal) {
  state.currentNotifyTx = tx;
  const balances = calculateBalances();
  const bobBal = customRemainingBal !== undefined ? customRemainingBal : balances.bobTotal;
  const partnerName = state.partner.name || 'Partner';

  const titleEl = document.getElementById('partnerModalTitle');
  if (titleEl) titleEl.textContent = `Notify ${partnerName}`;

  const sublineEl = document.getElementById('partnerModalSubline');
  if (sublineEl) sublineEl.textContent = `Share details of what was spent on what from BOB:`;

  document.getElementById('notifyAmount').textContent = formatINR(tx.amount);
  document.getElementById('notifyDescription').textContent = tx.description || '-';
  document.getElementById('notifyToWhom').textContent = tx.toWhom || '-';
  document.getElementById('notifyCategory').textContent = tx.category || '-';
  document.getElementById('notifyTimestamp').textContent = formatTimestamp(tx.datetime);
  document.getElementById('notifyRemainingBal').textContent = formatINR(bobBal);

  openModal('partnerNotifyModal');
}

function generateBobNotifyText(tx, customRemainingBal) {
  const balances = calculateBalances();
  const bobBal = customRemainingBal !== undefined ? customRemainingBal : balances.bobTotal;
  const partnerName = state.partner.name || 'Partner';

  return `TrackFlow BOB Spend Notice for ${partnerName}:\n` +
    `• Amount: ${formatINR(tx.amount)}\n` +
    `• Spent For: ${tx.description}\n` +
    `• Paid To: ${tx.toWhom}\n` +
    `• Category: ${tx.category}\n` +
    `• Time: ${formatTimestamp(tx.datetime)}\n` +
    `• Remaining BOB Balance: ${formatINR(bobBal)}`;
}

function sendToWhatsApp(text) {
  // Use the full international WhatsApp number supplied by the Netlify function.
  const cleanPhone = (state.partner.phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone) {
    showToast('Partner WhatsApp number is missing. Set TRACKFLOW_PARTNER_WHATSAPP_PHONE in Netlify.');
    return;
  }
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
  const win = window.open(url, '_blank');
  if (!win) window.location.href = url;
  showToast('WhatsApp opened with the message ready to send.');
}

function shareViaSystem(text, title = 'BOB Spend Update') {
  if (navigator.share) {
    navigator.share({
      title: title,
      text: text
    }).then(() => {
      showToast('Shared with partner!');
    }).catch(() => {
      copyToClipboard(text, 'Notification copied to clipboard!');
    });
  } else {
    copyToClipboard(text, 'Notification update copied! Paste in SMS or chat.');
  }
}

function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg);
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast(successMsg);
}

function openBobPartnerStatementModal() {
  const balances = calculateBalances();
  document.getElementById('bobPartnerCurBal').textContent = formatINR(balances.bobTotal);
  document.getElementById('bobPartnerTotalSpent').textContent = formatINR(balances.bobSpent);

  const container = document.getElementById('bobPartnerTxList');
  container.innerHTML = '';

  const bobTxs = state.transactions.filter((t) => t.account === 'BOB');

  if (bobTxs.length === 0) {
    container.innerHTML = `
      <div class="empty-ledger-state">
        <p>No transactions recorded under BOB account yet.</p>
      </div>
    `;
  } else {
    bobTxs.forEach((tx) => {
      container.appendChild(createLedgerRow(tx, true));
    });
  }

  openModal('bobPartnerStatementModal');
}

function shareBobMonthlyStatement() {
  const curMonth = state.selectedMonth;
  const bobMonthTxs = state.transactions.filter(
    (t) => t.account === 'BOB' && t.datetime && t.datetime.startsWith(curMonth) && t.type === 'expense'
  );
  const balances = calculateBalances();

  let totalBobMonth = 0;
  let itemsList = '';
  bobMonthTxs.forEach((tx, idx) => {
    totalBobMonth += Number(tx.amount || 0);
    itemsList += `${idx + 1}. ${tx.description} (${tx.toWhom}) - ${formatINR(tx.amount)} [${formatTimestamp(tx.datetime)}]\n`;
  });

  const partnerName = state.partner.name || 'Partner';
  const summaryMsg = `TrackFlow BOB Statement for ${partnerName} (${curMonth}):\n` +
    `• Current BOB Balance: ${formatINR(balances.bobTotal)}\n` +
    `• Total Spent from BOB: ${formatINR(totalBobMonth)}\n` +
    `• Transactions (${bobMonthTxs.length}):\n${itemsList || 'No expenses this month.\n'}`;

  shareViaSystem(summaryMsg, `BOB Statement for ${partnerName}`);
}

// ==========================================================================
// Timestamp Engine (Default Current Time or Custom Pick)
// ==========================================================================
function setupTimestampEngine() {
  const liveClockDisplay = document.getElementById('liveClockDisplay');
  const toggleBtn = document.getElementById('toggleCustomTimeBtn');
  const liveNotice = document.getElementById('liveTimestampNotice');
  const customContainer = document.getElementById('customDatetimeContainer');
  const customInput = document.getElementById('expDateTime');
  const resetBtn = document.getElementById('resetLiveTimeBtn');

  // Live ticking clock for default timestamp preview
  function updateLiveClock() {
    if (!state.isCustomTimeEnabled && liveClockDisplay) {
      const now = new Date();
      liveClockDisplay.textContent = now.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short'
      }) + ', ' + now.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
  }

  updateLiveClock();
  setInterval(updateLiveClock, 1000);

  // Toggle Custom DateTime Picker
  toggleBtn?.addEventListener('click', () => {
    state.isCustomTimeEnabled = true;
    liveNotice.style.display = 'none';
    customContainer.style.display = 'flex';
    toggleBtn.style.display = 'none';

    // Populate custom picker with current local time as starting point
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localIso = new Date(now.getTime() - offset).toISOString().slice(0, 16);
    customInput.value = localIso;
    customInput.focus();
  });

  // Reset to Live Automatic Timestamp
  resetBtn?.addEventListener('click', () => {
    state.isCustomTimeEnabled = false;
    customContainer.style.display = 'none';
    liveNotice.style.display = 'flex';
    toggleBtn.style.display = 'inline-block';
    updateLiveClock();
  });
}

// ==========================================================================
// Widget Modal View
// ==========================================================================
function renderWidgetView(balances) {
  document.getElementById('widgetBobBal').textContent = formatINRCompact(balances.bobTotal);
  document.getElementById('widgetIciciBal').textContent = formatINRCompact(balances.iciciTotal);

  const bobStatus = document.getElementById('widgetBobStatus');
  const iciciStatus = document.getElementById('widgetIciciStatus');
  const widgetWarningStrip = document.getElementById('widgetWarningStrip');

  if (balances.bobTotal < 500) {
    bobStatus.textContent = 'Below ₹500';
    bobStatus.style.color = '#B91C1C';
  } else {
    bobStatus.textContent = 'Normal';
    bobStatus.style.color = '#626A65';
  }

  if (balances.iciciTotal < 500) {
    iciciStatus.textContent = 'Below ₹500';
    iciciStatus.style.color = '#B91C1C';
  } else {
    iciciStatus.textContent = 'Normal';
    iciciStatus.style.color = '#626A65';
  }

  if (balances.bobTotal < 500 || balances.iciciTotal < 500) {
    widgetWarningStrip.style.display = 'flex';
  } else {
    widgetWarningStrip.style.display = 'none';
  }

  const previewTop = document.getElementById('previewTopCat').textContent;
  const previewMonthRem = document.getElementById('previewMonthRemaining').textContent;
  document.getElementById('widgetTopCat').textContent = previewTop;
  document.getElementById('widgetMonthLeft').textContent = previewMonthRem;
}

// ==========================================================================
// Form & User Actions
// ==========================================================================
function setupEventListeners() {
  // Navigation Tabs (Mobile Bottom Bar)
  document.querySelectorAll('.editorial-bottom-nav .nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  // Navigation Tabs (Desktop Side Panel)
  document.querySelectorAll('.sidebar-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (targetTab) switchTab(targetTab);
    });
  });

  // Action links
  document.getElementById('quickRecordBtn')?.addEventListener('click', () => {
    switchTab('tab-add');
  });

  document.getElementById('viewMonthlySummaryBtn')?.addEventListener('click', () => {
    switchTab('tab-analytics');
  });

  document.getElementById('seeAllHistoryBtn')?.addEventListener('click', () => {
    switchTab('tab-history');
  });

  // BOB Partner Ledger Triggers
  document.getElementById('dashboardPairPartnerBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('tab-settings');
    const targetBlock = document.getElementById('partnerPairingSettingsBlock');
    if (targetBlock) {
      targetBlock.scrollIntoView({ behavior: 'smooth' });
    }
  });

  document.getElementById('openBobPartnerBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    openBobPartnerStatementModal();
  });

  document.getElementById('closeBobStatementBtn')?.addEventListener('click', () => {
    closeModal('bobPartnerStatementModal');
  });

  document.getElementById('closeBobStatementBottomBtn')?.addEventListener('click', () => {
    closeModal('bobPartnerStatementModal');
  });

  document.getElementById('shareMonthlyBobSummaryBtn')?.addEventListener('click', () => {
    shareBobMonthlyStatement();
  });

  document.getElementById('copyBobLedgerLinkBtn')?.addEventListener('click', () => {
    const partnerUrl = window.location.origin + window.location.pathname + '?view=bob';
    copyToClipboard(partnerUrl, 'Partner link copied! Send to partner to view BOB ledger.');
  });

  // Partner Notify Modal Actions
  document.getElementById('closePartnerNotifyBtn')?.addEventListener('click', () => {
    closeModal('partnerNotifyModal');
  });

  document.getElementById('sendPartnerWhatsAppBtn')?.addEventListener('click', () => {
    if (state.currentNotifyTx) {
      const msg = generateBobNotifyText(state.currentNotifyTx);
      sendToWhatsApp(msg);
      closeModal('partnerNotifyModal');
    }
  });

  document.getElementById('sharePartnerSysBtn')?.addEventListener('click', () => {
    if (state.currentNotifyTx) {
      const msg = generateBobNotifyText(state.currentNotifyTx);
      shareViaSystem(msg, `BOB Spend for ${state.partner.name || 'Partner'}`);
      closeModal('partnerNotifyModal');
    }
  });

  document.getElementById('copyPartnerTextBtn')?.addEventListener('click', () => {
    if (state.currentNotifyTx) {
      const msg = generateBobNotifyText(state.currentNotifyTx);
      copyToClipboard(msg, 'Spend details copied! Ready to paste into chat.');
    }
  });

  // Partner Settings Form
  document.getElementById('partnerSettingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('Partner contact settings are managed by Netlify environment variables.');
  });

  // Partner Quick Request Link & WhatsApp invite
  document.getElementById('copyPartnerSpendLinkBtn')?.addEventListener('click', () => {
    const pairUrl = `${window.location.origin}${window.location.pathname}?action=partner_spend`;
    copyToClipboard(pairUrl, 'Partner link copied! Send to your partner so they can record spends on BOB.');
  });

  document.getElementById('sendPartnerPairWhatsAppBtn')?.addEventListener('click', () => {
    const pairUrl = `${window.location.origin}${window.location.pathname}?action=partner_spend`;
    const partnerName = state.partner.name || 'Partner';
    const msg = `Hi ${partnerName}! Use this TrackFlow link whenever you spend on our Bank of Baroda (BOB) account:\n\n${pairUrl}\n\nIt will notify me and remind me to reimburse you!`;
    sendToWhatsApp(msg);
  });

  // Simulate / Test Partner Spend Button
  document.getElementById('testPartnerSpendBtn')?.addEventListener('click', () => {
    const partnerTitle = document.getElementById('partnerPortalModalTitle');
    if (partnerTitle) {
      partnerTitle.textContent = `${state.partner.name || 'Partner'} Spends on BOB`;
    }
    openModal('partnerSpendPortalModal');
  });

  document.getElementById('closePartnerPortalBtn')?.addEventListener('click', () => {
    closeModal('partnerSpendPortalModal');
  });

  document.getElementById('cancelPartnerPortalBtn')?.addEventListener('click', () => {
    closeModal('partnerSpendPortalModal');
  });

  // Partner Portal Form Submission (Incoming Partner Spend)
  document.getElementById('partnerPortalForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('portalAmount').value);
    const description = document.getElementById('portalDescription').value.trim();
    const toWhom = document.getElementById('portalToWhom').value.trim();
    const category = document.getElementById('portalCategory').value;

    if (!amount || amount <= 0 || !description || !toWhom) {
      showToast('Please fill in all details', 'warning');
      return;
    }

    const reminder = {
      id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      amount: amount,
      account: 'BOB',
      category: category,
      toWhom: toWhom,
      description: description,
      partnerName: state.partner.name || 'Partner',
      partnerUpi: state.partner.upiId || '',
      datetime: new Date().toISOString()
    };

    state.partnerReminders.unshift(reminder);
    saveData();
    closeModal('partnerSpendPortalModal');

    // Reset fields
    document.getElementById('portalAmount').value = '';
    document.getElementById('portalDescription').value = '';
    document.getElementById('portalToWhom').value = '';

    renderAll();
    showToast(`Recorded BOB spend by ${state.partner.name || 'Partner'}! Reminder created.`);
    switchTab('tab-dashboard');
    showPartnerSpendAlert(reminder);
  });

  // Partner Spend Alert Modal Actions
  document.getElementById('closePartnerAlertBtn')?.addEventListener('click', () => {
    closeModal('partnerSpendAlertModal');
  });

  document.getElementById('alertRemindLaterBtn')?.addEventListener('click', () => {
    closeModal('partnerSpendAlertModal');
    switchTab('tab-dashboard');
    showToast('Reminder kept on Dashboard');
  });

  document.getElementById('alertMarkPaidBtn')?.addEventListener('click', () => {
    if (state.currentAlertReminder) {
      const remId = state.currentAlertReminder.id;
      closeModal('partnerSpendAlertModal');
      markReminderAsPaid(remId);
    }
  });

  // Who Spent (Me vs Partner) Radio toggle behavior
  const radioSpentMe = document.getElementById('radioSpentMe');
  const radioSpentPartner = document.getElementById('radioSpentPartner');
  const partnerSpendNotice = document.getElementById('partnerSpendNotice');
  const saveExpenseBtn = document.getElementById('saveExpenseBtn');

  function updateWhoSpentState() {
    const isPartner = radioSpentPartner && radioSpentPartner.checked;
    if (partnerSpendNotice) {
      partnerSpendNotice.style.display = isPartner ? 'flex' : 'none';
    }
    if (saveExpenseBtn) {
      if (isPartner) {
        saveExpenseBtn.textContent = 'Record Partner Spend (Add Reminder)';
      } else {
        saveExpenseBtn.textContent = 'Save Transaction';
      }
    }
  }

  radioSpentMe?.addEventListener('change', updateWhoSpentState);
  radioSpentPartner?.addEventListener('change', updateWhoSpentState);

  // Account Segment Radio buttons (BOB / ICICI)
  const radioBob = document.getElementById('radioBob');
  const radioIcici = document.getElementById('radioIcici');
  const expAccountSelect = document.getElementById('expAccount');

  if (radioBob && radioIcici) {
    radioBob.addEventListener('change', () => {
      if (radioBob.checked) expAccountSelect.value = 'BOB';
    });
    radioIcici.addEventListener('change', () => {
      if (radioIcici.checked) expAccountSelect.value = 'ICICI';
    });
  }

  // Category Sage Pills Selector
  const categoryChips = document.querySelectorAll('.sage-pill');
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const cat = chip.getAttribute('data-cat');
      document.getElementById('expCategory').value = cat;
    });
  });

  // Quick Amount increment buttons
  document.querySelectorAll('.increment-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const amtInput = document.getElementById('expAmount');
      const addValue = Number(btn.getAttribute('data-amt') || 0);
      const current = Number(amtInput.value || 0);
      amtInput.value = (current + addValue).toFixed(0);
      amtInput.focus();
    });
  });

  // Expense Form Submit
  const expenseForm = document.getElementById('expenseForm');
  expenseForm.addEventListener('submit', handleAddExpenseSubmit);

  // Month navigation
  const monthInput = document.getElementById('selectedMonthInput');
  monthInput.addEventListener('change', (e) => {
    if (e.target.value) {
      state.selectedMonth = e.target.value;
      renderMonthlyAnalytics();
    }
  });

  document.getElementById('prevMonthBtn').addEventListener('click', () => {
    stepMonth(-1);
  });

  document.getElementById('nextMonthBtn').addEventListener('click', () => {
    stepMonth(1);
  });

  // History Search & Filters
  document.getElementById('historySearchInput').addEventListener('input', renderHistory);
  document.getElementById('historyAccountFilter').addEventListener('change', renderHistory);
  document.getElementById('historyCategoryFilter').addEventListener('change', renderHistory);

  // Initial Balances Form in Settings
  document.getElementById('initialBalancesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const bobVal = Number(document.getElementById('setBobInitial').value);
    const iciciVal = Number(document.getElementById('setIciciInitial').value);
    if (!Number.isFinite(bobVal) || !Number.isFinite(iciciVal) || bobVal < 0 || iciciVal < 0) {
      showToast('Initial balances must be valid numbers greater than or equal to zero.', 'warning');
      return;
    }

    state.initialBalances.BOB = bobVal;
    state.initialBalances.ICICI = iciciVal;
    saveData();
    renderAll();
    showToast('Starting balances updated!');
  });

  // Edit Account links on Dashboard
  document.querySelectorAll('.edit-acc-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab('tab-settings');
      showToast('Edit initial amounts in settings');
    });
  });

  // Add or remove funds from an account.
  function openFundsModal(mode) {
    fundsMode = mode;
    document.querySelector('#addFundsModal .dialog-title').textContent = mode === 'withdrawal' ? 'Remove Funds / Withdrawal' : 'Deposit / Add Funds';
    document.querySelector('#addFundsForm button[type="submit"]').textContent = mode === 'withdrawal' ? 'Remove from Balance' : 'Add to Balance';
    document.getElementById('fundNote').placeholder = mode === 'withdrawal' ? 'e.g. Cash withdrawal, transfer out' : 'e.g. Salary, UPI Transfer, Cash';
    openModal('addFundsModal');
  }
  document.getElementById('quickAddMoneyBtn').addEventListener('click', () => openFundsModal('deposit'));
  document.getElementById('quickRemoveMoneyBtn')?.addEventListener('click', () => openFundsModal('withdrawal'));

  document.getElementById('closeAddFundsBtn').addEventListener('click', () => {
    closeModal('addFundsModal');
  });

  document.getElementById('cancelAddFundsBtn').addEventListener('click', () => {
    closeModal('addFundsModal');
  });

  document.getElementById('addFundsForm').addEventListener('submit', handleAddFundsSubmit);

  // Widget Modal Overlay
  document.getElementById('openWidgetViewBtn').addEventListener('click', () => {
    openModal('widgetOverlay');
  });

  document.getElementById('desktopWidgetBtn')?.addEventListener('click', () => {
    openModal('widgetOverlay');
  });

  document.getElementById('closeWidgetBtn').addEventListener('click', () => {
    closeModal('widgetOverlay');
  });

  document.getElementById('widgetQuickSpendBtn').addEventListener('click', () => {
    closeModal('widgetOverlay');
    switchTab('tab-add');
  });

  // Mobile Guide Modal
  document.getElementById('openMobileGuideBtn')?.addEventListener('click', () => {
    openModal('mobileGuideModal');
  });

  document.getElementById('closeMobileGuideBtn')?.addEventListener('click', () => {
    closeModal('mobileGuideModal');
  });

  document.getElementById('gotItGuideBtn')?.addEventListener('click', () => {
    closeModal('mobileGuideModal');
  });

  // Welcome Form (First run)
  document.getElementById('welcomeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const bob = Number(document.getElementById('welcomeBob').value || 0);
    const icici = Number(document.getElementById('welcomeIcici').value || 0);

    state.initialBalances.BOB = bob;
    state.initialBalances.ICICI = icici;
    saveData();
    closeModal('welcomeModal');
    renderAll();
    showToast('Ledger initialized!');
  });

  // Dismiss Warning Banner
  document.getElementById('dismissWarningBtn')?.addEventListener('click', () => {
    state.warningDismissed = true;
    document.getElementById('globalWarningBanner').style.display = 'none';
  });

  // Backup & Export buttons
  document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
  document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);
  document.getElementById('importJsonInput').addEventListener('change', importFromJSON);

  // Notification & Reminder Settings Form
  document.getElementById('notificationSettingsForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    state.notificationSettings.enabled = document.getElementById('recurringRemindersToggle').checked;
    state.notificationSettings.intervalMinutes = parseInt(document.getElementById('reminderIntervalSelect').value, 10) || 15;
    state.notificationSettings.soundChime = document.getElementById('notifySoundToggle').checked;
    state.notificationSettings.lowBalanceAlerts = document.getElementById('lowBalanceRepeatToggle').checked;
    state.notificationSettings.notifySystem = document.getElementById('systemNotifyToggle').checked;
    saveData();
    renderNotificationSettings();
    showToast(`Notification settings saved! Reminders will pop up every ${state.notificationSettings.intervalMinutes} min.`);
  });

  // Enable System/Lock-Screen Notification Permission
  document.getElementById('enableSystemNotifyBtn')?.addEventListener('click', async () => {
    if ('Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        renderNotificationSettings();
        if (permission === 'granted') {
          triggerSystemNotification('TrackFlow Notifications Active', 'You will now receive recurring reminders on your device lock screen.');
          showToast('Lock-screen notifications enabled!');
        } else if (permission === 'denied') {
          showToast('Notification permission was blocked in browser settings', 'warning');
        } else {
          showToast('Notification permission prompt dismissed', 'warning');
        }
      } catch (err) {
        showToast('Notification permission request failed', 'warning');
      }
    } else {
      showToast('System notifications not supported in this browser', 'warning');
    }
  });

  // Test Notification Pop-up Button
  document.getElementById('testNotificationPopBtn')?.addEventListener('click', () => {
    if (state.partnerReminders && state.partnerReminders.length > 0) {
      const r = state.partnerReminders[0];
      const pName = r.partnerName || state.partner.name || 'Partner';
      popReminderToast('REMINDER: PARTNER SETTLEMENT DUE', `You should send <strong>${formatINR(r.amount)}</strong> for <strong>${escapeHtml(r.description)}</strong> to your partner (${escapeHtml(pName)}).`, r.id);
    } else {
      popReminderToast('TRACKFLOW POP-UP REMINDER', `Test Pop-up Successful! Pending settlements and reminders will pop up every <strong>${state.notificationSettings.intervalMinutes} minutes</strong> until settled.`, null);
    }
  });

  // Reset All Data
  document.getElementById('resetAllDataBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all transactions and balances? This cannot be undone.')) {
      localStorage.clear();
      state.initialBalances = { BOB: 0, ICICI: 0 };
      state.transactions = [];
      saveData();
      renderAll();
      showToast('All data has been reset.', 'warning');
    }
  });

  // Close modals on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.style.display = 'none';
      }
    });
  });
}

function updateDateBadges() {
  const dateBadge = document.getElementById('currentDateBadge');
  const today = new Date();
  dateBadge.textContent = today.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short'
  });
}

// Step Months forward/backward
function stepMonth(delta) {
  const [yearStr, monthStr] = state.selectedMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) + delta;

  if (month > 12) {
    month = 1;
    year += 1;
  } else if (month < 1) {
    month = 12;
    year -= 1;
  }

  state.selectedMonth = `${year}-${String(month).padStart(2, '0')}`;
  renderMonthlyAnalytics();
}

// ==========================================================================
// Handle Submissions
// ==========================================================================
function handleAddExpenseSubmit(e) {
  e.preventDefault();

  const amount = parseFloat(document.getElementById('expAmount').value);
  const account = document.querySelector('input[name="accountChoice"]:checked')?.value || 'BOB';
  const category = document.getElementById('expCategory').value;
  const toWhom = document.getElementById('expToWhom').value.trim();
  const description = document.getElementById('expDescription').value.trim();

  // Determine Timestamp: Current Time (Default) or Custom Selected Time
  let finalTimestamp;
  if (state.isCustomTimeEnabled) {
    const customVal = document.getElementById('expDateTime').value;
    if (customVal) {
      finalTimestamp = new Date(customVal).toISOString();
    } else {
      finalTimestamp = new Date().toISOString();
    }
  } else {
    // Exact timestamp recorded at the second of saving
    finalTimestamp = new Date().toISOString();
  }

  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'warning');
    return;
  }

  if (!toWhom) {
    showToast('Please specify to whom the money was paid', 'warning');
    return;
  }

  const whoSpent = document.querySelector('input[name="whoSpentChoice"]:checked')?.value || 'Me';

  // PARTNER BOB SPEND: Create reminder, DO NOT deduct from BOB balance yet!
  if (whoSpent === 'Partner' && account === 'BOB') {
    const pName = state.partner.name || 'Partner';
    const reminder = {
      id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      amount: amount,
      account: 'BOB',
      category: category,
      toWhom: toWhom,
      description: description,
      partnerName: pName,
      partnerUpi: state.partner.upiId || '',
      datetime: finalTimestamp
    };

    state.partnerReminders.unshift(reminder);
    saveData();

    // Reset Form
    document.getElementById('expAmount').value = '';
    document.getElementById('expToWhom').value = '';
    document.getElementById('expDescription').value = '';

    // Reset custom time to default live clock
    if (state.isCustomTimeEnabled) {
      state.isCustomTimeEnabled = false;
      document.getElementById('customDatetimeContainer').style.display = 'none';
      document.getElementById('liveTimestampNotice').style.display = 'flex';
      document.getElementById('toggleCustomTimeBtn').style.display = 'inline-block';
    }

    renderAll();
    showToast(`Partner spend recorded. Reminder added to Dashboard!`);
    switchTab('tab-dashboard');
    showPartnerSpendAlert(reminder);
    return;
  }

  const newTx = {
    id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    type: 'expense',
    amount: amount,
    account: account,
    category: category,
    toWhom: toWhom,
    description: description,
    datetime: finalTimestamp
  };

  state.transactions.unshift(newTx);
  saveData();

  // Reset Form
  document.getElementById('expAmount').value = '';
  document.getElementById('expToWhom').value = '';
  document.getElementById('expDescription').value = '';

  // Reset custom time to default live clock
  if (state.isCustomTimeEnabled) {
    state.isCustomTimeEnabled = false;
    document.getElementById('customDatetimeContainer').style.display = 'none';
    document.getElementById('liveTimestampNotice').style.display = 'flex';
    document.getElementById('toggleCustomTimeBtn').style.display = 'inline-block';
  }

  // Render & check low balance alert
  renderAll();

  const updatedBalances = calculateBalances();
  const currentAccBal = account === 'BOB' ? updatedBalances.bobTotal : updatedBalances.iciciTotal;

  if (currentAccBal < 500) {
    showToast(`Notice: ${account} balance dropped to ${formatINR(currentAccBal)} (Below ₹500)!`, 'warning');
  } else {
    showToast(`Recorded: ${formatINR(amount)} from ${account}`);
  }

  // Switch back to dashboard ledger
  switchTab('tab-dashboard');

  // If BOB expense, automatically open WhatsApp directly to notify partner!
  if (account === 'BOB' && state.partner.autoNotifyBob !== false) {
    const notifyMsg = generateBobNotifyText(newTx, currentAccBal);
    sendToWhatsApp(notifyMsg);
  }
}

function handleAddFundsSubmit(e) {
  e.preventDefault();

  const account = document.getElementById('fundAccount').value;
  const amount = parseFloat(document.getElementById('fundAmount').value);
  const note = document.getElementById('fundNote').value.trim() || 'Deposit / Inflow';

  if (!amount || amount <= 0) {
    showToast('Please enter a valid amount', 'warning');
    return;
  }

  const newTx = {
    id: 'tx_' + Date.now(),
    type: fundsMode,
    amount: amount,
    account: account,
    category: fundsMode === 'withdrawal' ? 'Withdrawal / Transfer Out' : 'Deposit / Inflow',
    toWhom: 'Self Account',
    description: note,
    datetime: new Date().toISOString()
  };

  state.transactions.unshift(newTx);
  saveData();

  closeModal('addFundsModal');
  document.getElementById('fundAmount').value = '';
  document.getElementById('fundNote').value = '';

  renderAll();
  showToast(fundsMode === 'withdrawal' ? `Removed ${formatINR(amount)} from ${account}` : `Added ${formatINR(amount)} to ${account}`);
}

// ==========================================================================
// Tabs & Modals
// ==========================================================================
function switchTab(tabId) {
  state.activeTab = tabId;

  // View visibility
  document.querySelectorAll('.tab-view').forEach((pane) => {
    pane.classList.remove('active');
  });

  const activePane = document.getElementById(tabId);
  if (activePane) activePane.classList.add('active');

  // Bottom navigation active state (Mobile)
  document.querySelectorAll('.editorial-bottom-nav .nav-btn').forEach((item) => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Desktop Sidebar active state (Desktop)
  document.querySelectorAll('.desktop-sidebar .sidebar-item').forEach((item) => {
    if (item.getAttribute('data-tab') === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'flex';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// ==========================================================================
// Toast System (Monochrome Silhouette Icons, Zero Emojis)
// ==========================================================================
function showToast(message, type = 'normal') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `editorial-toast ${type === 'warning' ? 'warning' : ''}`;

  let icon = `
    <span class="toast-silhouette-icon">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <circle cx="12" cy="12" r="5"/>
      </svg>
    </span>`;

  if (type === 'warning') {
    icon = `
      <span class="toast-silhouette-icon">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>
      </span>`;
  }

  toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// ==========================================================================
// Export & Backup
// ==========================================================================
function exportToCSV() {
  if (state.transactions.length === 0) {
    showToast('No transactions to export', 'warning');
    return;
  }

  const headers = ['ID', 'Timestamp (ISO)', 'Date', 'Time', 'Type', 'Account', 'Category', 'Description', 'To Whom', 'Amount (INR)'];
  const rows = state.transactions.map((t) => {
    const d = new Date(t.datetime);
    return [
      t.id,
      t.datetime,
      d.toLocaleDateString('en-IN'),
      d.toLocaleTimeString('en-IN'),
      t.type,
      t.account,
      `"${(t.category || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.toWhom || '').replace(/"/g, '""')}"`,
      t.amount
    ];
  });

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TrackFlow_Ledger_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV export ready');
}

function exportToJSON() {
  const exportPayload = {
    app: 'TrackFlow',
    version: '2.0',
    exportDate: new Date().toISOString(),
    initialBalances: state.initialBalances,
    transactions: state.transactions,
    partnerReminders: state.partnerReminders,
    partner: state.partner,
    notificationSettings: state.notificationSettings
  };

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TrackFlow_Backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON backup ready');
}

function importFromJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.initialBalances && Array.isArray(data.transactions)) {
        state.initialBalances = data.initialBalances;
        state.transactions = data.transactions;
        if (Array.isArray(data.partnerReminders)) state.partnerReminders = data.partnerReminders;
        if (data.partner) state.partner = data.partner;
        if (data.notificationSettings) state.notificationSettings = { ...state.notificationSettings, ...data.notificationSettings };
        saveData();
        renderAll();
        showToast('Backup restored successfully');
      } else {
        showToast('Invalid backup file format', 'warning');
      }
    } catch (err) {
      showToast('Error reading JSON file', 'warning');
    }
  };
  reader.readAsText(file);
}

// ==========================================================================
// Report Download Centre – Date Range Filtering, CSV & Print/PDF
// ==========================================================================

// State for the report filters
let reportState = {
  range: 'this_month',
  fromDate: null,
  toDate: null,
  account: 'all',
  type: 'all'
};

function setupReportListeners() {
  // Range pill clicks
  const pillContainer = document.getElementById('reportRangePills');
  if (pillContainer) {
    pillContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.range-pill');
      if (!pill) return;

      pillContainer.querySelectorAll('.range-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      reportState.range = pill.dataset.range;

      // Show/hide custom date fields
      const customRow = document.getElementById('customDateRangeRow');
      if (customRow) customRow.style.display = reportState.range === 'custom' ? '' : 'none';

      updateReportPreview();
    });
  }

  // Custom date inputs
  const fromDateEl = document.getElementById('reportFromDate');
  const toDateEl = document.getElementById('reportToDate');
  if (fromDateEl) fromDateEl.addEventListener('change', () => { reportState.fromDate = fromDateEl.value; updateReportPreview(); });
  if (toDateEl) toDateEl.addEventListener('change', () => { reportState.toDate = toDateEl.value; updateReportPreview(); });

  // Account & type filters
  const accFilter = document.getElementById('reportAccountFilter');
  const typeFilter = document.getElementById('reportTypeFilter');
  if (accFilter) accFilter.addEventListener('change', () => { reportState.account = accFilter.value; updateReportPreview(); });
  if (typeFilter) typeFilter.addEventListener('change', () => { reportState.type = typeFilter.value; updateReportPreview(); });

  // Download CSV button
  document.getElementById('downloadReportCsvBtn')?.addEventListener('click', downloadFilteredCSV);

  // Print / PDF button
  document.getElementById('downloadReportPdfBtn')?.addEventListener('click', generateAndPrintReport);

  // Set initial default date values
  const now = new Date();
  if (toDateEl) toDateEl.value = now.toISOString().slice(0, 10);
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  if (fromDateEl) fromDateEl.value = oneMonthAgo.toISOString().slice(0, 10);

  // Initial preview
  updateReportPreview();
}

/**
 * Compute the date range [start, end] based on the current reportState.range selection
 */
function getReportDateRange() {
  const now = new Date();
  let start, end;

  switch (reportState.range) {
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
      break;
    case '3_months':
      start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      end = now;
      break;
    case '6_months':
      start = new Date(now.getFullYear(), now.getMonth() - 6, 1);
      end = now;
      break;
    case 'custom':
      start = reportState.fromDate ? new Date(reportState.fromDate + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      end = reportState.toDate ? new Date(reportState.toDate + 'T23:59:59') : now;
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
  }

  return { start, end };
}

/**
 * Filter transactions by the current report settings (date range, account, type)
 */
function getFilteredReportTransactions() {
  const { start, end } = getReportDateRange();

  return state.transactions.filter(tx => {
    const txDate = new Date(tx.datetime);

    // Date range filter
    if (txDate < start || txDate > end) return false;

    // Account filter
    if (reportState.account !== 'all' && tx.account !== reportState.account) return false;

    // Type filter
    if (reportState.type !== 'all' && tx.type !== reportState.type) return false;

    return true;
  }).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
}

/**
 * Update the live preview summary box
 */
function updateReportPreview() {
  const previewEl = document.getElementById('reportPreviewText');
  if (!previewEl) return;

  const filtered = getFilteredReportTransactions();
  const { start, end } = getReportDateRange();

  if (filtered.length === 0) {
    previewEl.innerHTML = `No transactions found in the selected range (<strong>${start.toLocaleDateString('en-IN')}</strong> – <strong>${end.toLocaleDateString('en-IN')}</strong>).`;
    return;
  }

  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const bobCount = filtered.filter(t => t.account === 'BOB').length;
  const iciciCount = filtered.filter(t => t.account === 'ICICI').length;

  previewEl.innerHTML = `
    <strong>${filtered.length} transactions</strong> from 
    <strong>${start.toLocaleDateString('en-IN')}</strong> to 
    <strong>${end.toLocaleDateString('en-IN')}</strong><br>
    Expenses: <strong style="color:#B91C1C;">₹${totalExpense.toLocaleString('en-IN')}</strong> · 
    Income: <strong style="color:#15803D;">₹${totalIncome.toLocaleString('en-IN')}</strong> · 
    BOB: ${bobCount} · ICICI: ${iciciCount}
  `;
}

/**
 * Download a filtered CSV of the current report selection
 */
function downloadFilteredCSV() {
  const filtered = getFilteredReportTransactions();
  if (filtered.length === 0) {
    showToast('No transactions in this range to export.', 'warning');
    return;
  }

  const { start, end } = getReportDateRange();
  const headers = ['S.No', 'Date', 'Time', 'Type', 'Account', 'Category', 'Description', 'To/From Whom', 'Amount (₹)'];

  const rows = filtered.map((t, i) => {
    const d = new Date(t.datetime);
    return [
      i + 1,
      d.toLocaleDateString('en-IN'),
      d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      t.type === 'expense' ? 'Expense' : t.type === 'withdrawal' ? 'Withdrawal' : 'Income',
      t.account,
      `"${(t.category || '').replace(/"/g, '""')}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.toWhom || '').replace(/"/g, '""')}"`,
      t.type === 'withdrawal' || t.type === 'expense' ? `-${t.amount}` : `+${t.amount}`
    ];
  });

  // Summary row
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  rows.push([]);
  rows.push(['', '', '', '', '', '', 'Total Expenses', '', `-${totalExpense}`]);
  rows.push(['', '', '', '', '', '', 'Total Income', '', `+${totalIncome}`]);
  rows.push(['', '', '', '', '', '', 'Net Flow', '', totalIncome - totalExpense]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const rangeLabel = reportState.range.replace(/_/g, '-');
  a.download = `TrackFlow_Report_${rangeLabel}_${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`CSV report downloaded — ${filtered.length} transactions`);
}

/**
 * Generate a rich printable HTML report and open the browser's Print dialog (Save as PDF)
 */
function generateAndPrintReport() {
  const filtered = getFilteredReportTransactions();
  if (filtered.length === 0) {
    showToast('No transactions in this range to generate a report.', 'warning');
    return;
  }

  const { start, end } = getReportDateRange();
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const netFlow = totalIncome - totalExpense;
  const bobExpense = filtered.filter(t => t.account === 'BOB' && t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const iciciExpense = filtered.filter(t => t.account === 'ICICI' && t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  // Category breakdown
  const categoryMap = {};
  filtered.filter(t => t.type === 'expense').forEach(t => {
    const cat = t.category || 'Uncategorized';
    categoryMap[cat] = (categoryMap[cat] || 0) + Number(t.amount);
  });
  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
  const maxCatAmount = sortedCategories.length > 0 ? sortedCategories[0][1] : 1;

  // Build category bars HTML
  let categoryBarsHtml = '';
  sortedCategories.forEach(([cat, amt]) => {
    const pct = Math.round((amt / maxCatAmount) * 100);
    categoryBarsHtml += `
      <div class="category-bar-row">
        <span class="category-bar-label">${escapeHtml(cat)}</span>
        <div class="category-bar-track"><div class="category-bar-fill" style="width: ${pct}%"></div></div>
        <span class="category-bar-amount">₹${amt.toLocaleString('en-IN')}</span>
      </div>`;
  });

  // Build transactions table
  let tableRows = '';
  filtered.forEach((t, i) => {
    const d = new Date(t.datetime);
    const typeClass = t.type === 'expense' || t.type === 'withdrawal' ? 'expense' : 'income';
    const sign = t.type === 'expense' || t.type === 'withdrawal' ? '−' : '+';
    tableRows += `
      <tr>
        <td>${i + 1}</td>
        <td>${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
        <td>${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${t.type === 'expense' ? 'Expense' : t.type === 'withdrawal' ? 'Withdrawal' : 'Income'}</td>
        <td>${t.account}</td>
        <td>${escapeHtml(t.category || '—')}</td>
        <td>${escapeHtml(t.description || '—')}</td>
        <td>${escapeHtml(t.toWhom || '—')}</td>
        <td class="amount-cell ${typeClass}">${sign}₹${Number(t.amount).toLocaleString('en-IN')}</td>
      </tr>`;
  });

  const rangeLabel = reportState.range === 'custom' ? 'Custom Range'
    : reportState.range === 'this_month' ? 'This Month'
    : reportState.range === 'last_month' ? 'Last Month'
    : reportState.range === '3_months' ? 'Last 3 Months'
    : 'Last 6 Months';

  const userName = (typeof CloudSync !== 'undefined' && CloudSync.isLoggedIn()) ? CloudSync.getUserName() : 'User';

  const reportHtml = `
    <div class="print-report">
      <div class="print-report-header">
        <div class="print-report-brand">
          <h1>TrackFlow Expense Report</h1>
          <p>${rangeLabel} · ${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div class="print-report-meta">
          <strong>${userName}</strong>
          Generated: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <div class="print-summary-grid">
        <div class="print-summary-card">
          <div class="label">Total Transactions</div>
          <div class="value">${filtered.length}</div>
        </div>
        <div class="print-summary-card">
          <div class="label">Total Expenses</div>
          <div class="value expense">₹${totalExpense.toLocaleString('en-IN')}</div>
        </div>
        <div class="print-summary-card">
          <div class="label">Total Income</div>
          <div class="value income">₹${totalIncome.toLocaleString('en-IN')}</div>
        </div>
        <div class="print-summary-card">
          <div class="label">Net Flow</div>
          <div class="value ${netFlow >= 0 ? 'income' : 'expense'}">${netFlow >= 0 ? '+' : '−'}₹${Math.abs(netFlow).toLocaleString('en-IN')}</div>
        </div>
        <div class="print-summary-card">
          <div class="label">BOB Spend</div>
          <div class="value expense">₹${bobExpense.toLocaleString('en-IN')}</div>
        </div>
        <div class="print-summary-card">
          <div class="label">ICICI Spend</div>
          <div class="value expense">₹${iciciExpense.toLocaleString('en-IN')}</div>
        </div>
      </div>

      ${sortedCategories.length > 0 ? `
      <div class="print-category-section">
        <h3>Expense Breakdown by Category</h3>
        ${categoryBarsHtml}
      </div>` : ''}

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Date</th>
            <th>Time</th>
            <th>Type</th>
            <th>Account</th>
            <th>Category</th>
            <th>Description</th>
            <th>To/From</th>
            <th style="text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>

      <div class="print-report-footer">
        TrackFlow Expense Ledger · Report generated on ${new Date().toLocaleDateString('en-IN')} · Data exported from ${window.location.hostname || 'local'}<br>
        This is an auto-generated statement. Please verify all entries before submission.
      </div>
    </div>
  `;

  // Inject into container and trigger print
  const container = document.getElementById('printReportContainer');
  if (container) {
    container.innerHTML = reportHtml;
    container.style.display = 'block';

    // Small delay so DOM renders before print dialog
    setTimeout(() => {
      window.print();
      // After print dialog closes, hide the container
      setTimeout(() => {
        container.style.display = 'none';
      }, 500);
    }, 200);
  }
}

// ==========================================================================
// Service Worker & PWA Handling
// ==========================================================================
function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('TrackFlow ServiceWorker registered:', reg.scope);
        })
        .catch((err) => {
          console.warn('TrackFlow ServiceWorker registration failed:', err);
        });
    });
  }

  // Handle Install Prompt
  const installBtn = document.getElementById('installAppBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    installBtn.style.display = 'inline-block';
  });

  installBtn.addEventListener('click', async () => {
    if (state.deferredInstallPrompt) {
      state.deferredInstallPrompt.prompt();
      const choiceResult = await state.deferredInstallPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        showToast('TrackFlow installed');
      }
      state.deferredInstallPrompt = null;
      installBtn.style.display = 'none';
    } else {
      openModal('mobileGuideModal');
    }
  });

  // Track online/offline status
  window.addEventListener('offline', () => {
    const statusPill = document.getElementById('offlineStatus');
    statusPill.innerHTML = '<span class="status-pip" style="background:#B91C1C"></span> Offline';
  });

  window.addEventListener('online', () => {
    const statusPill = document.getElementById('offlineStatus');
    statusPill.innerHTML = '<span class="status-pip"></span> Offline Ready';
  });
}

function handleUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const tab = params.get('tab');
  const mode = params.get('mode');
  const view = params.get('view');

  if (action === 'partner_spend') {
    const amount = parseFloat(params.get('amount') || '0');
    const desc = params.get('desc') || params.get('for') || '';
    const to = params.get('to') || params.get('whom') || '';
    const cat = params.get('cat') || 'Groceries';
    const partner = params.get('partner') || state.partner.name || 'Partner';

    if (amount > 0 && desc) {
      const newReminder = {
        id: 'rem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        amount: amount,
        account: 'BOB',
        category: cat,
        toWhom: to || partner,
        description: desc,
        partnerName: partner,
        partnerUpi: state.partner.upiId || '',
        datetime: new Date().toISOString()
      };

      state.partnerReminders.unshift(newReminder);
      saveData();
      renderAll();
      showPartnerSpendAlert(newReminder);
      showToast(`New BOB spend from ${partner}: ${formatINR(amount)} for ${desc}`);

      // Clean URL so refresh does not duplicate
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      // Open portal to fill in details
      openModal('partnerSpendPortalModal');
    }
  } else if (action === 'add') {
    switchTab('tab-add');
  } else if (tab === 'analytics') {
    switchTab('tab-analytics');
  } else if (mode === 'widget') {
    openModal('widgetOverlay');
  } else if (view === 'bob') {
    openBobPartnerStatementModal();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
