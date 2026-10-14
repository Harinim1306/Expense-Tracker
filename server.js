const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// User identities and passwords are deployment configuration, not source-code constants.
const PRIMARY_PHONE = normalizePhone(process.env.TRACKFLOW_PRIMARY_PHONE);
const PARTNER_PHONE = normalizePhone(process.env.TRACKFLOW_PARTNER_PHONE);
const PRIMARY_PASSWORD = process.env.TRACKFLOW_PRIMARY_PASSWORD || '';
const PARTNER_PASSWORD = process.env.TRACKFLOW_PARTNER_PASSWORD || '';
const AUTHORIZED_NUMBERS = Object.fromEntries([
  [PRIMARY_PHONE, { role: 'primary', name: process.env.TRACKFLOW_PRIMARY_NAME || 'Primary', partnerPhone: PARTNER_PHONE, defaultAccounts: ['BOB', 'ICICI'] }],
  [PARTNER_PHONE, { role: 'partner', name: process.env.TRACKFLOW_PARTNER_NAME || 'Partner', partnerPhone: PRIMARY_PHONE, defaultAccounts: ['BOB', 'Personal'] }]
].filter(([phone]) => phone));

// Initialize Database structure
function getDefaultDb() {
  return {
    passwordHashes: {},
    // Shared BOB Account (Common to both users)
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
      reminders: [] // Active reminders: "You should send ₹X for Purpose to partner"
    },
    // Private Accounts strictly segregated by phone number
    privateAccounts: {
      [PRIMARY_PHONE]: { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] },
      [PARTNER_PHONE]: { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] }
    },
    partnerProfile: {
      primaryName: process.env.TRACKFLOW_PRIMARY_NAME || 'Primary',
      partnerName: process.env.TRACKFLOW_PARTNER_NAME || 'Partner',
      partnerPhone: PARTNER_PHONE,
      partnerUpi: '',
      autoNotifyBob: true
    },
    lastUpdated: Date.now()
  };
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(content);
      // Ensure structure integrity
      if (!data.bobAccount) data.bobAccount = getDefaultDb().bobAccount;
      if (!data.privateAccounts) data.privateAccounts = getDefaultDb().privateAccounts;
      if (!data.passwordHashes) data.passwordHashes = {};
      if (!data.partnerProfile) data.partnerProfile = getDefaultDb().partnerProfile;
      return data;
    }
  } catch (err) {
    console.error('Error reading db.json, using default:', err);
  }
  const defaultDb = getDefaultDb();
  saveDb(defaultDb);
  return defaultDb;
}

function saveDb(data) {
  try {
    data.lastUpdated = Date.now();
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('Failed to write db.json:', err);
  }
}

// Ensure db exists on startup
loadDb();

// MIME Types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper: send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...(process.env.TRACKFLOW_ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': process.env.TRACKFLOW_ALLOWED_ORIGIN, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Helper: parse request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        // Limit to 5MB
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Normalize 10-digit phone number
function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9]/g, '').slice(-10);
}

