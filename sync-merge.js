/* =====================================================================
 * 多端安全保存：三方智能合并 + 操作日志
 *
 * 背景：原来客户端每次保存都是「整包覆盖」，A 保存会盖掉 B 刚存的改动。
 * 方案：客户端提交时带上 _baseRev（它拿到数据时的版本）。服务器用
 *       base(那一版) / server(当前) / client(提交) 三方比对，只把「这个客户端
 *       真正改动的部分」应用到最新数据上，其余保留 —— 两人改不同记录都能成功。
 *
 * 操作日志独立存 logs.json（不进 db.json）：不占同步体积，也不会被客户端覆盖。
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

/* ------------------------- 工具 ------------------------- */
// 稳定序列化（键排序），避免键顺序不同造成的误判
function stable(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o === undefined ? null : o);
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
}
const eq = (a, b) => stable(a) === stable(b);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const hasId = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(x => x && typeof x === 'object' && x.id !== undefined);
function byId(arr) {
  const m = new Map();
  (Array.isArray(arr) ? arr : []).forEach(x => { if (x && x.id !== undefined) m.set(String(x.id), x); });
  return m;
}

/* ------------------------- 三方合并 ------------------------- */
/** 同一条记录被两边都改了 → 按字段合并：客户端动过的字段用客户端的，其余保留服务器的 */
function mergeRecord(base, server, client) {
  const out = { ...server };
  Object.keys(client || {}).forEach(k => {
    if (!eq(client[k], (base || {})[k])) out[k] = client[k];   // 客户端确实改了这个字段
  });
  // 客户端删掉的字段
  Object.keys(base || {}).forEach(k => {
    if (!(k in (client || {})) && k in out && eq((base || {})[k], (server || {})[k])) delete out[k];
  });
  return out;
}

/** 带 id 的数组：按 id 三方合并 */
function mergeArray(base, server, client) {
  const bm = byId(base), sm = byId(server), cm = byId(client);
  const out = new Map(sm);                         // 以服务器最新为基础
  const conflicts = [];

  // 客户端的新增 / 修改
  cm.forEach((cv, id) => {
    const bv = bm.get(id);
    if (!bv) {                                     // 客户端新增
      if (!sm.has(id)) out.set(id, cv);
      else if (!eq(sm.get(id), cv)) out.set(id, mergeRecord({}, sm.get(id), cv));
      return;
    }
    if (eq(bv, cv)) return;                        // 客户端没动过 → 保留服务器版本
    const sv = sm.get(id);
    if (!sv) { out.set(id, cv); return; }          // 服务器已删、客户端却改了 → 保守恢复
    if (eq(bv, sv)) out.set(id, cv);               // 服务器没动 → 直接用客户端
    else { out.set(id, mergeRecord(bv, sv, cv)); conflicts.push(id); }  // 两边都改 → 字段级合并
  });

  // 客户端的删除：仅当服务器也没动过这条时才执行（否则保留别人的新改动）
  bm.forEach((bv, id) => {
    if (cm.has(id)) return;
    const sv = sm.get(id);
    if (sv && eq(bv, sv)) out.delete(id);
  });

  return { value: [...out.values()], conflicts };
}

/** 纯对象（如 monthly_reviews、roi_replacement_manual）：按 key 三方合并 */
function mergeObject(base, server, client) {
  const out = { ...(server || {}) };
  const b = base || {}, c = client || {};
  Object.keys(c).forEach(k => { if (!eq(c[k], b[k])) out[k] = c[k]; });          // 客户端改的
  Object.keys(b).forEach(k => {                                                  // 客户端删的
    if (!(k in c) && k in out && eq(b[k], (server || {})[k])) delete out[k];
  });
  return out;
}

/** 三方合并入口 */
function merge3(base, server, client) {
  const out = { ...(server || {}) };
  const conflicts = [];
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(server || {}), ...Object.keys(client || {})]);
  keys.forEach(k => {
    if (k.startsWith('_')) return;                     // 元数据(_saved_at/_rev/_build...)不参与
    const b = (base || {})[k], s = (server || {})[k], c = (client || {})[k];
    if (c === undefined && s !== undefined) return;    // 客户端没这个字段 → 保留服务器
    if (hasId(c) || hasId(s)) {
      const r = mergeArray(b, s, c);
      out[k] = r.value;
      r.conflicts.forEach(id => conflicts.push(k + '#' + id));
    } else if (Array.isArray(c) || Array.isArray(s)) {
      out[k] = eq(c, b) ? s : c;                       // 无 id 的数组：整体取改动方
    } else if (isObj(c) || isObj(s)) {
      out[k] = mergeObject(b, s, c);
    } else {
      out[k] = eq(c, b) ? s : c;                       // 标量
    }
  });
  return { data: out, conflicts };
}

