'use strict';
/**
 * Cowork 统一登录（OIDC 客户端，2026-11-16）。四个环境变量没配齐就整体关闭（三个路由都 404）：
 *   OIDC_ISSUER        Cowork 身份方地址，如 https://cowork-api.popumusic.cn/oidc
 *   OIDC_CLIENT_ID     在 Cowork 空间「接入系统」里登记的系统 ID
 *   OIDC_CLIENT_SECRET 登记时显示一次的客户端密钥
 *   OIDC_REDIRECT_URI  本系统回调地址，必须与 Cowork 登记的完全一致
 *
 * 账号绑定在 Cowork 完成：同事在 Cowork 输一次「账号 + 密码」，Cowork 调 /api/auth/oidc/check-login 验证。
 * 本系统登录是下拉选人、没有用户名，所以「账号」= 姓名（2026-11-16 选定）：
 *   admin           总管理员
 *   张三            国内组织的商务BD或品宣主管
 *   海外品宣部门/张三  其他组织：组织名（或组织 ID）/ 姓名
 * 同一组织里 BD 和主管重名时认不出是谁，一律拒绝。改名后要在 Cowork 重新绑定。
 * 角色、权限全部按本地数据算，令牌里只认 preferred_username。
 */
const crypto = require('crypto');
const merger = require('./sync-merge');

const BASE = '/api/auth/oidc';
const PENDING_COOKIE = 'pinxuan_oidc';
const PENDING_TTL_MS = 10 * 60 * 1000;
/** 统一登录进来的会话时长：与密码登录的会话令牌一致（organization-store issue 默认 7 天） */
const SSO_SESSION_MS = 7 * 86400000;
const MAX_USERNAME_LENGTH = 100;
/** 绑定验证接口：同一来源 + 同一账号 10 分钟内最多错 10 次（Cowork 自己按用户另有限流） */
const CHECK_FAIL_LIMIT = 10;
const CHECK_FAIL_WINDOW_MS = 10 * 60 * 1000;
const CHECK_FAIL_MAX_KEYS = 5000;

const enabled = env => Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_REDIRECT_URI);

/** 「账号」拆成组织 + 姓名；组织不存在返回 null */
function splitUsername(organizations, username) {
  const raw = typeof username === 'string' ? username.trim() : '';
  if (!raw || raw.length > MAX_USERNAME_LENGTH) return null;
  const slash = raw.indexOf('/');
  const orgKey = slash >= 0 ? raw.slice(0, slash).trim() : 'domestic';
  const org = organizations.list().find(o => o.id === orgKey || o.name === orgKey);
  return org ? { orgId: org.id, name: (slash >= 0 ? raw.slice(slash + 1) : raw).trim() } : null;
}

/** 「账号」→ 组织 + 身份；认不出或有歧义返回 null */
function resolveUsername(organizations, username) {
  if (typeof username === 'string' && username.trim() === 'admin') return { orgId: 'domestic', kind: 'admin', id: undefined, identity: 'admin' };
  const target = splitUsername(organizations, username);
  if (!target || !target.name) return null;
  const d = organizations.readDb(organizations.context(target.orgId));
  // 重名判断把停用的人也算上：停用张三后新来一个张三，旧的 Cowork 绑定会被拒绝，而不是认成新人
  const named = rows => (rows || []).filter(x => String(x.name || '').trim() === target.name);
  const matches = [
    ...named(d.bds).map(x => ({ row: x, kind: 'bd', id: x.id, identity: 'bd__' + x.id })),
    ...named(d.supervisors).map(x => ({ row: x, kind: 'supervisor', id: x.id, identity: 'sv__' + x.id })),
  ];
  if (matches.length !== 1 || matches[0].row.is_active === false || !matches[0].row.password) return null;
  const { row, ...match } = matches[0];
  return { orgId: target.orgId, ...match };
}

/** nginx 设的 X-Real-IP 调用方伪造不了；X-Forwarded-For 的第一段可以，只作兜底 */
const clientIp = req => req.get('x-real-ip') || req.ip || '';

function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch (_) { return undefined; }
}

