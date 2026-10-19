'use strict';

// 仅供运营系统后端读取。不要引入前端data.js：它初始化时会迁移/保存业务数据。
const fs = require('fs');
const crypto = require('crypto');
const API_PATH = '/api/integrations/v1/content-publications';
const SCHEMA_VERSION = '1.0';
const METRICS = [
  'views', 'likes', 'comments', 'completion', 'interaction', 'nat_exposure',
  'collects', 'shares', 'comp_exposure', 'search_views', 'search_rate',
  'attr_direct', 'attr_indirect', 'attr_search', 'attr_audience', 'cpa3',
  'promo_views', 'promo_cost',
];
const PAID_STATUSES = new Set(['已付款', '已结算', 'paid', 'settled']);
const PAYMENT_LABELS = { none: '无需付款', unpaid: '未付款', applied: '已申请', partial: '部分付款', paid: '已付款' };

function fail() { throw new Error('INVALID_CONTENT_SNAPSHOT'); }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value;
}
function text(value) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') fail();
  return String(value);
}
function id(value) {
  if (value == null || value === '') return null;
  if (!['string', 'number'].includes(typeof value)) fail();
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail();
  if (!String(value).trim()) fail();
  return String(value);
}
function number(value) {
  if (value == null || value === '') return null;
  if (!['string', 'number'].includes(typeof value)) fail();
  const n = Number(value);
  if (!Number.isFinite(n)) fail();
  return n;
}
function array(value, required = false) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail();
  return value;
}
function rows(value, required = false) {
  const result = array(value, required);
  const seen = new Set();
  result.forEach(row => {
    object(row);
    const key = id(row.id);
    if (key === null || seen.has(key)) fail();
    seen.add(key);
  });
  return result;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function versioned(row) { return { ...row, record_version: hash(row) }; }
function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function sourceKey(kind, value) { return `${kind}:${encodeURIComponent(value)}`; }
function strings(value) { return array(value).map(v => text(v)); }

function publication(p, index) {
  const result = { id: id(p.id), is_main: index === 0, platform: text(p.platform), date: text(p.date), link: text(p.link) };
  METRICS.forEach(key => { result[key] = number(p[key]); });
  return {
    ...result,
    attr_store: text(p.attr_store),
    snapshot_day: text(p.snapshot_day),
    snapshot_at: text(p.snapshot_at) || null,
    day7_recorded_at: text(p.day7_recorded_at) || null,
    daily_stats: array(p.daily_stats).map(raw => {
      const stat = object(raw);
      return { date: text(stat.date), likes: number(stat.likes), comments: number(stat.comments), fetched_at: text(stat.fetched_at) || null };
    }),
    mat_downloaded: Boolean(p.mat_downloaded), mat_uploaded: Boolean(p.mat_uploaded), mat_note: text(p.mat_note),
    // 已从界面移除的自然阅读，如历史记录仍有值则保留，不重新作为现行指标使用。
    legacy: { nat_reads: number(p.nat_reads) },
  };
}

// 跟随communication.js的付款标签规则；仅输出标签，不输出收款账户/发票等结算资料。
function paymentStatus(list, price) {
  if (!list.length) return price === 0 ? 'none' : 'unpaid';
  const st = list.find(s => !s.settled);
  if (!st) return 'paid';
  const base = parseFloat(st.contract_amount ?? st.amount) || 0;
  const due = base + (st.bonus_enabled ? parseFloat(st.bonus_amount) || 0 : 0);
  const payments = array(st.payments).map(object);
  let paid = 0;
  if (payments.length) {
    paid = payments.reduce((sum, p) => {
      const amount = parseFloat(p.amount) || 0;
      const actualDate = p.actual_paid_date || p.actualPaidDate || (PAID_STATUSES.has(p.status) ? p.paid_date || p.plan_date : '');
      return sum + (actualDate ? (payments.length === 1 && due > 0 && amount <= 0 ? due : amount) : 0);
    }, 0);
  } else {
    const actualDate = st.actual_paid_date || st.actualPaidDate || (PAID_STATUSES.has(st.status) ? st.payDate || st.paid_date || st.plan_date : '');
    paid = actualDate ? (parseFloat(st.amount) || due || 0) : 0;
  }
  if (due <= 0) return 'none';
  if (paid > 0) return paid + 0.01 < due ? 'partial' : 'paid';
  return payments.some(p => p.paid_date) ? 'applied' : 'unpaid';
}

function buildSnapshot(db, localPreview) {
  object(db);
  // 核心分组必须存在，避免损坏/半初始化的数据库被当作“成功的空快照”。
  const contents = rows(db.contents, true);
  const schedules = rows(db.schedules, true);
  const companyPosts = rows(db.company_posts, true);
  const companyAccounts = rows(db.company_accounts, true);
  const bds = rows(db.bds);
  const supervisors = rows(db.supervisors);
  const settlements = rows(db.settlements);
  const scheduleById = new Map(schedules.map(s => [id(s.id), s]));
  const people = new Map(supervisors.map(s => [id(s.id), { name: text(s.name), color: '#7c3aed' }]));
  bds.forEach(b => people.set(id(b.id), { name: text(b.name), color: text(b.color) }));
  const settlementsBySchedule = new Map();
  const settlementsByContent = new Map();
  settlements.forEach(st => {
    [[settlementsBySchedule, st.schedule_id], [settlementsByContent, st.content_id]].forEach(([map, rawKey]) => {
      const key = id(rawKey);
      if (key !== null) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(st);
      }
    });
  });

  function resolved(c, s) {
    const bdId = id(s ? s.bd_id : c.bd_id);
    const bd = people.get(bdId);
    const price = number(s ? s.amount : c.price);
    const scheduleId = id(s ? s.id : c.schedule_id);
    const payment = paymentStatus((scheduleId ? settlementsBySchedule.get(scheduleId) : settlementsByContent.get(id(c.id))) || [], price);
    return {
      schedule_id: scheduleId,
      kol_id: id(s ? s.kol_id : c.kol_id),
      talent: text(s ? s.kol_name : c.kol_name),
      category_direction: text(s ? s.category_direction : c.category_direction),
      work_type: text(s ? s.work_type : c.work_type),
      price,
      bd_id: bdId, bd_name: bd ? bd.name : '', bd_color: bd ? bd.color : '',
      schedule_date: s ? text(s.schedule_date) : '',
      schedule_status: s ? text(s.status) : '',
      schedule_deleted_at: s ? text(s.deleted_at) || null : null,
      payment_status: payment, payment_status_label: PAYMENT_LABELS[payment],
    };
  }

  const exportedContents = contents.map(c => {
    const s = scheduleById.get(id(c.schedule_id));
    const publications = rows(c.publications, true).map(publication);
    return versioned({
      id: id(c.id), source_key: sourceKey('content', id(c.id)),
      origin: id(c.schedule_id) ? 'schedule' : 'manual',
      auto_created: Boolean(c.auto_created),
      schedule_missing: id(c.schedule_id) !== null && !s,
      ...resolved(c, s),
      fans: number(c.fans),
      main_publication_id: publications.length ? publications[0].id : null,
      main_platform: publications.length ? publications[0].platform : '',
      publications,
      created_at: text(c.created_at) || null, updated_at: text(c.updated_at) || null,
    });
  }).sort(byId);
  const linkedIds = new Set(contents.map(c => id(c.schedule_id)).filter(v => v !== null));
  const pending = schedules.filter(s => !s.deleted_at && !linkedIds.has(id(s.id))).map(s => versioned({
    id: id(s.id), source_key: sourceKey('schedule', id(s.id)),
    status: 'pending_content', ...resolved({}, s),
    platforms: Array.isArray(s.platforms) && s.platforms.length ? strings(s.platforms) : (s.platform ? [text(s.platform)] : []),
    created_at: text(s.created_at) || null, updated_at: text(s.updated_at) || null,
  })).sort(byId);
  const posts = companyPosts.map(p => versioned({
    id: id(p.id), source_key: sourceKey('company_post', id(p.id)),
    accounts: Array.isArray(p.accounts) && p.accounts.length ? strings(p.accounts) : (p.account ? [text(p.account)] : []),
    date: text(p.date), title: text(p.title), link: text(p.link), hot: Boolean(p.hot), note: text(p.note),
    created_at: text(p.created_at) || null, updated_at: text(p.updated_at) || null,
    legacy: { platform: text(p.platform), views: number(p.views), likes: number(p.likes), collects: number(p.collects), comments: number(p.comments) },
  })).sort(byId);
  const accounts = companyAccounts.map(a => versioned({
    id: id(a.id), source_key: sourceKey('company_account', id(a.id)), name: text(a.name),
  })).sort(byId);

  const data = { contents: exportedContents, pending_contents: pending, company_posts: posts, company_accounts: accounts };
  const counts = Object.fromEntries(Object.entries(data).map(([key, values]) => [key, values.length]));
  counts.publications = exportedContents.reduce((sum, c) => sum + c.publications.length, 0);
  const body = {
    schema_version: SCHEMA_VERSION,
    source: 'pinxuan', environment: localPreview ? 'local-preview' : 'production',
    scope: 'content_publications', complete: true, mode: 'full_snapshot',
    units: { views: '万', promo_views: '万', price: '元', promo_cost: '元', fans: '人', completion: '%', interaction: '%', search_rate: '%' },
    counts, data,
  };
  const snapshotId = hash(body);
  return { ...body, snapshot_id: snapshotId, generated_at: new Date().toISOString() };
}

