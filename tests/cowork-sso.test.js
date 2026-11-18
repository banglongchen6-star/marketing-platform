'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { emptyData, createOrganizationStore, atomicJson } = require('../organization-store');
const { createRememberLogin } = require('../remember-login');
const { registerCoworkSso, resolveUsername } = require('../cowork-sso');
const { readLogs } = require('../sync-merge');

const ENV = { OIDC_ISSUER: 'https://cowork.test/oidc', OIDC_CLIENT_ID: 'pinxuan', OIDC_CLIENT_SECRET: 'test-client-secret',
  OIDC_REDIRECT_URI: 'https://pinxuan.test/api/auth/oidc/callback' };

function setupStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinxuan-sso-test-'));
  const domestic = emptyData('domestic');
  domestic.bds = [{ id: 1, name: '张三', password: 'pw-zhang', is_active: true }, { id: 2, name: '离职', password: 'pw-x', is_active: false }, { id: 4, name: '离职', password: 'pw-new' },
    { id: 3, name: '重名', password: 'pw-a' }];
  domestic.supervisors = [{ id: 's1', name: '李主管', password: 'pw-li' }, { id: 's2', name: '重名', password: 'pw-b' }];
  atomicJson(path.join(root, 'db.json'), domestic);
  const organizations = createOrganizationStore(root, 'test-admin-pass');
  const overseas = emptyData('overseas');
  overseas.bds = [{ id: 9, name: '张三', password: 'pw-overseas' }];
  atomicJson(path.join(root, 'organizations', 'overseas', 'db.json'), overseas);
  return { root, organizations };
}

function fakeLib(claims = { preferred_username: '张三' }, { grantError } = {}) {
  const calls = { grant: [] };
  const lib = {
    discovery: async () => ({ issuer: 'fake' }),
    allowInsecureRequests: () => {},
    randomPKCECodeVerifier: () => 'verifier-1',
    randomState: () => 'state-1',
    randomNonce: () => 'nonce-1',
    calculatePKCECodeChallenge: async v => 'challenge-' + v,
    buildAuthorizationUrl: (config, params) => {
      const url = new URL('https://cowork.test/oidc/auth');
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      return url;
    },
    authorizationCodeGrant: async (config, url, checks) => {
      calls.grant.push({ url: url.href, checks });
      if (grantError) throw new Error('bad state');
      return { claims: () => claims };
    },
  };
  return { lib, calls };
}

async function start(t, { env = ENV, lib = fakeLib().lib } = {}) {
  const { root, organizations } = setupStore();
  const app = express();
  app.use(express.json());
  registerCoworkSso(app, { organizations, rememberedLogin: createRememberLogin(organizations), env, loadClient: async () => lib });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (p, headers = {}) => fetch(base + p, { redirect: 'manual', headers: { 'x-forwarded-proto': 'https', ...headers } });
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { organizations, get, post };
}

const cookieValue = (res, name) => {
  const line = res.headers.getSetCookie().find(c => c.startsWith(name + '='));
  return line && decodeURIComponent(line.split(';')[0].slice(name.length + 1));
};

async function loginCookie(app) {
  const res = await app.get('/api/auth/oidc/login');
  return 'pinxuan_oidc=' + encodeURIComponent(cookieValue(res, 'pinxuan_oidc'));
}

test('all routes are 404 when OIDC is not fully configured', async t => {
  const app = await start(t, { env: { ...ENV, OIDC_ISSUER: '' } });
  assert.equal((await app.get('/api/auth/oidc/login')).status, 404);
  assert.equal((await app.get('/api/auth/oidc/callback?code=x')).status, 404);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三', password: 'pw-zhang' })).status, 404);
});

