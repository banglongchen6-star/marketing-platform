// V11 Fix Script - Node.js version
const fs = require('fs');
const path = 'D:\\WorkBuddy\\2026-05-08-task-5\\media-workbench-v10\\media-workbench\\index.html';

let text = fs.readFileSync(path, 'utf-8');
console.log(`Read ${text.length} chars`);

// ===== 1. PLATFORM TAGS FIX =====
const pubMarker = '发布平台';
const pubInfo = '发布信息';
const pmIdx = text.indexOf(pubMarker);
const pubInfoIdx = text.indexOf(`<!-- ${pubInfo} -->`);

if (pmIdx > 0 && pubInfoIdx > pmIdx) {
  const labelEndTag = '</label>';
  const labelEndIdx = text.indexOf(labelEndTag, pmIdx) + labelEndTag.length;

  const correctPlatforms = [
    '            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="抖音" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>抖音</span></label>',
    '            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="小红书" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>小红书</span></label>',
    '            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B站" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>B站</span></label>',
    '            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="微博" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>微博</span></label>',
    '            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="快手" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>快手</span></label>',
    '            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="视频号" onchange="this.parentElement.classList.toggle(\'active\',this.checked)" /><span>视频号</span></label>',
  ].join('\n');

  const replacement = `${labelEndTag}\n          <div class="platform-tags">\n${correctPlatforms}\n          </div>\n        </div>\n      </div>\n      <!-- ${pubInfo} -->`;

  text = text.substring(0, labelEndIdx) + replacement + text.substring(pubInfoIdx + `<!-- ${pubInfo} -->`.length);
  console.log('1. Platform tags fixed');
}

// ===== 2. DUPLICATE S-TOPIC =====
const firstS = text.indexOf('id="s-topic"');
const secondS = text.indexOf('id="s-topic"', firstS + 1);
console.log(`  s-topic at: ${firstS}, ${secondS}`);

if (secondS > 0) {
  const dupFgStart = text.lastIndexOf('<div class="form-group">', 0, secondS);
  const inputEnd = text.indexOf('/>', secondS) + 2;
  const closeDiv1 = text.indexOf('</div>', inputEnd);
  const closeDiv2 = text.indexOf('</div>', closeDiv1 + 6);

  const sTypeBlock = `      <div class="form-row">\n        <div class="form-group">\n          <label class="form-label">内容类型</label>\n          <select class="form-control" id="s-type">\n            <option value="视频">视频</option>\n            <option value="图文">图文</option>\n            <option value="直播">直播</option>\n          </select>\n        </div>`;

  text = text.substring(0, dupFgStart) + sTypeBlock + text.substring(closeDiv2);
  console.log('2. Duplicate s-topic removed, s-type added');
}

// ===== 3. getPlatforms =====
text = text.replace("platforms.push('微信')", "platforms.push('视频号')");
text = text.replace("'微信':'cp-weixin'", "'视频号':'cp-weixin','微信':'cp-weixin'");
console.log('3. getPlatforms fixed');

// ===== 4. openScheduleModal + saveSchedule =====
text = text.replace(
  "getElementById('s-status').value = s.status || '';",
  "getElementById('s-status').value = s.status || '';\n    document.getElementById('s-type').value = s.type || '视频';"
);
text = text.replace(
  "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];",
  "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];\n    document.getElementById('s-type').value = '视频';"
);
text = text.replace(
  "date, status:document.getElementById('s-status')",
  "date, type:document.getElementById('s-type').value, status:document.getElementById('s-status')"
);
console.log('4. Schedule functions fixed');

// ===== 5. CANDIDATE MODAL - ADD DATE =====
const caNameIdx = text.indexOf('id="ca-name"');
// Find the end of ca-name's form-row: </div>\n      </div>
const caNameInputEnd = text.indexOf('/>', caNameIdx) + 2;
const afterCaNameInput = text.substring(caNameInputEnd, caNameInputEnd + 100);
const caNameRowEndIdx = text.indexOf('</div>\n      </div>', caNameInputEnd);

