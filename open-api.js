'use strict';
/**
 * 按人只读开放接口（2026-11-17）：给员工自己的 AI 工具和公司 AI 平台 popumind 用，接口都在 /api/open 下，只有 GET。
 *
 * 认人：两种凭证都交给 Cowork 的 /sso/keys/verify 验证，本系统不存任何密钥。
 *   - Authorization: Bearer <Cowork 访问密钥>：员工在碰头办公室「个人设置 → 账号安全 → 访问密钥」创建
 *   - x-popu-mind-assertion: popumind 的 AI 同事代某人调用时带的身份断言（优先）
 * Cowork 返回这个人绑定的品宣账号（和统一登录同一个绑定：admin / 姓名 / 组织名/姓名），之后按本地数据找人和组织。
 * 用统一登录的 OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET，没配齐时一律 503。
 *
 * 看得到什么：和这个人登录系统后看到的一样（本系统不按人限制数据），只限他所在的组织。
 * 不给：人员密码、样品收件人和电话地址、收款账户、逐日数据。
 */
const crypto = require('crypto');
const { resolveUsername } = require('./cowork-sso');

const BASE = '/api/open';
const ASSERTION_HEADER = 'x-popu-mind-assertion';
const KEY_PATTERN = /^cwk_[A-Za-z0-9_-]{43}$/;
const ASSERTION_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ASSERTION_MAX_LENGTH = 4096;
/** 验证通过的密钥缓存这么久：吊销最迟这么久后生效 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;
const VERIFY_TIMEOUT_MS = 5000;
/** 每个来源每分钟最多这么多次没命中缓存的密钥验证（挡住拿随机密钥刷接口）；断言每次都不同，单独放宽 */
const KEY_MISS_PER_MINUTE = 30;
const ASSERTION_PER_MINUTE = 300;
const DEFAULT_TAKE = 50;
const MAX_TAKE = 200;
const INACTIVE = ['invalid', 'no_access', 'not_bound'];

const HOW_TO = '请在请求头带 Authorization: Bearer <访问密钥>（在碰头办公室「个人设置 → 账号安全 → 访问密钥」创建）';
const FAILURES = {
  invalid: [401, `鉴权失败：凭证无效、已吊销或已过期。${HOW_TO}`],
  no_access: [401, '鉴权失败：你在碰头办公室还没有开通品宣工作台，请联系空间管理员授权'],
  not_bound: [401, '鉴权失败：你还没有在碰头办公室绑定品宣工作台账号（从碰头办公室左侧栏进入一次品宣工作台即可绑定）'],
  unavailable: [503, '暂时无法向碰头办公室验证身份，请稍后再试'],
  rate_limited: [429, '验证身份过于频繁，请一分钟后再试'],
  not_configured: [503, '品宣工作台还没有配置统一登录（OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET），无法验证身份'],
};

function verifyUrl(env) {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) return null;
  return new URL('/sso/keys/verify', env.OIDC_ISSUER).toString();
}

/** 按来源每分钟计数 */
function perMinute(limit, now) {
  let windowStart = 0;
  let counts = new Map();
  return source => {
    if (now() - windowStart >= 60_000) { windowStart = now(); counts = new Map(); }
    const count = (counts.get(source) || 0) + 1;
    counts.set(source, count);
    return count <= limit;
  };
}

/** 向 Cowork 验证凭证，返回 { ok, username, via } 或 { ok:false, reason } */
function createVerifier({ env, fetchImpl, now }) {
  const cache = new Map();
  const allowKeyMiss = perMinute(KEY_MISS_PER_MINUTE, now);
  const allowAssertion = perMinute(ASSERTION_PER_MINUTE, now);

  async function ask(body) {
    const url = verifyUrl(env);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(`${env.OIDC_CLIENT_ID}:${env.OIDC_CLIENT_SECRET}`).toString('base64'), 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      return response.ok ? await response.json() : null;
    } catch (_) { return null; }
  }
  const inactive = b => ({ ok: false, reason: b && b.active === false && INACTIVE.includes(b.reason) ? b.reason : 'unavailable' });
  const text = v => (typeof v === 'string' && v ? v : null);

  async function key(value, source) {
    if (!KEY_PATTERN.test(value)) return { ok: false, reason: 'invalid' };
    if (!verifyUrl(env)) return { ok: false, reason: 'not_configured' };
    const cacheKey = crypto.createHash('sha256').update(value).digest('hex');
    const hit = cache.get(cacheKey);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.check;
    if (!allowKeyMiss(source)) return { ok: false, reason: 'rate_limited' };
    const b = await ask({ key: value });
    if (b === null) return { ok: false, reason: 'unavailable' };
    if (b.active !== true) return inactive(b);
    const username = text(b.username), keyId = text(b.keyId);
    if (!username || !keyId) return { ok: false, reason: 'unavailable' };
    const check = { ok: true, username, via: 'key:' + keyId.slice(0, 8) };
    // 只缓存通过的：随机密钥挤不掉正常用户的缓存
    cache.delete(cacheKey);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { check, at: now() });
    return check;
  }

  // 断言 60 秒过期且每次都不同，不缓存
  async function assertion(value, source) {
    if (value.length > ASSERTION_MAX_LENGTH || !ASSERTION_PATTERN.test(value)) return { ok: false, reason: 'invalid' };
    if (!verifyUrl(env)) return { ok: false, reason: 'not_configured' };
    if (!allowAssertion(source)) return { ok: false, reason: 'rate_limited' };
    const b = await ask({ assertion: value });
    if (b === null) return { ok: false, reason: 'unavailable' };
    if (b.active !== true) return inactive(b);
    const via = b.via || {};
    const username = text(b.username), agent = text(via.agent), run = text(via.run);
    if (!username || !agent || !run) return { ok: false, reason: 'unavailable' };
    return { ok: true, username, via: `agent:${agent} run:${run}` };
  }
  return { key, assertion };
}

