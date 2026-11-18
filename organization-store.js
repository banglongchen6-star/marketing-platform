'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error('组织数据文件缺失，请联系管理员');
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('数据格式异常');
  return data;
}
function emptyData(region) {
  const data = {};
  for (const key of ['schedules','contents','kols','samples','settlements','materials','candidates',
    'bds','supervisors','replacements','company_posts','company_accounts','schedule_directions',
    'schedule_budgets','schedule_import_logs','product_lines','sample_products','tiers','work_types','frozenMonths']) data[key] = [];
  data.platforms = (region === 'overseas' ? ['TikTok','Instagram','YouTube','Facebook'] : ['抖音','小红书','B站','视频号','快手'])
    .map((name, i) => ({ id: 'platform-' + i, name, sort_order: i + 1, is_active: true }));
  data.payment_accounts = [];
  data.monthly_reviews = {};
  data.comm_col_prefs = {};
  data.douyin_promo = {};
  data.roi_replacement_manual = {};
  data._wiped_demo_data_2026_05_11 = true;
  data._wiped_phase1_modules_2026_05_11 = true;
  data._comms_v2_2026_05_15 = true;
  data._fansBackfilled_v1 = true;
  return data;
}
function createOrganizationStore(root, adminPass) {
  const registryFile = path.join(root, 'organizations.json');
  const secretFile = path.join(root, '.organization-session-secret');
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48), { mode: 0o600, flag: 'wx' });
  const secret = fs.readFileSync(secretFile);
  if (secret.length < 32) throw new Error('组织会话密钥异常');
  const newMeta = (id, name, region) => ({ id, name, region, currency: 'CNY', timezone: 'Asia/Shanghai', created_at: new Date().toISOString() });
  if (!fs.existsSync(registryFile)) {
    const legacyFile = path.join(root, 'db.json');
    const migrationBackup = path.join(root, 'before-organizations.json');
    if (fs.existsSync(legacyFile) && !fs.existsSync(migrationBackup)) {
      readJson(legacyFile);
      fs.copyFileSync(legacyFile, migrationBackup, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(migrationBackup, 0o600);
    }
    if (!fs.existsSync(legacyFile)) atomicJson(legacyFile, emptyData('domestic'));
    // 国内原文件不搬迁、不覆盖；海外仅在没有历史目录时创建空库。
    const overseasFile = path.join(root, 'organizations', 'overseas', 'db.json');
    if (!fs.existsSync(overseasFile)) atomicJson(overseasFile, emptyData('overseas'));
    atomicJson(registryFile, { organizations: [newMeta('domestic', '国内品宣部门', 'domestic'), newMeta('overseas', '海外品宣部门', 'overseas')] });
  }
  const registry = readJson(registryFile);
  if (!Array.isArray(registry.organizations) || !registry.organizations.some(o => o.id === 'domestic')) throw new Error('组织配置异常');
  const states = new Map();
  function find(id) { return registry.organizations.find(o => o.id === id); }
  function context(id) {
    const org = find(id);
    if (!org || !/^[a-z0-9-]+$/.test(id)) throw new Error('组织不存在');
    if (!states.has(id)) {
      const dir = id === 'domestic' ? root : path.join(root, 'organizations', id);
      const ctx = { org, dir, dataFile: path.join(dir, 'db.json'), logFile: path.join(dir, 'logs.json'),
        backupDir: path.join(dir, 'backups'), emailFile: path.join(dir, 'email-config.json'),
        revision: 0, epoch: crypto.randomBytes(16).toString('hex'), snapshots: new Map() };
      const data = readDb(ctx);
      snapshot(ctx, data);
      states.set(id, ctx);
    }
    return states.get(id);
  }
  function readDb(ctx) {
    // 仅首次初始化可创建空库；运行中丢失或损坏的文件绝不降级为空。
    return readJson(ctx.dataFile);
  }
  function snapshot(ctx, data) {
    ctx.revision++;
    ctx.snapshots.set(ctx.revision, JSON.stringify(data));
    for (const key of ctx.snapshots.keys()) if (key <= ctx.revision - 100) ctx.snapshots.delete(key);
    return ctx.revision;
  }
  function create(name, region) {
    name = String(name || '').trim();
    if (!name || name.length > 40 || /[\x00-\x1f]/.test(name)) throw new Error('组织名称需为1–40个字');
    if (registry.organizations.some(o => o.name === name)) throw new Error('组织名称已存在');
    if (!['domestic','overseas'].includes(region)) throw new Error('请选择平台模板');
    const org = newMeta('org-' + crypto.randomBytes(8).toString('hex'), name, region);
    atomicJson(path.join(root, 'organizations', org.id, 'db.json'), emptyData(region));
    const next = [...registry.organizations, org];
    atomicJson(registryFile, { organizations: next });
    registry.organizations = next;
    return org;
  }
  const credential = password => crypto.createHmac('sha256', secret).update(String(password)).digest('hex');
  function resolveUser(orgId, identity, id) {
    if (!find(orgId)) return null;
    if (identity === 'admin') return { identity: 'admin', name: '管理员', role: '管理员', bd_id: null, isSuperAdmin: true, credential: credential(adminPass) };
    const d = readDb(context(orgId));
    const collection = identity === 'bd' ? d.bds : identity === 'supervisor' ? d.supervisors : [];
    const row = (collection || []).find(x => String(x.id) === String(id) && x.is_active !== false && x.password);
    if (!row) return null;
    return { identity, name: row.name, role: identity === 'bd' ? '商务BD' : '品宣主管', bd_id: row.id,
      ...(identity === 'supervisor' ? { sv_id: row.id } : {}), isSuperAdmin: false, credential: credential(row.password) };
  }
  function login(orgId, identity, password) {
    let kind, id;
    if (identity === 'admin') kind = 'admin';
    else if (String(identity).startsWith('bd__')) { kind = 'bd'; id = identity.slice(4); }
    else if (String(identity).startsWith('sv__')) { kind = 'supervisor'; id = identity.slice(4); }
    const user = resolveUser(orgId, kind, id);
    if (!user || typeof password !== 'string' || credential(password) !== user.credential) return null;
    return issue(orgId, user);
  }
  function publicUser(user, orgId) { const { credential: ignored, ...safe } = user; return { ...safe, organization: find(orgId) }; }
  function issue(orgId, user, { purpose = 'session', expiresAt = Date.now() + 7 * 86400000 } = {}) {
    const payload = Buffer.from(JSON.stringify({ org: orgId, identity: user.identity, id: user.bd_id, cred: user.credential,
      exp: expiresAt, purpose, nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return { token: payload + '.' + signature, user: publicUser(user, orgId) };
  }
  function authenticate(token, purpose = 'session') {
    if (typeof token !== 'string' || token.length > 2000) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if ((claims.purpose || 'session') !== purpose || !Number.isFinite(claims.exp) || claims.exp <= Date.now()) return null;
    const user = resolveUser(claims.org, claims.identity, claims.id);
    if (!user || user.credential !== claims.cred) return null;
    return { user: publicUser(user, claims.org), ctx: context(claims.org), expiresAt: claims.exp };
  }
  // 其他模块需要防篡改签名时用（如统一登录的登录中 cookie），按用途区分，不暴露密钥本身
  const sign = (purpose, body) => crypto.createHmac('sha256', secret).update(purpose + ':' + body).digest('base64url');
  return { list: () => registry.organizations.map(o => ({ ...o })), find, context, readDb, snapshot, create, login, issue, resolveUser, authenticate, sign };
}
module.exports = { createOrganizationStore, atomicJson, emptyData };
