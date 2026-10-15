// Netlify Serverless Function for TrackFlow Cloud Backend
// Provides Authentication, Role-based Account Separation, and Cross-Device Sync

const crypto = require('crypto');
const PRIMARY_PHONE = normalizePhone(process.env.TRACKFLOW_PRIMARY_PHONE);
const PARTNER_PHONE = normalizePhone(process.env.TRACKFLOW_PARTNER_PHONE);
const RAW_PARTNER_WHATSAPP_PHONE = String(process.env.TRACKFLOW_PARTNER_WHATSAPP_PHONE || process.env.TRACKFLOW_PARTNER_PHONE || '').replace(/[^0-9]/g, '');
const PARTNER_WHATSAPP_PHONE = process.env.TRACKFLOW_PARTNER_WHATSAPP_PHONE ? RAW_PARTNER_WHATSAPP_PHONE : (RAW_PARTNER_WHATSAPP_PHONE.length === 10 ? `91${RAW_PARTNER_WHATSAPP_PHONE}` : RAW_PARTNER_WHATSAPP_PHONE);
const PARTNER_NAME = (process.env.TRACKFLOW_PARTNER_NAME || 'Partner').trim();
const PARTNER_UPI_ID = (process.env.TRACKFLOW_PARTNER_UPI_ID || '').trim();
const AUTO_NOTIFY_BOB = !['false', '0', 'no', 'off'].includes((process.env.TRACKFLOW_AUTO_NOTIFY_BOB || 'true').trim().toLowerCase());
const SHARED_PASSWORD = (process.env.TRACKFLOW_PASSWORD || '').trim();
const TOKEN_SECRET = process.env.TRACKFLOW_TOKEN_SECRET || process.env.TRACKFLOW_PASSWORD || '';
const ALLOWED_ORIGIN = process.env.TRACKFLOW_ALLOWED_ORIGIN || '';
const AUTHORIZED_NUMBERS = Object.fromEntries([
  [PRIMARY_PHONE, { role: 'primary', name: 'Primary', partnerPhone: PARTNER_PHONE, defaultAccounts: ['BOB', 'ICICI'] }],
  [PARTNER_PHONE, { role: 'partner', name: 'Partner', partnerPhone: PRIMARY_PHONE, defaultAccounts: ['BOB', 'Personal'] }]
].filter(([phone]) => phone));

// In-memory cache fallback for serverless container runtime
let memoryDb = {
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
    [PRIMARY_PHONE]: { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] },
    [PARTNER_PHONE]: { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] }
  },
  deletedTransactions: { bob: [], private: {} },
  partnerProfile: {
    primaryName: 'Primary',
    partnerName: 'Partner',
    partnerPhone: PARTNER_PHONE,
    partnerUpi: '',
    autoNotifyBob: true
  },
  lastUpdated: Date.now()
};

async function getStoreData(event) {
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    connectLambda(event);
    const store = getStore('trackflow_ledger');
    const blob = await store.get('db_state', { type: 'json' });
    if (blob) {
      memoryDb = { ...memoryDb, ...blob };
    }
  } catch (err) {
    // Local tests can use memory. In deployed Netlify, never pretend volatile memory is durable storage.
    if (process.env.NETLIFY === 'true') throw err;
  }
  return memoryDb;
}

async function setStoreData(data, event) {
  data.lastUpdated = Date.now();
  memoryDb = data;
  try {
    const { connectLambda, getStore } = require('@netlify/blobs');
    connectLambda(event);
    const store = getStore('trackflow_ledger');
    await store.setJSON('db_state', data);
  } catch (err) {
    // Local tests can use memory. In deployed Netlify, report failed persistence instead of false success.
    if (process.env.NETLIFY === 'true') throw err;
  }
}

