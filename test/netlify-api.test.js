const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TRACKFLOW_PRIMARY_PHONE = '1111111111';
process.env.TRACKFLOW_PARTNER_PHONE = '2222222222';
process.env.TRACKFLOW_PRIMARY_NAME = 'Primary Test';
process.env.TRACKFLOW_PARTNER_NAME = 'Partner Test';
process.env.TRACKFLOW_PASSWORD = 'test-only-password-very-long';
process.env.TRACKFLOW_TOKEN_SECRET = 'test-only-token-secret-long-enough';
delete process.env.TRACKFLOW_ALLOWED_ORIGIN;

const { handler } = require('../netlify/functions/api');

async function call(path, method = 'GET', body, token) {
  const response = await handler({
    path,
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    queryStringParameters: {},
    body: body === undefined ? undefined : JSON.stringify(body)
  }, {});
  return { status: response.statusCode, body: JSON.parse(response.body || '{}') };
}

async function login(phone, password = process.env.TRACKFLOW_PASSWORD) {
  return call('/api/auth/login', 'POST', { phone, password });
}

test('health endpoint responds', async () => {
  const r = await call('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('rejects invalid password and unknown account', async () => {
  assert.equal((await login('1111111111', 'wrong')).status, 401);
  assert.equal((await login('3333333333')).status, 401);
});

test('valid login returns a signed token; protected pull rejects missing token', async () => {
  const r = await login('1111111111');
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.ok(r.body.token);
  assert.equal((await call('/api/sync/pull')).status, 401);
  const pull = await call('/api/sync/pull', 'GET', undefined, r.body.token);
  assert.equal(pull.status, 200);
  assert.equal(pull.body.phone, '1111111111');
});

test('private account data is isolated between users', async () => {
  const primary = await login('1111111111');
  const partner = await login('2222222222');
  const push = await call('/api/sync/push', 'POST', {
    phone: '2222222222',
    private: {
      accounts: ['ICICI'],
      initialBalances: { ICICI: 123456 },
      transactions: [{ id: 'private-primary-test', account: 'ICICI', amount: 777, type: 'expense', datetime: new Date().toISOString() }]
    }
  }, primary.body.token);
  assert.equal(push.status, 200);
  const primaryPull = await call('/api/sync/pull', 'GET', undefined, primary.body.token);
  assert.equal(primaryPull.body.private.initialBalances.ICICI, 123456);
  const partnerPull = await call('/api/sync/pull', 'GET', undefined, partner.body.token);
  assert.equal(JSON.stringify(partnerPull.body.private).includes('private-primary-test'), false);
  assert.equal(JSON.stringify(partnerPull.body.private).includes('123456'), false);
});

test('push and account creation reject missing or invalid bearer tokens', async () => {
  assert.equal((await call('/api/sync/push', 'POST', { phone: '1111111111', bob: { initial: 1 } })).status, 401);
  assert.equal((await call('/api/accounts/add', 'POST', { accountName: 'Savings', initialBalance: 100 })).status, 401);
  assert.equal((await call('/api/sync/pull', 'GET', undefined, 'fake.token')).status, 401);
});

test('account creation uses the authenticated identity, not caller-supplied phone', async () => {
  const partner = await login('2222222222');
  const r = await call('/api/accounts/add', 'POST', { phone: '1111111111', accountName: 'Partner Savings', initialBalance: 900 }, partner.body.token);
  assert.equal(r.status, 200);
  const pull = await call('/api/sync/pull', 'GET', undefined, partner.body.token);
  assert.ok(pull.body.private.accounts.includes('Partner Savings'));
});