function registerContentPublicationsApi(app, { dataFile, appToken, localPreview = false }) {
  const token = process.env.CONTENT_SYNC_TOKEN || '';
  // 专用随机256位密钥；禁止误用原来具有整库写入权限的登录令牌。
  const enabled = /^[a-f0-9]{64}$/i.test(token) && token !== appToken;
  const tokenBytes = Buffer.from(token);
  app.all(API_PATH, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Authorization');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!enabled) return res.status(503).json({ error: 'integration_not_configured', message: '同步接口尚未启用' });
    const auth = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization') || '');
    if (!auth || !crypto.timingSafeEqual(Buffer.from(auth[1]), tokenBytes)) {
      res.set('WWW-Authenticate', 'Bearer realm="content-publications"');
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (req.method !== 'GET') {
      res.set('Allow', 'GET');
      return res.status(405).json({ error: 'method_not_allowed' });
    }
    // v1没有时间/平台/分页筛选，避免接收方拿局部结果清理全部旧记录。
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'query_not_supported' });
    try {
      // 不用readDbSafe：读失败/解析失败必须报错，不返回空集合。
      const db = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const snapshot = buildSnapshot(db, localPreview);
      // generated_at每次变化，弱ETag表示业务快照相同，不保证响应逐字节相同。
      const tag = `W/"${snapshot.snapshot_id}"`;
      res.set('ETag', tag);
      const requested = (req.get('If-None-Match') || '').split(',').map(s => s.trim());
      if (requested.some(v => v === '*' || v.replace(/^W\//, '') === tag.replace(/^W\//, ''))) return res.status(304).end();
      return res.json(snapshot);
    } catch (_) {
      // 不把业务记录、文件路径或密钥输出到响应/日志。
      console.error('[content-sync] Snapshot unavailable; database read or validation failed.');
      res.set('Retry-After', '60');
      return res.status(503).json({ error: 'snapshot_unavailable', message: '本次取数失败，请保留上次数据后重试' });
    }
  });
  // 未知集成接口也要返回JSON错误，不能被SPA兜底页面冒充成功响应。
  app.use('/api/integrations', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(404).json({ error: 'integration_endpoint_not_found' });
  });
}

module.exports = { registerContentPublicationsApi };
