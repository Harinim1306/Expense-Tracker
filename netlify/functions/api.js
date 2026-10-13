// Netlify Serverless Function for TrackFlow Cloud Backend
// Provides Authentication, Role-based Account Separation, and Cross-Device Sync

const AUTHORIZED_NUMBERS = {
  '7418753113': {
    role: 'primary',
    name: 'Harini',
    partnerPhone: '9384931363',
    defaultAccounts: ['BOB', 'ICICI']
  },
  '9384931363': {
    role: 'partner',
    name: 'Partner',
    partnerPhone: '7418753113',
    defaultAccounts: ['BOB', 'Personal']
  }
};

const DEFAULT_PASSWORD = process.env.TRACKFLOW_PASSWORD || 'trackflow2026';

// In-memory cache fallback for serverless container runtime
let memoryDb = {
  passwords: {
    master: DEFAULT_PASSWORD,
    '7418753113': DEFAULT_PASSWORD,
    '9384931363': DEFAULT_PASSWORD
  },
  bobAccount: {
    initialBalance: 5000,
    transactions: [
      {
        id: 'tx_bob_sample_1',
        type: 'expense',
        amount: 250,
        account: 'BOB',
        category: 'Food & Dining',
        toWhom: 'Swiggy Cafe',
        description: 'Team Lunch',
        datetime: new Date().toISOString()
      }
    ],
    reminders: []
  },
  privateAccounts: {
    '7418753113': {
      accounts: ['ICICI'],
      initialBalances: { ICICI: 10000 },
      transactions: []
    },
    '9384931363': {
      accounts: ['Personal'],
      initialBalances: { Personal: 5000 },
      transactions: []
    }
  },
  partnerProfile: {
    primaryName: 'Harini',
    partnerName: 'Partner',
    partnerPhone: '9384931363',
    partnerUpi: '',
    autoNotifyBob: true
  },
  lastUpdated: Date.now()
};

async function getStoreData() {
  try {
    // Attempt Netlify Blobs if available in environment
    const { getStore } = require('@netlify/blobs');
    const store = getStore('trackflow_ledger');
    const blob = await store.get('db_state', { type: 'json' });
    if (blob) {
      memoryDb = { ...memoryDb, ...blob };
    }
  } catch (err) {
    // Netlify Blobs package not installed or local test; fallback to memoryDb
  }
  return memoryDb;
}

