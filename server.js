const express  = require('express');
const fs        = require('fs');
const path      = require('path');
const nodemailer = require('nodemailer');
const cron      = require('node-cron');

const app = express();
const PORT       = process.env.PORT || 3002;
const BUILD_ID   = Date.now(); // 进程启动时间，作为版本标识（pm2 restart 后变化 → 前端旧标签自动刷新）
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'mw-7f3a9c2e8b1d4f6a0e5c9b2d8a4f1e6c'; // 接口访问令牌（server.js 不对外暴露，登录后下发）
const DATA_FILE  = path.join(__dirname, 'db.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const EMAIL_CFG  = path.join(__dirname, 'email-config.json');
const STATIC_DIR = path.join(__dirname, 'extracted/media-workbench');
const MAX_BACKUPS = 7;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(STATIC_DIR));

/* ========== 备份工具 ========== */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
function createDailyBackup(data) {
  ensureBackupDir();
  // 防呆：空/残缺数据不写备份，避免覆盖掉当天已有的好备份
  if (!data || typeof data !== 'object') return;
  const hasContent = ['schedules', 'contents', 'kols', 'settlements', 'samples']
    .some(k => Array.isArray(data[k]) && data[k].length > 0);
  if (!hasContent) return;
  const filename = `data-${todayStr()}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  // 每次保存都更新当天备份，确保备份=当天最新完整状态
  // （原来只在当天第一次保存时备份，会把旧标签推上来的残缺数据固化成当天备份）
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  pruneOldBackups();
}
function pruneOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort();
    if (files.length > MAX_BACKUPS) {
      files.slice(0, files.length - MAX_BACKUPS).forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`🗑 已删除旧备份: ${f}`);
      });
    }
  } catch(e) { console.error('清理备份失败', e); }
}

/* ========== 邮件工具 ========== */
function loadEmailCfg() {
  try {
    if (fs.existsSync(EMAIL_CFG)) return JSON.parse(fs.readFileSync(EMAIL_CFG, 'utf8'));
  } catch(e) {}
  return null;
}

async function sendBackupEmail(cfg, isTest = false) {
  const { senderEmail, senderPass, recipients, smtpHost, smtpPort } = cfg;
  const transporter = nodemailer.createTransport({
    host: smtpHost || 'smtp.qiye.aliyun.com',
    port: Number(smtpPort) || 465,
    secure: true,
    auth: { user: senderEmail, pass: senderPass },
  });

  // 读取当前数据
  const data = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '{}';
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
function scheduleDailyEmail() {
  const cfg = loadEmailCfg();
  if (!cfg || !cfg.enabled) return;
  const [h, m] = (cfg.sendTime || '22:00').split(':');
  const cronExpr = `${m||0} ${h||22} * * *`;
  cron.schedule(cronExpr, async () => {
    const latestCfg = loadEmailCfg(); // 每次发送时重新读取最新配置
    if (!latestCfg || !latestCfg.enabled) return;
    try { await sendBackupEmail(latestCfg); }
    catch(e) { console.error('📧 邮件发送失败', e.message); }
  }, { timezone: 'Asia/Shanghai' });
  console.log(`📧 每日邮件备份已启动，发送时间: ${cfg.sendTime || '22:00'}`);
}

/* ========== 鉴权 ========== */
function readDbSafe() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { return {}; }
}
// 公开：登录身份下拉（只给名字，绝不含密码）
app.get('/api/login-options', (req, res) => {
  const d = readDbSafe();
  const opts = [{ value: 'admin', label: '👑 管理员' }];
  (d.bds || []).filter(b => b.is_active !== false && b.password).forEach(b =>
    opts.push({ value: 'bd__' + b.id, label: '👤 ' + b.name + '（商务BD）' }));
  (d.supervisors || []).filter(s => s.password).forEach(s =>
    opts.push({ value: 'sv__' + s.id, label: '🎯 ' + s.name + '（品宣主管）' }));
  res.json(opts);
});
// 公开：登录校验（密码在服务端比对），成功下发令牌
app.post('/api/login', (req, res) => {
  const { identity, password } = req.body || {};
  const d = readDbSafe();
  let user = null;
  if (identity === 'admin') {
    if (password === ADMIN_PASS) user = { identity:'admin', name:'管理员', role:'管理员', bd_id:null };
  } else if (identity && identity.indexOf('bd__') === 0) {
    const bd = (d.bds||[]).find(b => b.id === identity.slice(4));
    if (bd && bd.password && bd.password === password) user = { identity:'bd', name:bd.name, role:'商务BD', bd_id:bd.id };
  } else if (identity && identity.indexOf('sv__') === 0) {
    const sv = (d.supervisors||[]).find(s => s.id === identity.slice(4));
    if (sv && sv.password && sv.password === password) user = { identity:'supervisor', name:sv.name, role:'品宣主管', bd_id:sv.id, sv_id:sv.id };
  }
  if (!user) return res.status(401).json({ error: '账号或密码错误' });
  res.json({ token: AUTH_TOKEN, user });
});
// 中间件：受保护接口必须带正确令牌
function requireAuth(req, res, next) {
  const t = req.headers['x-auth-token'] || req.query.t || '';
  if (t !== AUTH_TOKEN) {
    return res.status(401).json({ error: '未授权，请重新登录' });
  }
  next();
}

/* ========== 数据 API ========== */
app.get('/api/data', requireAuth, (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) return res.json({ _build: BUILD_ID });
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data._build = BUILD_ID; // 附带版本标识（前端用于检测部署、自动刷新旧标签）
    res.json(data);
  } catch(e) { res.status(500).json({ error: '读取失败' }); }
});

const CORE_KEYS = ['schedules', 'contents', 'kols', 'settlements', 'samples', 'bds', 'supervisors'];
function hasCoreData(d) {
  return d && typeof d === 'object' && CORE_KEYS.some(k => Array.isArray(d[k]) && d[k].length > 0);
}
app.post('/api/data', requireAuth, (req, res) => {
  try {
    // 防清空：现有数据非空时，拒绝用空数据整体覆盖（防止空缓存浏览器误推）
    if (!hasCoreData(req.body) && hasCoreData(readDbSafe())) {
      console.warn('⛔ 拒绝空数据覆盖（防清空保护）');
      return res.status(409).json({ error: '拒绝保存：提交的数据为空，已保护服务器现有数据' });
    }
    createDailyBackup(req.body);
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: '保存失败' }); }
});

/* ========== 备份 API ========== */
app.get('/api/backups', requireAuth, (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort().reverse();
    res.json(files.map(f => ({
      filename: f,
      size: fs.statSync(path.join(BACKUP_DIR, f)).size,
      date: f.replace('data-','').replace('.json',''),
    })));
  } catch(e) { res.status(500).json({ error: '读取备份列表失败' }); }
});

app.get('/api/backups/:filename', requireAuth, (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '备份不存在' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(filepath));
  } catch(e) { res.status(500).json({ error: '下载失败' }); }
});

/* ========== 邮件配置 API ========== */
app.get('/api/email-config', requireAuth, (req, res) => {
  const cfg = loadEmailCfg() || {};
  // 返回时隐藏密码（前端只显示是否已配置）
  res.json({ ...cfg, senderPass: cfg.senderPass ? '••••••••' : '' });
});

app.post('/api/email-config', requireAuth, (req, res) => {
  try {
    const existing = loadEmailCfg() || {};
    const body = req.body;
    // 如果前端传回来的是掩码密码，保留原密码
    if (body.senderPass === '••••••••') body.senderPass = existing.senderPass || '';
    fs.writeFileSync(EMAIL_CFG, JSON.stringify(body, null, 2));
    // 重新启动定时任务
    scheduleDailyEmail();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: '保存配置失败' }); }
});

app.post('/api/email-test', requireAuth, async (req, res) => {
  try {
    const cfg = loadEmailCfg();
    if (!cfg || !cfg.senderEmail) return res.status(400).json({ error: '请先配置邮件信息' });
    await sendBackupEmail(cfg, true);
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

app.listen(PORT, () => {
  console.log(`✅ 达人营销工作台运行在 http://localhost:${PORT}`);
  scheduleDailyEmail(); // 启动时加载邮件定时任务
});