test('login redirects with PKCE S256, state, nonce, redirect_uri, scope and sets a scoped pending cookie', async t => {
  const app = await start(t);
  const res = await app.get('/api/auth/oidc/login');
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get('location'));
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-verifier-1');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('nonce'), 'nonce-1');
  assert.equal(url.searchParams.get('redirect_uri'), ENV.OIDC_REDIRECT_URI);
  assert.equal(url.searchParams.get('scope'), 'openid profile');
  const line = res.headers.getSetCookie().find(c => c.startsWith('pinxuan_oidc='));
  assert.match(line, /Path=\/api\/auth\/oidc/);
  assert.match(line, /HttpOnly/);
  assert.match(line, /SameSite=Lax/);
  assert.match(line, /Secure/);
  assert.match(line, /Max-Age=600/);
});

test('callback rejects a missing or tampered pending cookie without calling the token endpoint', async t => {
  const { lib, calls } = fakeLib();
  const app = await start(t, { lib });
  assert.equal((await app.get('/api/auth/oidc/callback?code=c&state=state-1')).status, 400);
  const cookie = await loginCookie(app);
  const [body, sig] = decodeURIComponent(cookie.split('=')[1]).split('.');
  const forged = Buffer.from(JSON.stringify({ verifier: 'evil', state: 'state-1', nonce: 'nonce-1' })).toString('base64url');
  assert.equal((await app.get('/api/auth/oidc/callback?code=c', { cookie: 'pinxuan_oidc=' + forged + '.' + sig })).status, 400);
  assert.equal((await app.get('/api/auth/oidc/callback?code=c', { cookie: 'pinxuan_oidc=' + body + '.x' + sig.slice(1) })).status, 400);
  assert.equal(calls.grant.length, 0);
});

test('callback passes verifier/state/nonce to the library and uses OIDC_REDIRECT_URI as current URL', async t => {
  const { lib, calls } = fakeLib();
  const app = await start(t, { lib });
  const res = await app.get('/api/auth/oidc/callback?code=abc&state=state-1', { cookie: await loginCookie(app), host: 'evil.test' });
  assert.equal(res.status, 302);
  assert.deepEqual(calls.grant[0].checks, { pkceCodeVerifier: 'verifier-1', expectedState: 'state-1', expectedNonce: 'nonce-1' });
  assert.equal(calls.grant[0].url, ENV.OIDC_REDIRECT_URI + '?code=abc&state=state-1');
});

test('library validation failure is rejected and issues no session', async t => {
  const app = await start(t, { lib: fakeLib(undefined, { grantError: true }).lib });
  const res = await app.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app) });
  assert.equal(res.status, 401);
  assert.equal(cookieValue(res, '__Host-pinxuan_remember'), undefined);
});

test('token without preferred_username is rejected', async t => {
  const app = await start(t, { lib: fakeLib({ sub: 'u1' }).lib });
  const res = await app.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app) });
  assert.equal(res.status, 403);
  assert.equal(cookieValue(res, '__Host-pinxuan_remember'), undefined);
});

test('unknown, disabled or ambiguous accounts are rejected with a failure log', async t => {
  for (const name of ['不存在', '离职', '重名']) {
    const app = await start(t, { lib: fakeLib({ preferred_username: name }).lib });
    const res = await app.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app) });
    assert.equal(res.status, 403, name);
    assert.equal(cookieValue(res, '__Host-pinxuan_remember'), undefined);
    const log = readLogs(app.organizations.context('domestic').logFile)[0];
    assert.equal(log.action, 'login_failed');
    assert.equal(log.user, name);
    assert.ok(log.changes.includes('via: cowork-sso'));
  }
});