// Find ca-link form-row
const caLinkIdx = text.indexOf('id="ca-link"');
const caLinkRowStart = text.lastIndexOf('<div class="form-row">', 0, caLinkIdx);
const caLinkRowEnd = text.indexOf('</div>\n      </div>', caLinkIdx);

if (caNameIdx > 0 && caLinkIdx > 0 && caLinkRowStart > 0 && caLinkRowEnd > 0) {
  const caLinkRow = text.substring(caLinkRowStart, caLinkRowEnd + '</div>\n      </div>'.length);

  const dateBlock = `</div>\n      </div>\n      <div class="form-row">\n        <div class="form-group">\n          <label class="form-label">记录日期</label>\n          <input type="date" class="form-control" id="ca-date" />\n        </div>`;

  // Insert date + ca-link after ca-name row, then remove old ca-link row
  text = text.substring(0, caNameRowEndIdx + '</div>\n      </div>'.length) +
    dateBlock + '\n' + caLinkRow +
    text.substring(caLinkRowEnd + '</div>\n      </div>'.length);

  // Remove old ca-link row (now duplicated)
  const caLinkRowStart2 = text.indexOf(caLinkRow);
  if (caLinkRowStart2 > 0) {
    text = text.substring(0, caLinkRowStart2) + text.substring(caLinkRowStart2 + caLinkRow.length);
  }
  console.log('5. Candidate date field added');
}

// Fix openCandidateModal
text = text.replace(
  "getElementById('ca-name').value=c.name;",
  "getElementById('ca-name').value=c.name; document.getElementById('ca-date').value=c.date||'';"
);
text = text.replace("clearFields('ca-name','ca-link'", "clearFields('ca-name','ca-date','ca-link");
text = text.replace(
  "name, link:document.getElementById('ca-link')",
  "name, date:document.getElementById('ca-date').value, link:document.getElementById('ca-link')"
);
text = text.replace("date:new Date().toISOString().split('T')[0], ...data", "...data");
console.log('6. Candidate functions fixed');

// ===== 6. EXPORT ADDITIONS =====
text = text.replace(
  'id="export-candidates" checked /> 候选管理\n          </label>',
  'id="export-candidates" checked /> 候选管理\n          </label>\n          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">\n            <input type="checkbox" id="export-settlement" checked /> 达人结算\n          </label>\n          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">\n            <input type="checkbox" id="export-materials" /> 素材管理\n          </label>'
);

text = text.replace(
  "const exportCandidates=document.getElementById('export-candidates').checked;",
  "const exportCandidates=document.getElementById('export-candidates').checked;\n  const exportSettlement=document.getElementById('export-settlement').checked;\n  const exportMaterials=document.getElementById('export-materials').checked;"
);

text = text.replace("const rows=[['达人昵称'", "const rows=[['记录日期','达人昵称'");
text = text.replace("DB.candidates.forEach(c=>rows.push([c.name", "DB.candidates.forEach(c=>rows.push([c.date||'',c.name");

const settleBlock = `
  if(exportSettlement){
    const sList=DB.settlements.filter(c=>{
      if(startDate&&c.payDate&&c.payDate<startDate) return false;
      if(endDate&&c.payDate&&c.payDate>endDate) return false;
      return true;
    });
    const sRows=[['达人','结算周期','金额','状态','付款日期','发票状态','备注']];
    sList.forEach(s=>sRows.push([s.talent,s.period,s.amount||0,s.status,s.payDate||'',s.invoice||'',s.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sRows), '达人结算');
  }
  if(exportMaterials){
    const mRows=[['达人','类型','主题','发布时间','素材链接','审核状态','备注']];
    DB.materials.forEach(m=>mRows.push([m.talent,m.type||'',m.topic||'',m.date||'',m.link||'',m.review||'',m.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mRows), '素材管理');
  }`;

text = text.replace(
  "XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '候选管理');",
  "XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '候选管理');" + settleBlock
);
console.log('7. Export additions done');

// ===== 7. DASHBOARD =====
text = text.replace(
  "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);",
  "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);\n  const avgInteraction = contents.length > 0 ? (contents.reduce((s,c) => s+(c.interaction||0), 0) / contents.length).toFixed(1) : '0.0';"
);