function registerCoworkSso(app, { organizations, rememberedLogin, env = process.env, loadClient = () => import('openid-client') }) {
  const sign = body => organizations.sign('oidc-pending', body);
  const encodePending = pending => {
    const body = Buffer.from(JSON.stringify(pending)).toString('base64url');
    return body + '.' + sign(body);
  };
  const decodePending = value => {
    const [body, sig, extra] = String(value || '').split('.');
    if (!body || !sig || extra) return null;
    const expected = Buffer.from(sign(body)), actual = Buffer.from(sig);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
  };
  // 登录中 cookie：回调地址是 https 才加 Secure（本地 http 联调加了浏览器就不回传）
  const pendingOptions = () => ({ httpOnly: true, sameSite: 'lax', path: BASE, secure: env.OIDC_REDIRECT_URI.startsWith('https:') });

  let configPromise = null;
  // discovery 结果进程内缓存；失败不缓存，下次重试。库按需加载：没开统一登录时不影响启动
  async function oidc() {
    const lib = await loadClient();
    const issuer = new URL(env.OIDC_ISSUER);
    configPromise = configPromise || lib.discovery(issuer, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, undefined,
      issuer.protocol === 'http:' ? { execute: [lib.allowInsecureRequests] } : undefined)
      .catch(error => { configPromise = null; throw error; });
    return { lib, config: await configPromise };
  }

  function audit(orgId, entry) {
    try {
      const ctx = organizations.context(orgId);
      merger.appendLogs(ctx.logFile, [{ id: Date.now() + '-' + crypto.randomBytes(3).toString('hex'), at: Date.now(),
        module: '登录', changes: ['via: cowork-sso'], ...entry }]);
    } catch (e) { console.warn('[oidc] 写登录日志失败:', e.message); }
  }

  function fail(res, status, message) {
    res.clearCookie(PENDING_COOKIE, pendingOptions());
    res.status(status).type('text/plain; charset=utf-8')
      .send(message + '\n\n可以回到 Cowork 重新进入，或在品宣工作台登录页用账号密码登录。');
  }

  app.use(BASE, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled(env)) return res.status(404).type('text/plain; charset=utf-8').send('未开启统一登录');
    next();
  });

  // Cowork 左侧栏按钮打开这里 → 跳去 Cowork 授权
  app.get(BASE + '/login', async (req, res) => {
    try {
      const { lib, config } = await oidc();
      const verifier = lib.randomPKCECodeVerifier();
      const state = lib.randomState();
      const nonce = lib.randomNonce();
      const url = lib.buildAuthorizationUrl(config, {
        redirect_uri: env.OIDC_REDIRECT_URI, scope: 'openid profile',
        code_challenge: await lib.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce,
      });
      res.cookie(PENDING_COOKIE, encodePending({ verifier, state, nonce }), { ...pendingOptions(), maxAge: PENDING_TTL_MS });
      res.redirect(302, url.href);
    } catch (e) {
      console.error('[oidc] 无法连接统一登录:', e.message);
      res.status(503).type('text/plain; charset=utf-8').send('暂时无法连接 Cowork 统一登录，请稍后再试');
    }
  });

  app.get(BASE + '/callback', async (req, res) => {
    const pending = decodePending(readCookie(req, PENDING_COOKIE));
    if (!pending) return fail(res, 400, '登录请求已过期');
    let username;
    try {
      // 反代后 req 的协议/主机不可信，以登记的回调地址为准，只取查询参数
      const currentUrl = new URL(env.OIDC_REDIRECT_URI);
      currentUrl.search = new URL(req.originalUrl, 'http://localhost').search;
      const { lib, config } = await oidc();
      const tokens = await lib.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce,
      });
      username = (tokens.claims() || {}).preferred_username;
    } catch (e) {
      console.error('[oidc] 统一登录校验失败:', e.message);
      return fail(res, 401, '统一登录校验失败');
    }
    if (typeof username !== 'string' || !username) return fail(res, 403, '你的 Cowork 账号还没有绑定品宣工作台账号');
    const ip = clientIp(req);
    let who, user;
    try {
      who = resolveUsername(organizations, username);
      user = who && organizations.resolveUser(who.orgId, who.kind, who.id);
    } catch (e) {
      console.error('[oidc] 读取人员失败:', e.message);
      return fail(res, 503, '组织数据暂不可用，请联系管理员');
    }
    if (!user) {
      // 只记进账号所属组织的日志；组织都认不出就只记服务器日志，不写进别的组织
      const target = splitUsername(organizations, username);
      const entry = { user: username, role: '', action: 'login_failed', target: username,
        changes: ['via: cowork-sso', '原因: 账号不存在、已停用或重名', 'ip: ' + ip] };
      if (target) audit(target.orgId, entry);
      else console.warn('[oidc] 统一登录账号无法识别组织:', JSON.stringify(username), 'ip:', ip);
      return fail(res, 403, `品宣工作台账号「${username}」不存在、已停用，或同组织里有重名`);
    }
    // 关掉浏览器即失效（与不勾「记住登录」的密码登录一致）；从 Cowork 再点一次就能进
    rememberedLogin.write(req, res, who.orgId, user, Date.now() + SSO_SESSION_MS, { persistent: false });
    audit(who.orgId, { user: user.name, role: user.role, action: 'login', target: user.name, changes: ['via: cowork-sso', 'ip: ' + ip] });
    res.clearCookie(PENDING_COOKIE, pendingOptions());
    // 前端见到 sso=1 会丢掉这个标签页里旧的会话，改用刚发的统一登录会话（防串号）
    res.redirect(302, '/?sso=1');
  });

  // Cowork「登录验证接口」：绑定时 POST {username, password}，2xx = 正确，401 = 错误。密码不记日志
  // ponytail: 进程内计数，重启清零；多实例部署时要换共享存储
  const failures = new Map();
  app.post(BASE + '/check-login', (req, res) => {
    try {
      const { username, password } = req.body || {};
      const key = clientIp(req) + '|' + String(username).slice(0, MAX_USERNAME_LENGTH);
      const now = Date.now();
      const record = failures.get(key);
      const recent = record && now - record.start < CHECK_FAIL_WINDOW_MS ? record : null;
      if (recent && recent.count >= CHECK_FAIL_LIMIT) return res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' });
      const who = resolveUsername(organizations, username);
      const ok = Boolean(who && typeof password === 'string' && organizations.login(who.orgId, who.identity, password));
      if (!ok) {
        if (!recent && failures.size >= CHECK_FAIL_MAX_KEYS) failures.delete(failures.keys().next().value);
        failures.set(key, recent ? { ...recent, count: recent.count + 1 } : { start: now, count: 1 });
        return res.status(401).json({ error: '账号或密码错误' });
      }
      failures.delete(key);
      res.json({ ok: true });
    } catch (_) { res.status(503).json({ error: '登录服务暂不可用' }); }
  });
}

module.exports = { registerCoworkSso, resolveUsername };
