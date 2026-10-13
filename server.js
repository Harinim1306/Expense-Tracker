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

// Authorized mobile numbers
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

const DEFAULT_PASSWORD = 'trackflow2026';

// Initialize Database structure
function getDefaultDb() {
  return {
    passwords: {
      master: DEFAULT_PASSWORD,
      '7418753113': DEFAULT_PASSWORD,
      '9384931363': DEFAULT_PASSWORD
    },
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
      '7418753113': {
        accounts: ['ICICI'],
        initialBalances: {
          ICICI: 10000
        },
        transactions: []
      },
      '9384931363': {
        accounts: ['Personal'],
        initialBalances: {
          Personal: 5000
        },
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
}

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(content);
      // Ensure structure integrity
      if (!data.bobAccount) data.bobAccount = getDefaultDb().bobAccount;
      if (!data.privateAccounts) data.privateAccounts = getDefaultDb().privateAccounts;
      if (!data.passwords) data.passwords = getDefaultDb().passwords;
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
    'Access-Control-Allow-Origin': '*',
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

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
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
          error: 'Access restricted. Only authorized partner mobile numbers (7418753113 or 9384931363) can enter.'
        });
        return;
      }

      // Check password
      const db = loadDb();
      const expectedPassword = db.passwords[cleanPhone] || db.passwords.master || DEFAULT_PASSWORD;

      if (password !== expectedPassword && password !== DEFAULT_PASSWORD) {
        sendJson(res, 401, {
          success: false,
          error: 'Incorrect password. Please verify and try again.'
        });
        return;
      }

      // Generate session token
      const token = 'tf_' + cleanPhone + '_' + crypto.randomBytes(16).toString('hex');

      // Return user profile and allowed accounts
      const userAccounts = cleanPhone === '7418753113'
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

  // Auth: Change Password
  if (reqPath === '/api/auth/change-password' && req.method === 'POST') {
    try {
      const { phone, currentPassword, newPassword } = await parseBody(req);
      const cleanPhone = normalizePhone(phone);
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        sendJson(res, 403, { success: false, error: 'Unauthorized user' });
        return;
      }

      if (!newPassword || newPassword.length < 4) {
        sendJson(res, 400, { success: false, error: 'Password must be at least 4 characters long' });
        return;
      }

      const db = loadDb();
      const expectedPassword = db.passwords[cleanPhone] || db.passwords.master || DEFAULT_PASSWORD;

      if (currentPassword !== expectedPassword && currentPassword !== DEFAULT_PASSWORD) {
        sendJson(res, 401, { success: false, error: 'Current password is incorrect' });
        return;
      }

      db.passwords[cleanPhone] = newPassword;
      db.passwords.master = newPassword; // Sync master
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
    const phone = normalizePhone(params.get('phone'));
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

    if (phone === '7418753113') {
      // Primary User gets ICICI
      const pStore = db.privateAccounts['7418753113'] || { accounts: ['ICICI'], initialBalances: { ICICI: 10000 }, transactions: [] };
      privateData = {
        accounts: pStore.accounts || ['ICICI'],
        initialBalances: pStore.initialBalances || { ICICI: 10000 },
        transactions: pStore.transactions || []
      };
    } else if (phone === '9384931363') {
      // Partner gets Partner's private account(s), NEVER ICICI!
      const pStore = db.privateAccounts['9384931363'] || { accounts: ['Personal'], initialBalances: { Personal: 5000 }, transactions: [] };
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
      const payload = await parseBody(req);
      const phone = normalizePhone(payload.phone);
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
      const { phone, accountName, initialBalance } = await parseBody(req);
      const cleanPhone = normalizePhone(phone);
      if (!AUTHORIZED_NUMBERS[cleanPhone]) {
        sendJson(res, 403, { success: false, error: 'Unauthorized user phone' });
        return;
      }

      const accName = (accountName || '').trim();
      if (!accName || accName.toUpperCase() === 'BOB' || accName.toUpperCase() === 'ICICI' && cleanPhone !== '7418753113') {
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
      'Access-Control-Allow-Origin': '*'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TrackFlow Backend & Cloud Sync Server running on port ${PORT}`);
  console.log(`Authorized Numbers: 7418753113 (Primary) & 9384931363 (Partner)`);
});