/* ------------------------- 操作日志 ------------------------- */
const TRACKED = {
  schedules:      { name: '内容排期', label: r => `${r.kol_name || '?'}${r.schedule_date ? ' · ' + r.schedule_date : ''}` },
  contents:       { name: '内容发布', label: (r, db) => {
                      const p = (r.publications || [])[0] || {};
                      let n = r.kol_name;
                      if (!n && r.schedule_id) n = ((db.schedules || []).find(s => String(s.id) === String(r.schedule_id)) || {}).kol_name;
                      return `${n || '?'}${p.date ? ' · ' + p.date : ''}${p.platform ? ' ' + p.platform : ''}`;
                    } },
  settlements:    { name: '达人结算', label: (r, db) => {
                      let n = r.kol_name || r.talent;
                      if (!n && r.schedule_id) n = ((db.schedules || []).find(s => String(s.id) === String(r.schedule_id)) || {}).kol_name;
                      return `${n || '?'} ¥${r.contract_amount ?? r.amount ?? 0}`;
                    } },
  kols:           { name: '达人库',   label: r => `${r.name || '?'}${r.platform ? ' · ' + r.platform : ''}` },
  samples:        { name: '样品管理', label: r => `${r.kol_name || r.name || '?'}${r.date ? ' · ' + r.date : ''}` },
  company_posts:  { name: '公司账号', label: r => `${(r.accounts || [r.account]).filter(Boolean).join('/') || '?'}${r.date ? ' · ' + r.date : ''}` },
  company_accounts:{ name: '公司账号设置', label: r => r.name || '?' },
  replacements:   { name: '置换成本', label: r => `${r.customer || r.product || '?'}${r.date ? ' · ' + r.date : ''}` },
  materials:      { name: '素材管理', label: r => r.title || r.name || '?' },
  bds:            { name: '商务BD',   label: r => r.name || '?' },
  supervisors:    { name: '品宣主管', label: r => r.name || '?' },
  schedule_directions: { name: '达人类型', label: r => r.name || '?' },
  work_types:     { name: '作品类型', label: r => r.name || '?' },
};
const FIELD_NAMES = {
  amount: '排期金额', schedule_date: '排期日期', kol_name: '达人', status: '状态',
  price: '价格', fans: '粉丝量', category_direction: '达人类型', work_type: '作品类型',
  bd_id: '负责BD', platform: '平台', contract_amount: '结算金额', bonus_amount: '奖金',
  invoice: '发票状态', settled: '已结算', note: '备注', title: '标题', link: '链接',
  date: '日期', account: '账号', accounts: '账号', hot: '爆款', followers: '粉丝数',
  name: '名称', views: '播放量', likes: '赞', collects: '收藏', comments: '评论',
};
const SKIP_FIELDS = new Set(['updated_at', 'created_at', '_saved_at', 'day7_recorded_at']);

function brief(v) {
  if (v === null || v === undefined || v === '') return '空';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (Array.isArray(v)) return v.length ? v.map(x => (isObj(x) ? '…' : String(x))).join('/') : '空';
  if (isObj(v)) return '…';
  const s = String(v);
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}
/** 算出两条记录之间「改了哪些字段」，输出中文描述 */
function fieldChanges(oldR, newR) {
  const out = [];
  const keys = new Set([...Object.keys(oldR || {}), ...Object.keys(newR || {})]);
  keys.forEach(k => {
    if (k === 'id' || SKIP_FIELDS.has(k)) return;
    const a = (oldR || {})[k], b = (newR || {})[k];
    if (eq(a, b)) return;
    if (k === 'publications') {                       // 发布明细：只描述关键变化
      const ao = (a || [])[0] || {}, bo = (b || [])[0] || {};
      ['date', 'platform', 'link', 'views', 'likes', 'collects', 'comments'].forEach(f => {
        if (!eq(ao[f], bo[f])) out.push(`${FIELD_NAMES[f] || f} ${brief(ao[f])} → ${brief(bo[f])}`);
      });
      return;
    }
    if (k === 'payments') { out.push('付款明细有变动'); return; }
    out.push(`${FIELD_NAMES[k] || k} ${brief(a)} → ${brief(b)}`);
  });
  return out.slice(0, 6);                             // 最多记 6 条，避免过长
}

/** 比对保存前后，生成操作日志 */
function buildLogs(before, after, actor) {
  const logs = [];
  const at = Date.now();
  const user = (actor && actor.name) || '未知';
  const role = (actor && actor.role) || '';
  Object.entries(TRACKED).forEach(([key, meta]) => {
    const b = byId((before || {})[key]), a = byId((after || {})[key]);
    if (b.size === 0 && a.size === 0) return;
    const mk = (action, rec, changes) => ({
      id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
      at, user, role, module: meta.name, action,
      target: (() => { try { return meta.label(rec, after || {}); } catch (e) { return '?'; } })(),
      changes: changes || [],
    });
    a.forEach((rec, id) => { if (!b.has(id)) logs.push(mk('create', rec)); });
    b.forEach((rec, id) => { if (!a.has(id)) logs.push(mk('delete', rec)); });
    a.forEach((rec, id) => {
      const old = b.get(id);
      if (!old || eq(old, rec)) return;
      const ch = fieldChanges(old, rec);
      if (ch.length) logs.push(mk('update', rec, ch));
    });
  });
  return logs;
}

/* ------------------------- 日志存储 ------------------------- */
const MAX_LOGS = 3000;
function readLogs(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch (e) { return []; }
}
function appendLogs(file, entries) {
  if (!entries || !entries.length) return;
  try {
    const all = [...entries, ...readLogs(file)];          // 新的在前
    fs.writeFileSync(file, JSON.stringify(all.slice(0, MAX_LOGS)));
  } catch (e) { console.warn('[log] 写入失败', e.message); }
}

module.exports = { merge3, buildLogs, readLogs, appendLogs, stable, eq };