test('success issues the same session as password login, clears the pending cookie and logs via cowork-sso', async t => {
  const app = await start(t, { lib: fakeLib({ preferred_username: '张三', role: '管理员' }).lib });
  const res = await app.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app) });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/?sso=1');
  const auth = app.organizations.authenticate(cookieValue(res, '__Host-pinxuan_remember'), 'remember');
  assert.equal(auth.user.identity, 'bd');
  assert.equal(auth.user.role, '商务BD'); // 角色来自本地数据，不信令牌里的 role
  assert.equal(auth.user.isSuperAdmin, false);
  assert.equal(auth.ctx.org.id, 'domestic');
  assert.ok(auth.expiresAt <= Date.now() + 7 * 86400000);
  const sessionCookie = res.headers.getSetCookie().find(c => c.startsWith('__Host-pinxuan_remember='));
  assert.doesNotMatch(sessionCookie, /Max-Age|Expires/i); // 关浏览器即失效
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.ok(res.headers.getSetCookie().some(c => c.startsWith('pinxuan_oidc=;')));
  const log = readLogs(app.organizations.context('domestic').logFile)[0];
  assert.equal(log.action, 'login');
  assert.equal(log.user, '张三');
  assert.ok(log.changes.includes('via: cowork-sso'));
});

test('check-login answers Cowork binding with 200 for correct and 401 for wrong credentials', async t => {
  const app = await start(t);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三', password: 'pw-zhang' })).status, 200);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: ' 李主管 ', password: 'pw-li' })).status, 200);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '海外品宣部门/张三', password: 'pw-overseas' })).status, 200);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: 'admin', password: 'test-admin-pass' })).status, 200);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三', password: 'pw-overseas' })).status, 401);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '重名', password: 'pw-a' })).status, 401);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '离职', password: 'pw-x' })).status, 401);
  // 停用的人和新来的同名：两边都不认，不会把旧绑定认成新人
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '离职', password: 'pw-new' })).status, 401);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三' })).status, 401);
  assert.equal((await app.post('/api/auth/oidc/check-login', {})).status, 401);
});

test('check-login locks one account after 10 failures from the same source without blocking others', async t => {
  const app = await start(t);
  for (let i = 0; i < 10; i++) assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三', password: 'wrong' })).status, 401);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '张三', password: 'pw-zhang' })).status, 429);
  assert.equal((await app.post('/api/auth/oidc/check-login', { username: '李主管', password: 'pw-li' })).status, 200);
});

test('failed logins with an unknown organization are not written into another organization log', async t => {
  const app = await start(t, { lib: fakeLib({ preferred_username: 'overseas/不存在' }).lib });
  assert.equal((await app.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app) })).status, 403);
  assert.equal(readLogs(app.organizations.context('overseas').logFile)[0].action, 'login_failed');
  assert.equal(readLogs(app.organizations.context('domestic').logFile).length, 0);
  const app2 = await start(t, { lib: fakeLib({ preferred_username: '没有这个组织/张三' }).lib });
  assert.equal((await app2.get('/api/auth/oidc/callback?code=abc', { cookie: await loginCookie(app2) })).status, 403);
  assert.equal(readLogs(app2.organizations.context('domestic').logFile).length, 0);
});

test('a malformed OIDC_REDIRECT_URI fails the callback cleanly instead of crashing', async t => {
  const app = await start(t, { env: { ...ENV, OIDC_REDIRECT_URI: 'https-not-a-url' } });
  const cookie = await loginCookie(app);
  assert.equal((await app.get('/api/auth/oidc/callback?code=abc', { cookie })).status, 401);
});

test('resolveUsername maps names per organization', t => {
  const { root, organizations } = setupStore();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(resolveUsername(organizations, '张三'), { orgId: 'domestic', kind: 'bd', id: 1, identity: 'bd__1' });
  assert.deepEqual(resolveUsername(organizations, 'overseas/张三'), { orgId: 'overseas', kind: 'bd', id: 9, identity: 'bd__9' });
  assert.equal(resolveUsername(organizations, '不存在的组织/张三'), null);
  assert.equal(resolveUsername(organizations, '重名'), null);
  assert.equal(resolveUsername(organizations, 'x'.repeat(101)), null);
  assert.equal(resolveUsername(organizations, 42), null);
});
