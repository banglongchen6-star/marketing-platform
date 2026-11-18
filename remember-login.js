'use strict';
const REMEMBER_MS = 30 * 86400000;
const MAX_ACCOUNTS = 8; // 单个Cookie需小于4KB；每张凭据约400字节
function createRememberLogin(organizations) {
  function cookieOptions(req) {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    return { name: secure ? '__Host-pinxuan_remember' : 'pinxuan_remember',
      options: { httpOnly: true, secure, sameSite: 'strict', path: '/' } };
  }
  // 登录页身份下拉的取值，同时用作账号键（组织内唯一）
  function identityOf(user) {
    return user.identity === 'admin' ? 'admin' : (user.identity === 'supervisor' ? 'sv__' : 'bd__') + user.bd_id;
  }
  function accountOf(auth) { return { organization: auth.ctx.org.id, identity: identityOf(auth.user) }; }
  function sameAccount(a, b) { return a.organization === b.organization && a.identity === b.identity; }
  // Cookie里按最近使用排序存多张凭据（用 ~ 分隔，凭据本身只含 base64url 和点号）
  function readAll(req) {
    const { name } = cookieOptions(req);
    const pair = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    if (!pair) return [];
    let value;
    try { value = decodeURIComponent(pair.slice(name.length + 1)); } catch (_) { return []; }
    const entries = [];
    for (const token of value.split('~').slice(0, MAX_ACCOUNTS)) {
      const auth = organizations.authenticate(token, 'remember');
      if (!auth) continue;
      const account = accountOf(auth);
      if (!entries.some(e => sameAccount(e.account, account))) entries.push({ token, auth, account });
    }
    return entries;
  }
  function save(req, res, entries, { persistent = true } = {}) {
    const { name, options } = cookieOptions(req);
    if (!entries.length) { res.clearCookie(name, options); resume(req, res); return; }
    const expiresAt = Math.max(...entries.map(e => e.auth.expiresAt));
    res.cookie(name, entries.map(e => e.token).join('~'), persistent ? { ...options, maxAge: Math.max(0, expiresAt - Date.now()) } : options);
  }
  function read(req) { return readAll(req)[0]?.auth || null; }
  function find(req, account) { return readAll(req).find(e => sameAccount(e.account, account))?.auth || null; }
  function accounts(req) { return readAll(req).map(e => e.account); }
  function clear(req, res) {
    const { name, options } = cookieOptions(req);
    res.clearCookie(name, options);
    resume(req, res);
  }
  function forget(req, res, account) {
    save(req, res, readAll(req).filter(e => !sameAccount(e.account, account)));
  }
  // 把已记住的账号移到最前（下次打开页面自动进入它），不延长原有效期
  function touch(req, res, account) {
    const entries = readAll(req);
    const hit = entries.find(e => sameAccount(e.account, account));
    if (hit) save(req, res, [hit, ...entries.filter(e => e !== hit)]);
  }
  function paused(req) {
    const { name } = cookieOptions(req);
    return (req.headers.cookie || '').split(';').some(s => s.trim() === name + '_paused=1');
  }
  function pause(req, res) {
    const { name, options } = cookieOptions(req);
    const entries = readAll(req);
    const expiresAt = entries.length ? Math.max(...entries.map(e => e.auth.expiresAt)) : Date.now();
    res.cookie(name + '_paused', '1', { ...options, maxAge: Math.max(0, expiresAt - Date.now()) });
  }
  function resume(req, res) {
    const { name, options } = cookieOptions(req);
    res.clearCookie(name + '_paused', options);
  }
  // persistent:false = 浏览器会话 Cookie，关掉浏览器即失效（统一登录用）；凭据本身仍按 expiresAt 过期
  // ponytail: 多个账号共用一个 Cookie，最近一次是统一登录时整个 Cookie 都变成关浏览器即失效；要分开就给统一登录单独一个 Cookie
  function write(req, res, orgId, user, expiresAt = Date.now() + REMEMBER_MS, { persistent = true } = {}) {
    const { token } = organizations.issue(orgId, user, { purpose: 'remember', expiresAt });
    const account = { organization: orgId, identity: identityOf(user) };
    const auth = { expiresAt };
    save(req, res, [{ token, auth, account }, ...readAll(req).filter(e => !sameAccount(e.account, account))].slice(0, MAX_ACCOUNTS), { persistent });
    resume(req, res);
  }
  // Cookies only restore a tab session. All business routes still require an explicit token.
  function sameOrigin(req, res, next) {
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'请从本系统登录页面操作'});
    const origin = req.get('origin');
    if (origin) {
      try { if (new URL(origin).host !== req.get('host')) throw new Error('origin'); }
      catch (_) { return res.status(403).json({error:'请从本系统登录页面操作'}); }
    }
    next();
  }
  function browserAction(req, res, next) {
    if (req.get('x-login-action') !== '1') return res.status(403).json({error:'登录操作无效'});
    sameOrigin(req, res, next);
  }
  return { read, find, accounts, identityOf, clear, forget, touch, write, paused, pause, resume, sameOrigin, browserAction };
}
module.exports = { createRememberLogin };