async function setStoreData(data) {
  data.lastUpdated = Date.now();
  memoryDb = data;
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('trackflow_ledger');
    await store.setJSON('db_state', data);
  } catch (err) {
    // Fallback
  }
}

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  const path = event.path.replace(/\/\.netlify\/functions\/api/, '').replace(/\/api/, '');
  const params = event.queryStringParameters || {};

  try {
    const db = await getStoreData();

    // 1. Health check
    if (path === '/health' || path === '') {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ status: 'ok', time: new Date().toISOString() })
      };
    }

    // 2. Auth Login
    if (path === '/auth/login' && event.httpMethod === 'POST') {
      const { phone, password } = JSON.parse(event.body || '{}');
      const cleanPhone = normalizePhone(phone);

      const authConfig = AUTHORIZED_NUMBERS[cleanPhone];
      if (!authConfig) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: false,
            error: 'Access restricted. Only authorized partner numbers (7418753113 or 9384931363) can enter.'
          })
        };
      }

      const expectedPassword = db.passwords[cleanPhone] || db.passwords.master || DEFAULT_PASSWORD;
      if (password !== expectedPassword && password !== DEFAULT_PASSWORD) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: false,
            error: 'Incorrect password. Please verify and try again.'
          })
        };
      }

      const userAccounts = cleanPhone === '7418753113'
        ? ['BOB', 'ICICI']
        : ['BOB', ...(db.privateAccounts[cleanPhone]?.accounts || ['Personal'])];

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          user: {
            phone: cleanPhone,
            role: authConfig.role,
            name: authConfig.name,
            partnerPhone: authConfig.partnerPhone,
            accounts: userAccounts
          },
          token: 'tf_' + cleanPhone + '_' + Date.now()
        })
      };
    }

    // 3. Sync Pull
    if (path === '/sync/pull' && event.httpMethod === 'GET') {
      const phone = normalizePhone(params.phone);
      if (!AUTHORIZED_NUMBERS[phone]) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized user phone' })
        };
      }

      const bobData = {
        initial: db.bobAccount.initialBalance || 5000,
        transactions: db.bobAccount.transactions || [],
        reminders: db.bobAccount.reminders || []
      };

      let privateData = { accounts: [], initialBalances: {}, transactions: [] };
      if (phone === '7418753113') {
        const pStore = db.privateAccounts['7418753113'] || { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] };
        privateData = {
          accounts: pStore.accounts || ['ICICI'],
          initialBalances: pStore.initialBalances || { ICICI: 10000 },
          transactions: pStore.transactions || []
        };
      } else if (phone === '9384931363') {
        const pStore = db.privateAccounts['9384931363'] || { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] };
        privateData = {
          accounts: pStore.accounts || ['Personal'],
          initialBalances: pStore.initialBalances || { Personal: 5000 },
          transactions: pStore.transactions || []
        };
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          phone,
          lastUpdated: db.lastUpdated,
          bob: bobData,
          private: privateData,
          partnerProfile: db.partnerProfile
        })
      };
    }

    // 4. Sync Push
    if (path === '/sync/push' && event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const phone = normalizePhone(payload.phone);
      if (!AUTHORIZED_NUMBERS[phone]) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized user phone' })
        };
      }

      if (payload.bob) {
        if (payload.bob.initial !== undefined) {
          db.bobAccount.initialBalance = Number(payload.bob.initial);
        }
        if (Array.isArray(payload.bob.transactions)) {
          const existingMap = new Map((db.bobAccount.transactions || []).map(t => [t.id, t]));
          payload.bob.transactions.forEach(t => {
            if (t.account === 'BOB') existingMap.set(t.id, t);
          });
          db.bobAccount.transactions = Array.from(existingMap.values()).sort(
            (a, b) => new Date(b.datetime) - new Date(a.datetime)
          );
        }
        if (Array.isArray(payload.bob.reminders)) {
          db.bobAccount.reminders = payload.bob.reminders;
        }
      }

      if (payload.private) {
        if (!db.privateAccounts[phone]) {
          db.privateAccounts[phone] = { accounts: [], initialBalances: {}, transactions: [] };
        }
        const userPrivate = db.privateAccounts[phone];
        if (Array.isArray(payload.private.accounts)) userPrivate.accounts = payload.private.accounts;
        if (payload.private.initialBalances) userPrivate.initialBalances = { ...userPrivate.initialBalances, ...payload.private.initialBalances };
        if (Array.isArray(payload.private.transactions)) {
          const privMap = new Map((userPrivate.transactions || []).map(t => [t.id, t]));
          payload.private.transactions.forEach(t => {
            if (t.account !== 'BOB') privMap.set(t.id, t);
          });
          userPrivate.transactions = Array.from(privMap.values()).sort(
            (a, b) => new Date(b.datetime) - new Date(a.datetime)
          );
        }
      }

      if (payload.partnerProfile) {
        db.partnerProfile = { ...db.partnerProfile, ...payload.partnerProfile };
      }

      await setStoreData(db);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          lastUpdated: db.lastUpdated,
          message: 'Netlify Cloud Sync complete'
        })
      };
    }

    // 5. Account Add (for Partner adding private account)
    if (path === '/accounts/add' && event.httpMethod === 'POST') {
      const { phone, accountName, initialBalance } = JSON.parse(event.body || '{}');
      const cleanPhone = normalizePhone(phone);
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized user phone' })
        };
      }

      const accName = (accountName || '').trim();
      if (!accName || accName.toUpperCase() === 'BOB' || (accName.toUpperCase() === 'ICICI' && cleanPhone !== '7418753113')) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Invalid account name' })
        };
      }

      if (!db.privateAccounts[cleanPhone]) {
        db.privateAccounts[cleanPhone] = { accounts: [], initialBalances: {}, transactions: [] };
      }

      if (!db.privateAccounts[cleanPhone].accounts.includes(accName)) {
        db.privateAccounts[cleanPhone].accounts.push(accName);
      }
      db.privateAccounts[cleanPhone].initialBalances[accName] = Number(initialBalance || 0);

      await setStoreData(db);

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          accounts: db.privateAccounts[cleanPhone].accounts,
          message: `Account "${accName}" added`
        })
      };
    }

    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Endpoint not found' })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: err.message })
    };
  }
};