function getStaticPartnerProfile() {
  return {
    name: PARTNER_NAME,
    phone: PARTNER_WHATSAPP_PHONE,
    upiId: PARTNER_UPI_ID,
    autoNotifyBob: AUTO_NOTIFY_BOB
  };
}

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}
function signToken(payload) {
  if (!TOKEN_SECRET) throw new Error('TRACKFLOW_TOKEN_SECRET or TRACKFLOW_PASSWORD must be configured.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}
function readToken(event) {
  const match = /^Bearer (.+)$/.exec(event.headers?.authorization || event.headers?.Authorization || '');
  if (!match || !TOKEN_SECRET) return null;
  const [encoded, signature] = match[1].split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.phone || !AUTHORIZED_NUMBERS[payload.phone] || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch { return null; }
}
function jsonResponse(statusCode, data) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

const CORS_HEADERS = {
  ...(ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Vary': 'Origin' } : {}),
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
    const db = await getStoreData(event);

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
            error: 'This account is not authorized.'
          })
        };
      }

      if (!SHARED_PASSWORD || !TOKEN_SECRET) {
        return jsonResponse(503, { success: false, error: 'Authentication is not configured on the server.' });
      }
      if (typeof password !== 'string' || password !== SHARED_PASSWORD) {
        return {
          statusCode: 401,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            success: false,
            error: 'Incorrect password. Please verify and try again.'
          })
        };
      }

      const userAccounts = cleanPhone === PRIMARY_PHONE
        ? ['BOB', 'ICICI']
        : ['BOB', ...(db.privateAccounts[cleanPhone]?.accounts || ['Personal'])];

      return jsonResponse(200, {
        success: true,
        user: { phone: cleanPhone, role: authConfig.role, name: authConfig.name, partnerPhone: authConfig.partnerPhone, accounts: userAccounts },
        token: signToken({ phone: cleanPhone, role: authConfig.role, iat: Date.now(), exp: Date.now() + 12 * 60 * 60 * 1000 })
      });
    }

    // 3. Sync Pull
    if (path === '/sync/pull' && event.httpMethod === 'GET') {
      const session = readToken(event);
      if (!session) return jsonResponse(401, { success: false, error: 'Authentication required.' });
      const phone = session.phone;
      if (!AUTHORIZED_NUMBERS[phone]) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized user phone' })
        };
      }

      db.deletedTransactions = db.deletedTransactions || { bob: [], private: {} };
      const deletedBob = new Set(db.deletedTransactions.bob || []);
      const bobData = {
        initial: db.bobAccount.initialBalance ?? 5000,
        transactions: (db.bobAccount.transactions || []).filter(t => !deletedBob.has(t.id)),
        deletedIds: Array.from(deletedBob),
        reminders: db.bobAccount.reminders || []
      };

      let privateData = { accounts: [], initialBalances: {}, transactions: [] };
      if (phone === PRIMARY_PHONE) {
        const pStore = db.privateAccounts[PRIMARY_PHONE] || { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] };
        privateData = {
          accounts: pStore.accounts || ['ICICI'],
          initialBalances: pStore.initialBalances || { ICICI: 10000 },
          transactions: (pStore.transactions || []).filter(t => !(db.deletedTransactions.private[phone] || []).includes(t.id)),
          deletedIds: db.deletedTransactions.private[phone] || []
        };
      } else if (phone === PARTNER_PHONE) {
        const pStore = db.privateAccounts[PARTNER_PHONE] || { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] };
        privateData = {
          accounts: pStore.accounts || ['Personal'],
          initialBalances: pStore.initialBalances || { Personal: 5000 },
          transactions: (pStore.transactions || []).filter(t => !(db.deletedTransactions.private[phone] || []).includes(t.id)),
          deletedIds: db.deletedTransactions.private[phone] || []
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
          partnerProfile: getStaticPartnerProfile()
        })
      };
    }

    // 4. Sync Push
    if (path === '/sync/push' && event.httpMethod === 'POST') {
      const session = readToken(event);
      if (!session) return jsonResponse(401, { success: false, error: 'Authentication required.' });
      const payload = JSON.parse(event.body || '{}');
      const phone = session.phone;
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
        if (Array.isArray(payload.bob.deletedIds)) {
          db.deletedTransactions.bob = Array.from(new Set([...(db.deletedTransactions.bob || []), ...payload.bob.deletedIds.filter(id => typeof id === 'string')]));
        }
        if (Array.isArray(payload.bob.transactions)) {
          const deleted = new Set(db.deletedTransactions.bob || []);
          const existingMap = new Map((db.bobAccount.transactions || []).filter(t => !deleted.has(t.id)).map(t => [t.id, t]));
          payload.bob.transactions.forEach(t => {
            if (t.account === 'BOB' && !deleted.has(t.id)) existingMap.set(t.id, t);
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
        db.deletedTransactions = db.deletedTransactions || { bob: [], private: {} };
        db.deletedTransactions.private = db.deletedTransactions.private || {};
        if (Array.isArray(payload.private.deletedIds)) {
          db.deletedTransactions.private[phone] = Array.from(new Set([...(db.deletedTransactions.private[phone] || []), ...payload.private.deletedIds.filter(id => typeof id === 'string')]));
        }
        if (Array.isArray(payload.private.accounts)) userPrivate.accounts = payload.private.accounts;
        if (payload.private.initialBalances) userPrivate.initialBalances = { ...userPrivate.initialBalances, ...payload.private.initialBalances };
        if (Array.isArray(payload.private.transactions)) {
          const deleted = new Set(db.deletedTransactions.private[phone] || []);
          const privMap = new Map((userPrivate.transactions || []).filter(t => !deleted.has(t.id)).map(t => [t.id, t]));
          payload.private.transactions.forEach(t => {
            if (t.account !== 'BOB' && !deleted.has(t.id)) privMap.set(t.id, t);
          });
          userPrivate.transactions = Array.from(privMap.values()).sort(
            (a, b) => new Date(b.datetime) - new Date(a.datetime)
          );
        }
      }

// Partner contact settings are server-controlled by Netlify environment variables.
      await setStoreData(db, event);

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
      const session = readToken(event);
      if (!session) return jsonResponse(401, { success: false, error: 'Authentication required.' });
      const { accountName, initialBalance } = JSON.parse(event.body || '{}');
      const cleanPhone = session.phone;
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        return {
          statusCode: 403,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: false, error: 'Unauthorized user phone' })
        };
      }

      const accName = (accountName || '').trim();
      if (!accName || accName.toUpperCase() === 'BOB' || (accName.toUpperCase() === 'ICICI' && cleanPhone !== PRIMARY_PHONE)) {
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

      await setStoreData(db, event);

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