// ---- 取数：字段白名单，按 bd_id 带上负责人姓名 ----

function ownerNames(d) {
  const names = new Map();
  for (const p of [...(d.bds || []), ...(d.supervisors || [])]) names.set(String(p.id), p.name);
  return id => (id === undefined || id === null || id === '' ? null : names.get(String(id)) || null);
}
const pick = (row, fields) => Object.fromEntries(fields.filter(f => row[f] !== undefined).map(f => [f, row[f]]));
const has = (value, q) => String(value || '').toLowerCase().includes(q.toLowerCase());
const live = schedules => (schedules || []).filter(s => !s.deleted_at);

function kolStats(d, kolId) {
  const list = live(d.schedules).filter(s => s.kol_id === kolId && s.status !== 'cancelled');
  // 不挂排期、手动录的内容也算一次合作（和页面上的统计一致）
  const loose = (d.contents || []).filter(c => !c.schedule_id && c.kol_id === kolId);
  const dates = [...list.map(s => s.schedule_date), ...loose.map(c => ((c.publications || [])[0] || {}).date)].filter(Boolean).sort();
  return {
    count: list.length + loose.length,
    totalAmount: list.reduce((n, s) => n + (Number(s.amount) || 0), 0) + loose.reduce((n, c) => n + (Number(c.price) || 0), 0),
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
  };
}

const PUBLICATION_FIELDS = ['platform', 'date', 'link', 'views', 'likes', 'comments', 'shares', 'collects', 'completion', 'interaction',
  'nat_exposure', 'comp_exposure', 'search_views', 'promo_views', 'promo_cost'];

