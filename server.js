const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_FILE  = path.join(__dirname, 'db.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const STATIC_DIR = path.join(__dirname, 'extracted/media-workbench');
const MAX_BACKUPS = 7; // 最多保留7天

app.use(express.json({ limit: '20mb' }));
app.use(express.static(STATIC_DIR));

/* -------- 备份工具函数 -------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function createDailyBackup(data) {
  ensureBackupDir();
  const filename = `data-${todayStr()}.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  // 今天已经备份过就不重复创建
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    console.log(`📦 已创建每日备份: ${filename}`);
  }
  pruneOldBackups();
}

function pruneOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort(); // 升序，最旧的在前
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      toDelete.forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f));
        console.log(`🗑 已删除旧备份: ${f}`);
      });
    }
  } catch(e) { console.error('清理备份失败', e); }
}

/* -------- API -------- */

// 读取数据
app.get('/api/data', (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) return res.json({});
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (e) {
    console.error('读取数据失败', e);
    res.status(500).json({ error: '读取失败' });
  }
});

// 保存数据（每天首次保存时自动备份）
app.post('/api/data', (req, res) => {
  try {
    const body = req.body;
    // 先备份再写入
    createDailyBackup(body);
    fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    console.error('保存数据失败', e);
    res.status(500).json({ error: '保存失败' });
  }
});

// 列出所有备份
app.get('/api/backups', (req, res) => {
  try {
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('data-') && f.endsWith('.json'))
      .sort().reverse(); // 最新的在前
    const list = files.map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, date: f.replace('data-','').replace('.json','') };
    });
    res.json(list);
  } catch(e) {
    res.status(500).json({ error: '读取备份列表失败' });
  }
});

// 下载某个备份
app.get('/api/backups/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // 防路径穿越
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: '备份不存在' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(filepath));
  } catch(e) {
    res.status(500).json({ error: '下载失败' });
  }
});

// 所有其他路由返回首页（SPA）
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ 达人营销工作台运行在 http://localhost:${PORT}`);
  console.log(`📦 备份目录: ${BACKUP_DIR}`);
});
