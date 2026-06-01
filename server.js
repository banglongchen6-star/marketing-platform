const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_FILE = path.join(__dirname, 'db.json');
const STATIC_DIR = path.join(__dirname, 'extracted/media-workbench');

app.use(express.json({ limit: '20mb' }));
app.use(express.static(STATIC_DIR));

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

// 保存数据
app.post('/api/data', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    console.error('保存数据失败', e);
    res.status(500).json({ error: '保存失败' });
  }
});

// 所有其他路由返回首页（SPA）
app.get('*', (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ 达人营销工作台运行在 http://localhost:${PORT}`);
});