/** 每类数据：从库里取哪些行、按什么筛选、按什么排序、输出哪些字段 */
const RESOURCES = {
  kols: {
    rows: d => d.kols || [],
    filters: { q: (r, v) => has(r.name, v), platform: (r, v) => r.platform === v },
    owner: r => r.bd_id,
    sort: (a, b) => String(a.name).localeCompare(String(b.name), 'zh'),
    out: (r, d, owner) => ({ ...pick(r, ['id', 'name', 'platform', 'homepage', 'followers', 'category', 'notes']), owner: owner(r.bd_id), stats: kolStats(d, r.id) }),
  },
  schedules: {
    rows: d => live(d.schedules),
    date: r => r.schedule_date,
    filters: { status: (r, v) => r.status === v, kol: (r, v) => r.kol_id === v || has(r.kol_name, v), platform: (r, v) => r.platform === v },
    owner: r => r.bd_id,
    out: (r, d, owner) => ({ ...pick(r, ['id', 'schedule_date', 'kol_name', 'kol_id', 'platform', 'category_direction', 'work_type', 'amount',
      'status', 'confirmed', 'publish_url', 'publish_date', 'notes']), owner: owner(r.bd_id) }),
  },
  contents: {
    rows: d => d.contents || [],
    date: r => ((r.publications || [])[0] || {}).date,
    filters: { kol: (r, v) => r.kol_id === v || has(r.kol_name, v) },
    owner: r => r.bd_id,
    out: (r, d, owner) => ({ ...pick(r, ['id', 'schedule_id', 'kol_name', 'kol_id', 'category_direction', 'work_type', 'price', 'fans']),
      owner: owner(r.bd_id), publications: (r.publications || []).map(p => pick(p, PUBLICATION_FIELDS)) }),
  },
  samples: {
    rows: d => d.samples || [],
    date: r => r.date,
    filters: { status: (r, v) => r.status === v, kol: (r, v) => has(r.talent, v) },
    owner: r => r.contact,
    out: (r, d, owner) => ({ ...pick(r, ['id', 'talent', 'date', 'product', 'status', 'tracking', 'return_date', 'note', 'schedule_id']), owner: owner(r.contact) }),
  },
  settlements: {
    rows: d => d.settlements || [],
    date: r => r.publish_date,
    filters: { status: (r, v) => r.status === v, kol: (r, v) => has(r.kol_name, v) },
    // 结算没有负责人字段，跟着排期走
    owner: (r, d) => ((d.schedules || []).find(s => s.id === r.schedule_id) || {}).bd_id,
    out: (r, d, owner, ownerId) => ({ ...pick(r, ['id', 'schedule_id', 'content_id', 'kol_name', 'platform', 'publish_date', 'contract_amount', 'bonus_amount',
      'amount', 'status', 'invoice', 'settled_at']), owner: owner(ownerId),
      payments: (r.payments || []).map(p => pick(p, ['label', 'amount', 'plan_date', 'paid_date', 'status'])) }),
  },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 解析分页和日期；不合法抛 400 */
function parseQuery(query) {
  const int = (v, fallback) => (v === undefined ? fallback : /^\d+$/.test(String(v)) ? Number(v) : NaN);
  const take = int(query.take, DEFAULT_TAKE), skip = int(query.skip, 0);
  if (!(take >= 1 && take <= MAX_TAKE) || !(skip >= 0)) throw new Error(`take 需为 1 到 ${MAX_TAKE}，skip 需为非负整数`);
  for (const k of ['from', 'to']) if (query[k] !== undefined && !DATE.test(String(query[k]))) throw new Error(`${k} 需为 YYYY-MM-DD`);
  return { take, skip };
}

function list(resource, d, query) {
  const owner = ownerNames(d);
  const { take, skip } = parseQuery(query);
  const str = k => (typeof query[k] === 'string' && query[k].trim() ? query[k].trim() : null);
  let rows = resource.rows(d).map(r => ({ r, ownerId: resource.owner(r, d) }));
  for (const [k, test] of Object.entries(resource.filters)) { const v = str(k); if (v) rows = rows.filter(x => test(x.r, v)); }
  if (str('owner')) rows = rows.filter(x => owner(x.ownerId) === str('owner'));
  if (resource.date) {
    if (str('from')) rows = rows.filter(x => (resource.date(x.r) || '') >= str('from'));
    if (str('to')) rows = rows.filter(x => (resource.date(x.r) || '') !== '' && resource.date(x.r) <= str('to'));
    // 新的在前
    rows = [...rows].sort((a, b) => String(resource.date(b.r) || '').localeCompare(String(resource.date(a.r) || '')));
  } else if (resource.sort) rows = [...rows].sort((a, b) => resource.sort(a.r, b.r));
  return { total: rows.length, rows: rows.slice(skip, skip + take).map(x => resource.out(x.r, d, owner, x.ownerId)) };
}

/** 客户端地址：nginx 设的 X-Real-IP，只用于限流 */
const clientSource = req => req.get('x-real-ip') || req.ip || 'unknown';
const bearer = req => (/^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '') || [])[1] || '';

// fetch 用到时才取：服务器 Node 太老（没有全局 fetch）时只是验证失败返回 503，不影响整个服务启动
function registerOpenApi(app, { organizations, env = process.env, fetch: fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, log = line => console.info(line) }) {
  const verify = createVerifier({ env, fetchImpl, now });

  app.use(BASE, async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const name = req.path.replace(/^\//, '');
    const resource = Object.prototype.hasOwnProperty.call(RESOURCES, name) ? RESOURCES[name] : null;
    if (!resource) return res.status(404).json({ error: '没有这个接口' });
    if (req.method !== 'GET') return res.set('Allow', 'GET').status(405).json({ error: '开放接口只读，只接受 GET' });

    // 断言优先：popumind 的连接可能另配了固定请求头，有断言时按断言里的人算
    const assertion = req.get(ASSERTION_HEADER);
    const key = bearer(req);
    const check = assertion ? await verify.assertion(assertion, clientSource(req))
      : key ? await verify.key(key, clientSource(req)) : { ok: false, reason: 'invalid' };
    if (!check.ok) {
      const [status, error] = FAILURES[check.reason];
      if (status === 401) res.set('WWW-Authenticate', 'Bearer realm="pinxuan"');
      return res.status(status).json({ error });
    }

    let who, user, d;
    try {
      who = resolveUsername(organizations, check.username);
      user = who && organizations.resolveUser(who.orgId, who.kind, who.id);
      d = user && organizations.readDb(organizations.context(who.orgId));
    } catch (e) {
      console.error('[open-api] 读取数据失败:', e.message);
      return res.status(503).json({ error: '数据暂不可用，请稍后再试' });
    }
    if (!user) return res.status(403).json({ error: `品宣工作台账号「${check.username}」不存在、已停用，或同组织里有重名` });

    let result;
    try { result = list(resource, d, req.query); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    const org = organizations.find(who.orgId);
    log(`[open-api] ${org.id}/${user.name} ${check.via} GET ${req.originalUrl.split('?')[0]}`);
    res.json({ organization: { id: org.id, name: org.name }, currency: org.region === 'overseas' ? 'USD' : 'CNY', ...result });
  });
}

module.exports = { registerOpenApi, RESOURCES };
