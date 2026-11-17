const express  = require('express');
const fs        = require('fs');
const path      = require('path');
const { createOrganizationStore, atomicJson } = require('./organization-store');
const merger    = require('./sync-merge');   // 三方合并 + 操作日志
const nodemailer = require('nodemailer');
const cron      = require('node-cron');
const { registerContentPublicationsApi } = require('./content-publications-api');

const app = express();
const PORT       = process.env.PORT || 3002;
const HOST       = process.env.HOST || '0.0.0.0';
const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
fs.mkdirSync(DATA_DIR, { recursive:true });
const BUILD_ID   = Date.now(); // 进程启动时间，作为版本标识（pm2 restart 后变化 → 前端旧标签自动刷新）
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'mw-7f3a9c2e8b1d4f6a0e5c9b2d8a4f1e6c'; // 接口访问令牌（server.js 不对外暴露，登录后下发）
const DATA_FILE  = path.join(DATA_DIR, 'db.json');
const STATIC_DIR = path.join(__dirname, 'extracted/media-workbench');
const MAX_BACKUPS = 7;
const organizations = createOrganizationStore(DATA_DIR, ADMIN_PASS);
organizations.context('domestic');
const rememberedLogin = require('./remember-login').createRememberLogin(organizations);
const emailJobs = new Map();