text = text.replace(
  "{ label:'总花费',     value:fmtMoney(totalPrice), icon:'💰', cls:'orange' },",
  "{ label:'总花费',     value:fmtMoney(totalPrice), icon:'💰', cls:'orange' },\n    { label:'总点赞数',    value:fmtNum(totalLikes), icon:'👍', cls:'blue' },"
);
text = text.replace(
  "{ label:'CPM',        value:cpm, icon:'📊', cls:'purple' },",
  "{ label:'CPM',        value:cpm, icon:'📊', cls:'purple' },\n    { label:'平均互动率',   value:avgInteraction+'%', icon:'💬', cls:'green' },"
);

text = text.replace('grid-template-columns:repeat(4,1fr) !important', 'grid-template-columns:repeat(3,1fr) !important');

// Talent rank chart HTML
text = text.replace(
  '</div>\n      </div>\n    </div>\n\n    <!-- Schedule',
  '</div>\n      </div>\n      <div class="card" style="margin-top:16px">\n        <div class="card-title">🏆 达人合作排行 Top5（按播放量）</div>\n        <div class="chart-container" style="height:280px"><canvas id="talent-rank-chart"></canvas></div>\n      </div>\n    </div>\n\n    <!-- Schedule'
);

text = text.replace('let trendChart, platformChart;', 'let trendChart, platformChart, talentRankChart;');
text = text.replace('renderPlatformChart(contents);', 'renderPlatformChart(contents);\n  renderTalentRankChart(contents);');

const rankFunc = `function renderTalentRankChart(contents) {
  const ctx = document.getElementById('talent-rank-chart').getContext('2d');
  if (talentRankChart) talentRankChart.destroy();
  const talentMap = {};
  contents.forEach(c => {
    if (!c.talent) return;
    if (!talentMap[c.talent]) talentMap[c.talent] = { views: 0, count: 0 };
    talentMap[c.talent].views += (c.views || 0);
    talentMap[c.talent].count += 1;
  });
  const sorted = Object.entries(talentMap).sort((a, b) => b[1].views - a[1].views).slice(0, 5);
  if (!sorted.length) { talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:[], datasets:[] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y' } }); return; }
  talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:sorted.map(([n])=>n), datasets:[{ label:'总播放量', data:sorted.map(([,d])=>d.views), backgroundColor:['rgba(26,86,219,.8)','rgba(5,150,105,.8)','rgba(217,119,6,.8)','rgba(124,58,237,.8)','rgba(220,38,38,.8)'], borderRadius:6, barThickness:28 }] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{ legend:{display:false}, tooltip:{callbacks:{afterLabel:(ctx)=>sorted[ctx.dataIndex][1].count+'条内容'}} }, scales:{ x:{ticks:{color:'#9ca3af',font:{size:10},callback:v=>v>=10000?(v/10000).toFixed(0)+'万':v},grid:{color:'#e4e8ed'}}, y:{ticks:{color:'#374151',font:{size:12,weight:'500'}},grid:{display:false}} } } });
}`;

text = text.replace('/* ==================== Calendar ==================== */', rankFunc + '\n/* ==================== Calendar ==================== */');
console.log('8. Dashboard improved');

// ===== 8. CLEAN UP =====
text = text.replace(/<button class="btn btn-primary btn-sm" onclick="alert\([^"]*\)[^"]*">[^<]*<\/button>/g, '');
text = text.replace('[测试]', '');
text = text.replace('[V10-20260508]', '[V11-20260508]');

// Clean login subtitle
const subIdx = text.indexOf('内部管理系统');
if (subIdx > 0) {
  const subDivEnd = text.indexOf('</div>', subIdx);
  const subLine = text.substring(subIdx, subDivEnd).trim();
  if (subLine.length > 6) {
    text = text.substring(0, subIdx) + '内部管理系统' + text.substring(subDivEnd);
  }
}
console.log('9. Cleaned up');

// ===== SAVE =====
fs.writeFileSync(path, text, 'utf-8');
console.log(`\nDone! Saved ${text.length} chars`);
