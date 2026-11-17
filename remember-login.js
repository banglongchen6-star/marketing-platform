'use strict';
const REMEMBER_MS = 30 * 86400000;
function createRememberLogin(organizations) {
  function cookieOptions(req) {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    return { name: secure ? '__Host-pinxuan_remember' : 'pinxuan_remember',
      options: { httpOnly: true, secure, sameSite: 'strict', path: '/' } };
  }
  function read(req) {
    const { name } = cookieOptions(req);
    const pair = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    if (!pair) return null;
    let token;
    try { token = decodeURIComponent(pair.slice(name.length + 1)); } catch (_) { return null; }
    return organizations.authenticate(token, 'remember');
  }
  function clear(req, res) {
    const { name, options } = cookieOptions(req);
    res.clearCookie(name, options);
    resume(req, res);
  }
  function paused(req) {
    const { name } = cookieOptions(req);
    return (req.headers.cookie || '').split(';').some(s => s.trim() === name + '_paused=1');
  }
  function pause(req, res, expiresAt) {
    const { name, options } = cookieOptions(req);
    res.cookie(name + '_paused', '1', { ...options, maxAge: Math.max(0, expiresAt - Date.now()) });
  }
  function resume(req, res) {
    const { name, options } = cookieOptions(req);
    res.clearCookie(name + '_paused', options);
  }
  function write(req, res, orgId, user, expiresAt = Date.now() + REMEMBER_MS) {
    const { name, options } = cookieOptions(req);
    const { token } = organizations.issue(orgId, user, { purpose: 'remember', expiresAt });
    res.cookie(name, token, { ...options, maxAge: Math.max(0, expiresAt - Date.now()) });
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
  return { read, clear, write, paused, pause, resume, sameOrigin, browserAction };
}
module.exports = { createRememberLogin };