app.use(express.json({ limit: '20mb' }));
// 大页面和组织数据压缩传输；登录令牌等鉴权响应不参与压缩。
const compression = require('compression');
app.use(compression({
  threshold: 1024,
  filter(req, res) {
    if (/^\/api\/(?:login|logout|session)(?:\/|$)/.test(req.path)) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.static(STATIC_DIR, {
  setHeaders(res, filename) {
    if (/\.html$/i.test(filename)) res.setHeader('Cache-Control', 'no-cache');
    else if (typeof res.req.query.v === 'string' && /^[\w.-]+$/.test(res.req.query.v) && /\.(?:js|css|png|svg|ico|woff2?)$/i.test(filename)) {
      // 改资源时同步递增HTML中的v参数；业务API始终no-store。
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// 运营系统专用只读API，独立密钥；不经过现有整库读写接口。
registerContentPublicationsApi(app, { dataFile: DATA_FILE, appToken: AUTH_TOKEN, localPreview: process.env.LOCAL_PREVIEW === '1' });

// 仅用于标记隔离的本地体验环境，不返回路径或鉴权信息。
app.get('/api/runtime-info', (req, res) => {
  res.set('Cache-Control','no-store');
  res.json({ localPreview: process.env.LOCAL_PREVIEW === '1' });
});

/* ========== 备份工具 ========== */
function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()); }
function ensureBackupDir(ctx) {
  if (!fs.existsSync(ctx.backupDir)) fs.mkdirSync(ctx.backupDir, { recursive: true });
}
function createDailyBackup(data, ctx) {
  ensureBackupDir(ctx);
  // 防呆：空/残缺数据不写备份，避免覆盖掉当天已有的好备份
  if (!data || typeof data !== 'object') return;
  const hasContent = ['schedules', 'contents', 'kols', 'settlements', 'samples']
    .some(k => Array.isArray(data[k]) && data[k].length > 0);
  if (!hasContent) return;
  const filename = `data-${todayStr()}.json`;
  const filepath = path.join(ctx.backupDir, filename);
  // 每次保存都更新当天备份，确保备份=当天最新完整状态
  // （原来只在当天第一次保存时备份，会把旧标签推上来的残缺数据固化成当天备份）
  atomicJson(filepath, { ...data, _organization_id: ctx.org.id });
  pruneOldBackups(ctx);
}
function pruneOldBackups(ctx) {
  try {
    const files = fs.readdirSync(ctx.backupDir)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort();
    if (files.length > MAX_BACKUPS) {
      files.slice(0, files.length - MAX_BACKUPS).forEach(f => {
        fs.unlinkSync(path.join(ctx.backupDir, f));
        console.log(`🗑 已删除旧备份: ${f}`);
      });
    }
  } catch(e) { console.error('清理备份失败', e); }
}

/* ========== 邮件工具 ========== */
function loadEmailCfg(ctx) {
  try {
    if (fs.existsSync(ctx.emailFile)) return JSON.parse(fs.readFileSync(ctx.emailFile, 'utf8'));
  } catch(e) {}
  return null;
}

async function sendBackupEmail(cfg, isTest = false, ctx) {
  const { senderEmail, senderPass, recipients, smtpHost, smtpPort } = cfg;
  const transporter = nodemailer.createTransport({
    host: smtpHost || 'smtp.qiye.aliyun.com',
    port: Number(smtpPort) || 465,
    secure: true,
    auth: { user: senderEmail, pass: senderPass },
  });

  // 读取当前数据
  const data = fs.existsSync(ctx.dataFile) ? fs.readFileSync(ctx.dataFile, 'utf8') : '{}';
  const db = JSON.parse(data);
  const summary = `排期 ${db.schedules?.length||0} 条 / 达人 ${db.kols?.length||0} 个 / 内容 ${db.contents?.length||0} 条 / 样品 ${db.samples?.length||0} 条`;
  const dateStr = todayStr();

  await transporter.sendMail({
    from: `"品宣运营工作台" <${senderEmail}>`,
    to: Array.isArray(recipients) ? recipients.join(',') : recipients,
    subject: isTest
      ? `[测试] 品宣数据备份 ${dateStr}`
      : `品宣数据每日备份 ${dateStr}`,
    html: `
      <h3>📦 品宣运营工作台 · ${isTest ? '测试邮件' : '每日数据备份'}</h3>
      <p>备份日期：<strong>${dateStr}</strong></p>
      <p>数据概览：${summary}</p>
      <p>完整数据见附件，可通过「导入备份」功能恢复。</p>
      <hr><p style="color:#999;font-size:12px">此邮件由系统自动发送，请勿回复。</p>
    `,
    attachments: [{
      filename: `品宣备份_${dateStr}.json`,
      content: data,
      contentType: 'application/json',
    }],
  });
  console.log(`📧 备份邮件已发送 → ${recipients}`);
}

/* ========== 定时任务（根据配置的时间每天发送） ========== */
function scheduleDailyEmail(ctx) {
  if (emailJobs.has(ctx.org.id)) { emailJobs.get(ctx.org.id).stop(); emailJobs.get(ctx.org.id).destroy(); emailJobs.delete(ctx.org.id); }
  const cfg = loadEmailCfg(ctx);
  if (!cfg || !cfg.enabled) return;
  const [h, m] = (cfg.sendTime || '22:00').split(':');
  const cronExpr = `${m||0} ${h||22} * * *`;
  const job = cron.schedule(cronExpr, async () => {
    const latestCfg = loadEmailCfg(ctx); // 每次发送时重新读取最新配置
    if (!latestCfg || !latestCfg.enabled) return;
    try { await sendBackupEmail(latestCfg, false, ctx); }
    catch(e) { console.error('📧 邮件发送失败', e.message); }
  }, { timezone: 'Asia/Shanghai' });
  emailJobs.set(ctx.org.id, job);
  console.log(`📧 每日邮件备份已启动，发送时间: ${cfg.sendTime || '22:00'}`);
}

/* ========== 组织与身份：权限由服务器会话决定 ========== */
app.get('/api/organizations', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(organizations.list());
});
app.get('/api/login-options', (req, res) => {
  try {
    const orgId = String(req.query.organization || 'domestic');
    const d = organizations.readDb(organizations.context(orgId));
    const opts = [{ value: 'admin', label: '👑 总管理员' }];
    for (const [key, prefix, label] of [['bds','bd__','商务BD'],['supervisors','sv__','品宣主管']]) {
      (d[key] || []).filter(x => x.is_active !== false && x.password).forEach(x => opts.push({ value: prefix + x.id, label: x.name + '（' + label + '）' }));
    }
    res.set('Cache-Control', 'no-store'); res.json(opts);
  } catch(e) { res.status(400).json({ error: '无法读取该组织人员' }); }
});
app.post('/api/login', rememberedLogin.sameOrigin, (req, res) => {
  try {
    const { organization = 'domestic', identity, password, remember = false } = req.body || {};
    const result = organizations.login(organization, identity, password);
    if (!result) return res.status(401).json({ error: '账号或密码错误，或不属于所选组织' });
    const user = organizations.resolveUser(organization, result.user.identity, result.user.bd_id);
    // 每个账号各记各的：勾选则记住/刷新本账号，不勾选只忘记本账号，不影响已记住的其他账号
    if (remember === true) rememberedLogin.write(req, res, organization, user);
    else rememberedLogin.forget(req, res, { organization, identity: rememberedLogin.identityOf(user) });
    res.set('Cache-Control', 'no-store'); res.json(result);
  } catch(e) { res.status(500).json({ error: '登录服务暂不可用' }); }
});
// remembered：本浏览器已记住的全部账号（只含组织和身份，不含凭据），供登录页切换身份时免输密码
app.post('/api/session/restore', rememberedLogin.browserAction, (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const auth = rememberedLogin.read(req);
    if (!auth) { rememberedLogin.clear(req, res); return res.json({ user: null, remembered: [] }); }
    const remembered = rememberedLogin.accounts(req);
    if (rememberedLogin.paused(req)) return res.json({ user: null, remembered });
    const user = organizations.resolveUser(auth.ctx.org.id, auth.user.identity, auth.user.bd_id);
    res.json({ ...organizations.issue(auth.ctx.org.id, user, { expiresAt: Math.min(auth.expiresAt, Date.now() + 7 * 86400000) }), remembered });
  } catch (_) { res.status(503).json({error:'暂时无法恢复登录，请稍后重试'}); }
});
app.post('/api/session/resume', rememberedLogin.browserAction, (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const account = { organization: req.body?.organization, identity: req.body?.identity };
    if (!rememberedLogin.read(req)) { rememberedLogin.clear(req, res); return res.status(401).json({error:'记住的登录已失效，请重新输入密码'}); }
    const auth = rememberedLogin.find(req, account);
    if (!auth) return res.status(403).json({error:'此账号尚未记住，请输入密码'});
    const user = organizations.resolveUser(auth.ctx.org.id, auth.user.identity, auth.user.bd_id);
    const result = organizations.issue(auth.ctx.org.id, user, { expiresAt: Math.min(auth.expiresAt, Date.now() + 7 * 86400000) });
    if (req.body.remember === true) { rememberedLogin.touch(req, res, account); rememberedLogin.resume(req, res); }
    else rememberedLogin.forget(req, res, account);
    res.json(result);
  } catch (_) { res.status(503).json({error:'暂时无法恢复登录，请稍后重试'}); }
});
app.post('/api/logout', rememberedLogin.browserAction, (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { keepRemembered, organization, identity } = req.body || {};
    // 退出：保留全部已记住账号，只是不再自动进入；忘记某账号：只删这一个；都没给：全部清除
    if (keepRemembered === true && rememberedLogin.read(req)) rememberedLogin.pause(req, res);
    else if (organization && identity) rememberedLogin.forget(req, res, { organization, identity });
    else rememberedLogin.clear(req, res);
    res.json({ok:true});
  } catch (_) { res.status(503).json({error:'暂时无法退出，请稍后重试'}); }
});
function requireAuth(req, res, next) {
  try {
    const auth = organizations.authenticate(req.headers['x-auth-token'] || req.query.t || '');
    if (!auth) return res.status(401).json({ error: '登录已失效，请重新登录' });
    req.user = auth.user; req.org = auth.ctx;
    if (req.headers['x-organization-id'] && req.headers['x-organization-id'] !== req.org.org.id) return res.status(403).json({ error: '组织不匹配' });
    res.set('Cache-Control', 'no-store'); next();
  } catch(e) { res.status(503).json({ error: '组织数据暂不可用，请联系管理员' }); }
}
function requireManager(req, res, next) {
  if (!['admin','supervisor'].includes(req.user.identity)) return res.status(403).json({ error: '需要管理权限' });
  next();
}
function requireSuperAdmin(req, res, next) {
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: '仅总管理员可以管理组织' });
  next();
}
app.get('/api/session', requireAuth, (req, res) => res.json({ user: req.user }));
app.post('/api/organizations', requireAuth, requireSuperAdmin, (req, res) => {
  try { res.status(201).json(organizations.create(req.body.name, req.body.region)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/organizations/switch', requireAuth, requireSuperAdmin, (req, res) => {
  const id = req.body.organization;
  if (!organizations.find(id)) return res.status(404).json({ error: '组织不存在' });
  const user = organizations.resolveUser(id, 'admin');
  // 当前组织的管理员已记住时，目标组织的管理员也一并记住（沿用原到期时间，不延长）
  const remembered = rememberedLogin.find(req, { organization: req.org.org.id, identity: 'admin' });
  if (remembered) rememberedLogin.write(req, res, id, user, remembered.expiresAt);
  res.json(organizations.issue(id, user));
});
function clientData(data, user) {
  const copy = JSON.parse(JSON.stringify(data));
  if (!user.isSuperAdmin) for (const key of ['bds','supervisors']) {
    copy[key] = (copy[key] || []).map(({password, ...row}) => row);
  }
  return copy;
}

/* ========== 数据 API ========== */
app.get('/api/data', requireAuth, (req, res) => {
  try {
    const data = clientData(organizations.readDb(req.org), req.user);
    data._organization_id = req.org.org.id;
    data._organization = req.org.org;
    data._epoch = req.org.epoch;
    data._build = BUILD_ID; // 附带版本标识（前端用于检测部署、自动刷新旧标签）
    data._rev = req.org.revision; // 数据版本：客户端保存时带回，用于三方合并
    res.json(data);
  } catch(e) { res.status(500).json({ error: '读取失败' }); }
});

const CORE_KEYS = ['schedules', 'contents', 'kols', 'settlements', 'samples', 'bds', 'supervisors'];
function hasCoreData(d) {
  return d && typeof d === 'object' && CORE_KEYS.some(k => Array.isArray(d[k]) && d[k].length > 0);
}
app.post('/api/data', requireAuth, (req, res) => {
  try {
    if (!req.body || Array.isArray(req.body) || req.body._organization_id !== req.org.org.id) return res.status(403).json({ error: '保存组织不匹配，请重新登录' });
    // 防清空：现有数据非空时，拒绝用空数据整体覆盖（防止空缓存浏览器误推）
    if (!hasCoreData(req.body) && hasCoreData(organizations.readDb(req.org))) {
      console.warn('⛔ 拒绝空数据覆盖（防清空保护）');
      return res.status(409).json({ error: '拒绝保存：提交的数据为空，已保护服务器现有数据' });
    }
    const body    = req.body || {};
    const baseRev = body._baseRev;
    const actor   = { name: req.user.name, role: req.user.role };
    const server  = organizations.readDb(req.org);

    // 三方合并：客户端基于旧版本改的 → 只把它改动的部分并入最新数据，不整包覆盖
    // 【铁律】服务器已有数据时，任何"拿不准怎么合并"的情况一律拒绝，绝不退化成整包覆盖。
    //  2026-09-02 事故：一个开了很久的旧页面保存，基准版本超出快照窗口，旧代码"退化为覆盖"，
    //  把当天上午的全部工作冲回了前一天。
    let final = body, merged = false, conflicts = 0;
    const serverHasData = hasCoreData(server);
    const rejectStale = (msg) => res.status(409).json({ error: msg, stale: true, rev: req.org.revision });
    // ④ 客户端自救：页面过期被拒后，浏览器带着自己记得的基准版本(_base)重交 → 直接三方合并，不依赖服务器快照窗口。
    //    基准由已登录客户端自报，其可信度与它提交的数据本身相同（本来就允许它写入），且合并总是对着服务器"此刻"的最新数据做。
    const clientBase = (body._base && typeof body._base === 'object' && !Array.isArray(body._base)) ? body._base : null;
    delete body._base;
    if (clientBase && clientBase._organization_id !== req.org.org.id) return res.status(403).json({ error: '合并基准不属于当前组织' });
    if (!clientBase && body._epoch !== req.org.epoch && serverHasData) return rejectStale('服务版本已更新，正在重新合并');
    if (clientBase) {
      try {
        const r = merger.merge3(clientBase, server, body);
        final = r.data; merged = true; conflicts = (r.conflicts || []).length;
      } catch(e) {
        console.warn('[merge] 客户端基准合并失败：', e.message);
        if (serverHasData) return rejectStale('数据合并失败，请刷新后重试');
      }
    } else if (baseRev == null) {
      // 没带版本号 = 老缓存页面（不含合并逻辑）。服务器有数据就拒绝，逼它刷新
      if (serverHasData) return rejectStale('页面版本过旧，请刷新后重试');
    } else if (Number(baseRev) !== req.org.revision) {
      const raw = req.org.snapshots.get(Number(baseRev));
      const base = raw ? JSON.parse(raw) : null;
      if (!base) {
        // 基准版本已超出合并窗口（页面开太久 / 服务重启）→ 拒绝，不覆盖
        if (serverHasData) return rejectStale('你的页面数据已过期，请刷新后重新操作');
      } else {
        try {
          const r = merger.merge3(base, server, body);
          final = r.data; merged = true; conflicts = (r.conflicts || []).length;
        } catch(e) {
          console.warn('[merge] 合并失败：', e.message);
          if (serverHasData) return rejectStale('数据合并失败，请刷新后重试');
        }
      }
    }
    ['_baseRev', '_actor', '_rev', '_build', '_base', '_epoch', '_organization', '_organization_id'].forEach(k => { delete final[k]; });
    if (!req.user.isSuperAdmin) { final.bds = server.bds || []; final.supervisors = server.supervisors || []; }
    final._organization_id = req.org.org.id;
    final._saved_at = Date.now();

    createDailyBackup(final, req.org);
    atomicJson(req.org.dataFile, final);
    const rev = organizations.snapshot(req.org, final);
    // 数据写入成功后再记录操作，避免出现只有日志却未保存的假成功。
    try { merger.appendLogs(req.org.logFile, merger.buildLogs(server, final, actor)); } catch(e) { console.warn('[log]', e.message); }
    res.json({ ok: true, rev, merged, conflicts });
  } catch(e) { res.status(500).json({ error: '保存失败' }); }
});

/* ========== 操作日志 API ========== */
app.get('/api/logs', requireAuth, requireManager, (req, res) => {
  try {
    let logs = merger.readLogs(req.org.logFile);
    const { user, module: mod, action, q, days } = req.query;
    if (user)   logs = logs.filter(l => l.user === user);
    if (mod)    logs = logs.filter(l => l.module === mod);
    if (action) logs = logs.filter(l => l.action === action);
    if (days)   { const from = Date.now() - Number(days) * 86400000; logs = logs.filter(l => l.at >= from); }
    if (q) {
      const lo = String(q).toLowerCase();
      logs = logs.filter(l => (l.target || '').toLowerCase().includes(lo) || (l.changes || []).join(' ').toLowerCase().includes(lo));
    }
    const total = logs.length;
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json({ total, logs: logs.slice(0, limit),
      users: [...new Set(merger.readLogs(req.org.logFile).map(l => l.user))].filter(Boolean),
      modules: [...new Set(merger.readLogs(req.org.logFile).map(l => l.module))].filter(Boolean) });
  } catch(e) { res.status(500).json({ error: '读取日志失败' }); }
});

/* ========== 备份 API ========== */
app.get('/api/backups', requireAuth, requireManager, (req, res) => {
  try {
    ensureBackupDir(req.org);
    const files = fs.readdirSync(req.org.backupDir)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort().reverse();
    res.json(files.map(f => ({
      filename: f,
      size: fs.statSync(path.join(req.org.backupDir, f)).size,
      date: f.replace('data-','').replace('.json',''),
    })));
  } catch(e) { res.status(500).json({ error: '读取备份列表失败' }); }
});

app.get('/api/backups/:filename', requireAuth, requireManager, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!/^data-\d{4}-\d{2}-\d{2}\.json$/.test(filename)) return res.status(400).json({ error: '备份文件名无效' });
    const filepath = path.join(req.org.backupDir, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '备份不存在' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(filepath));
  } catch(e) { res.status(500).json({ error: '下载失败' }); }
});

