/* 独立本地体验服务：保存和删除只影响 .local-preview/ 内的数据。 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, '.local-preview');
fs.mkdirSync(dataDir, { recursive:true });
const target = path.join(dataDir, 'db.json');
if (!fs.existsSync(target)) {
  const backupDir = path.join(root,'backups');
  const backups = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    : [];
  let seeded = false;
  for (const file of [...backups.map(f => path.join(backupDir,f)),path.join(root,'db.json')]) {
    try {
      const text = fs.readFileSync(file,'utf8');
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      fs.writeFileSync(target,text,{flag:'wx'});
      console.log('已建立本地数据副本，来源：'+path.basename(file));
      seeded = true;
      break;
    } catch(e) {
      if (e.code === 'EEXIST') { seeded = true; break; }
    }
  }
  if (!seeded) fs.writeFileSync(target,JSON.stringify({schedules:[],contents:[],kols:[],samples:[]}));
}
// 不复制邮件配置；本地启动不能向公司同事发送备份邮件。
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.PORT || '3056';
process.env.DATA_DIR = dataDir;
process.env.LOCAL_PREVIEW = '1';
require(path.join(root,'server.js'));