const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_ORIGIN = process.env.TRACKFLOW_ALLOWED_ORIGIN || '';
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}
function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function authenticate(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(match[1]);
    return null;
  }
  return session;
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const corsOrigin = ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '';
  // CORS preflight. Set TRACKFLOW_ALLOWED_ORIGIN to the exact deployed app origin.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  const [reqPath, queryString] = req.url.split('?');
  const params = new URLSearchParams(queryString || '');

  // =========================================================================
  // API ROUTING
  // =========================================================================

  // Health Check
  if (reqPath === '/api/health') {
    sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
    return;
  }

  // Auth: Login
  if (reqPath === '/api/auth/login' && req.method === 'POST') {
    try {
      const { phone, password } = await parseBody(req);
      const cleanPhone = normalizePhone(phone);

      // Check authorized numbers
      const authConfig = AUTHORIZED_NUMBERS[cleanPhone];
      if (!authConfig) {
        sendJson(res, 401, {
          success: false,
          error: 'Access restricted. This account is not authorized.'
        });
        return;
      }

      // Check password
      const db = loadDb();
      const configuredPassword = cleanPhone === PRIMARY_PHONE ? PRIMARY_PASSWORD : PARTNER_PASSWORD;
      if (!configuredPassword) {
        sendJson(res, 503, { success: false, error: 'Authentication is not configured on the server.' });
        return;
      }
      const passwordValid = db.passwordHashes[cleanPhone]
        ? verifyPassword(password, db.passwordHashes[cleanPhone])
        : safeEqualString(password, configuredPassword);
      if (!passwordValid) {
        sendJson(res, 401, {
          success: false,
          error: 'Incorrect password. Please verify and try again.'
        });
        return;
      }

      // Generate session token
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { phone: cleanPhone, role: authConfig.role, expiresAt: Date.now() + SESSION_TTL_MS });

      // Return user profile and allowed accounts
      const userAccounts = cleanPhone === PRIMARY_PHONE
        ? ['BOB', 'ICICI']
        : ['BOB', ...(db.privateAccounts[cleanPhone]?.accounts || ['Personal'])];

      sendJson(res, 200, {
        success: true,
        user: {
          phone: cleanPhone,
          role: authConfig.role,
          name: authConfig.name,
          partnerPhone: authConfig.partnerPhone,
          accounts: userAccounts
        },
        token
      });
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
      return;
    }
  }

  // Auth: Revoke the current server-side session on logout.
  if (reqPath === '/api/auth/logout' && req.method === 'POST') {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (match) sessions.delete(match[1]);
    sendJson(res, 200, { success: true });
    return;
  }

  // Auth: Change Password
  if (reqPath === '/api/auth/change-password' && req.method === 'POST') {
    try {
      const session = authenticate(req);
      if (!session) { sendJson(res, 401, { success: false, error: 'Authentication required.' }); return; }
      const { currentPassword, newPassword } = await parseBody(req);
      const cleanPhone = session.phone;
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        sendJson(res, 403, { success: false, error: 'Unauthorized user' });
        return;
      }

      if (typeof newPassword !== 'string' || newPassword.length < 12) {
        sendJson(res, 400, { success: false, error: 'Password must be at least 12 characters long.' });
        return;
      }

      const db = loadDb();
      const configuredPassword = cleanPhone === PRIMARY_PHONE ? PRIMARY_PASSWORD : PARTNER_PASSWORD;
      const currentValid = db.passwordHashes[cleanPhone]
        ? verifyPassword(currentPassword, db.passwordHashes[cleanPhone])
        : !!configuredPassword && safeEqualString(currentPassword, configuredPassword);
      if (!currentValid) {
        sendJson(res, 401, { success: false, error: 'Current password is incorrect' });
        return;
      }

      db.passwordHashes[cleanPhone] = hashPassword(newPassword);
      sessions.delete((req.headers.authorization || '').replace(/^Bearer /, ''));
      saveDb(db);

      sendJson(res, 200, { success: true, message: 'Password updated successfully' });
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
      return;
    }
  }

  // Sync: Pull latest cloud data for a specific user
  if (reqPath === '/api/sync/pull' && req.method === 'GET') {
    const session = authenticate(req);
    if (!session) { sendJson(res, 401, { success: false, error: 'Authentication required.' }); return; }
    const phone = session.phone;
    if (!AUTHORIZED_NUMBERS[phone]) {
      sendJson(res, 403, { success: false, error: 'Unauthorized user phone' });
      return;
    }

    const db = loadDb();

    // 1. Shared BOB Data (both users get this)
    const bobData = {
      initial: db.bobAccount.initialBalance || 5000,
      transactions: db.bobAccount.transactions || [],
      reminders: db.bobAccount.reminders || []
    };

    // 2. Private Account Data (Strictly isolated by phone!)
    let privateData = {
      accounts: [],
      initialBalances: {},
      transactions: []
    };

    if (phone === PRIMARY_PHONE) {
      // Primary User gets ICICI
      const pStore = db.privateAccounts[PRIMARY_PHONE] || { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] };
      privateData = {
        accounts: pStore.accounts || ['ICICI'],
        initialBalances: pStore.initialBalances || { ICICI: 10000 },
        transactions: pStore.transactions || []
      };
    } else if (phone === PARTNER_PHONE) {
      // Partner gets Partner's private account(s), NEVER ICICI!
      const pStore = db.privateAccounts[PARTNER_PHONE] || { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] };
      privateData = {
        accounts: pStore.accounts || ['Personal'],
        initialBalances: pStore.initialBalances || { Personal: 5000 },
        transactions: pStore.transactions || []
      };
    }

    sendJson(res, 200, {
      success: true,
      phone,
      lastUpdated: db.lastUpdated,
      bob: bobData,
      private: privateData,
      partnerProfile: db.partnerProfile
    });
    return;
  }

  // Sync: Push updates from client to cloud
  if (reqPath === '/api/sync/push' && req.method === 'POST') {
    try {
      const session = authenticate(req);
      if (!session) { sendJson(res, 401, { success: false, error: 'Authentication required.' }); return; }
      const payload = await parseBody(req);
      const phone = session.phone;
      if (!AUTHORIZED_NUMBERS[phone]) {
        sendJson(res, 403, { success: false, error: 'Unauthorized user phone' });
        return;
      }

      const db = loadDb();

      // 1. Update shared BOB Account (if provided)
      if (payload.bob) {
        if (payload.bob.initial !== undefined) {
          db.bobAccount.initialBalance = Number(payload.bob.initial);
        }
        if (Array.isArray(payload.bob.transactions)) {
          // Merge transactions by unique ID
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

      // 2. Update Private Account data for THIS user only
      if (payload.private) {
        if (!db.privateAccounts[phone]) {
          db.privateAccounts[phone] = { accounts: [], initialBalances: {}, transactions: [] };
        }
        const userPrivate = db.privateAccounts[phone];

        if (Array.isArray(payload.private.accounts)) {
          userPrivate.accounts = payload.private.accounts;
        }
        if (payload.private.initialBalances) {
          userPrivate.initialBalances = { ...userPrivate.initialBalances, ...payload.private.initialBalances };
        }
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

      // 3. Partner Profile updates
      if (payload.partnerProfile) {
        db.partnerProfile = { ...db.partnerProfile, ...payload.partnerProfile };
      }

      saveDb(db);

      sendJson(res, 200, {
        success: true,
        lastUpdated: db.lastUpdated,
        message: 'Cloud sync complete'
      });
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
      return;
    }
  }

  // Account Add: Partner or User adding a new private account
  if (reqPath === '/api/accounts/add' && req.method === 'POST') {
    try {
      const session = authenticate(req);
      if (!session) { sendJson(res, 401, { success: false, error: 'Authentication required.' }); return; }
      const { accountName, initialBalance } = await parseBody(req);
      const cleanPhone = session.phone;
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        sendJson(res, 403, { success: false, error: 'Unauthorized user phone' });
        return;
      }

      const accName = (accountName || '').trim();
      if (!accName || accName.toUpperCase() === 'BOB' || accName.toUpperCase() === 'ICICI' && cleanPhone !== PRIMARY_PHONE) {
        sendJson(res, 400, { success: false, error: 'Invalid account name' });
        return;
      }

      const db = loadDb();
      if (!db.privateAccounts[cleanPhone]) {
        db.privateAccounts[cleanPhone] = { accounts: [], initialBalances: {}, transactions: [] };
      }

      if (!db.privateAccounts[cleanPhone].accounts.includes(accName)) {
        db.privateAccounts[cleanPhone].accounts.push(accName);
      }
      db.privateAccounts[cleanPhone].initialBalances[accName] = Number(initialBalance || 0);

      saveDb(db);

      sendJson(res, 200, {
        success: true,
        accounts: db.privateAccounts[cleanPhone].accounts,
        message: `Account "${accName}" added to private ledger`
      });
      return;
    } catch (err) {
      sendJson(res, 400, { success: false, error: err.message });
      return;
    }
  }

  // =========================================================================
  // STATIC FILE SERVING
  // =========================================================================
  let fileRelPath = reqPath;
  if (fileRelPath === '/' || fileRelPath === '') fileRelPath = '/index.html';

  const filePath = path.join(__dirname, fileRelPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin, 'Vary': 'Origin' } : {})
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TrackFlow Backend & Cloud Sync Server running on port ${PORT}`);
  console.log('Authorized users loaded from deployment environment configuration.');
});