/* ========== 邮件配置 API ========== */
app.get('/api/email-config', requireAuth, requireManager, (req, res) => {
  const cfg = loadEmailCfg(req.org) || {};
  // 返回时隐藏密码（前端只显示是否已配置）
  res.json({ ...cfg, senderPass: cfg.senderPass ? '••••••••' : '' });
});

app.post('/api/email-config', requireAuth, requireManager, (req, res) => {
  try {
    const existing = loadEmailCfg(req.org) || {};
    const body = req.body;
    // 如果前端传回来的是掩码密码，保留原密码
    if (body.senderPass === '••••••••') body.senderPass = existing.senderPass || '';
    atomicJson(req.org.emailFile, body);
    // 重新启动定时任务
    scheduleDailyEmail(req.org);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: '保存配置失败' }); }
});

app.post('/api/email-test', requireAuth, requireManager, async (req, res) => {
  try {
    const cfg = loadEmailCfg(req.org);
    if (!cfg || !cfg.senderEmail) return res.status(400).json({ error: '请先配置邮件信息' });
    await sendBackupEmail(cfg, true, req.org);
    res.json({ ok: true });
  } catch(e) {
    console.error('测试邮件失败', e);
    res.status(500).json({ error: e.message });
  }
});

/* ========== 部署流程说明：点击即下载 ========== */
app.get('/download/deploy-guide', (req, res) => {
  res.download(path.join(STATIC_DIR, '部署流程说明.md'), '部署流程说明.md');
});

/* ========== SPA 兜底 ========== */
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
  if (process.env.NODE_ENV === 'test') console.log('TEST_LISTEN_PORT=' + server.address().port);
  console.log(`✅ 达人营销工作台运行在 http://localhost:${PORT}`);
  for (const org of organizations.list()) {
    try { scheduleDailyEmail(organizations.context(org.id)); }
    catch(e) { console.error('组织备份任务启动失败', org.id); }
  }
});
// 说明：域名 pinxuan.shiganneibu.com 由服务器上的 nginx 反向代理到本端口(3002)，
// 本服务只需监听 3002，不再抢占 80 端口(80 已由 nginx 占用)。
