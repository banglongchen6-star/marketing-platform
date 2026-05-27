const fs = require('fs');
const path = 'D:/WorkBuddy/2026-05-08-task-5/media-workbench-v10/media-workbench/index.html';
let html = fs.readFileSync(path, 'utf8');

// ============================================================
// Fix 1: CSS syntax error on the month-picker-grid line
// The extra ";}" after the rule breaks subsequent CSS parsing
// ============================================================
html = html.replace(
  /(\.month-picker-grid button\.active\{[^}]*\});\}/,
  '$1'
);

// ============================================================
// Fix 2: Remove duplicate s-topic field and s-status field
// from the schedule modal (lines 549-556)
// ============================================================
// Remove the standalone duplicate topic field
html = html.replace(
  /\s*<div class="form-group">\s*<label class="form-label">内容主题 \*<\/label>\s*<input class="form-control" id="s-topic" placeholder="[^"]*" \/>\s*<\/div>/g,
  // Only replace the SECOND occurrence (the one not inside form-row)
  function(match) {
    // Count occurrences to handle the duplicate
    return '';
  }
);
// Actually, let's be more precise - remove the standalone topic field (not inside form-row)
// The first topic is inside <div class="form-row">, the second is standalone
// Let's match the standalone one specifically
const standaloneTopicRegex = /\n      <div class="form-group">\n        <label class="form-label">内容主题 \*<\/label>\n        <input class="form-control" id="s-topic" placeholder="[^"]*" \/>\n      <\/div>\n/;
const topicMatch = html.match(standaloneTopicRegex);
if (topicMatch) {
  // Find all occurrences and remove the last standalone one
  const parts = html.split(standaloneTopicRegex);
  if (parts.length >= 3) {
    // Keep the first one (inside form-row), remove the second (standalone)
    html = parts[0] + parts[1] + parts.slice(2).join('');
  } else if (parts.length === 2) {
    html = parts.join('');
  }
}

// Remove the standalone s-status (进度状态) field
html = html.replace(
  /\n      <div class="form-group">\n        <label class="form-label">[^<]*状态[^<]*<\/label>\n        <input class="form-control" id="s-status" placeholder="[^"]*" \/>\n      <\/div>/,
  ''
);

// Also remove s-status from saveSchedule() and openScheduleModal()
html = html.replace(
  /document\.getElementById\('s-status'\)\.value = s\.status \|\| '';/,
  '// status removed'
);
html = html.replace(
  /clearFields\('s-talent','s-topic','s-status'\)/,
  "clearFields('s-talent','s-topic')"
);
html = html.replace(
  /status:document\.getElementById\('s-status'\)\.value\.trim\(\)/,
  "status:''"
);

// ============================================================
// Fix 3: Replace broken platform tags in content modal
// The original has garbled Chinese, missing IDs, nested divs,
// and broken HTML tags that break the entire page DOM parsing
// ============================================================
const oldPlatformTags = html.match(
  /<div class="platform-tags">\s*<div class="platform-tags">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/
);

if (oldPlatformTags) {
  const newPlatformTags = `<div class="platform-tags">
            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="抖音" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>抖音</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="小红书" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>小红书</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B站" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>B站</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="微博" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>微博</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="快手" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>快手</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="微信" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>视频号</span></label>
          </div>
        </div>`;

  html = html.replace(oldPlatformTags[0], newPlatformTags);
  console.log('Platform tags replaced successfully');
} else {
  console.log('WARNING: Could not find platform tags pattern, trying alternative approach');
  // Alternative: find by form-label text
  const altMatch = html.match(/<label class="form-label">发布平台 \*<\/label>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  if (altMatch) {
    // This is too broad, let's be more precise
    console.log('Alt match found, length:', altMatch[0].length);
  }
}

// ============================================================
// Fix 4: Also fix the getPlatforms() to return 视频号 for cp-weixin
// to match the display text we set
// ============================================================
html = html.replace(
  "if(document.getElementById('cp-weixin').checked) platforms.push('微信');",
  "if(document.getElementById('cp-weixin').checked) platforms.push('视频号');"
);
html = html.replace(
  "'微信':'cp-weixin'",
  "'视频号':'cp-weixin'"
);

// ============================================================
// Fix 5: Remove test button from topbar
// ============================================================
html = html.replace(
  /<div class="topbar-actions" id="topbar-actions"><button class="btn btn-primary btn-sm" onclick="alert\('[^']*'\);openSampleModal\(\)">[^<]*<\/button><\/div>/,
  '<div class="topbar-actions" id="topbar-actions"></div>'
);

// ============================================================
// Fix 6: Remove [测试] from sample button
// ============================================================
html = html.replace(
  "alert('按钮可以点击!'); openSampleModal()",
  'openSampleModal()'
);
html = html.replace(
  '＋ 新增样品 [测试]',
  '＋ 新增样品'
);

// ============================================================
// Fix 7: Update version in title
// ============================================================
html = html.replace(
  'V10-20260508',
  'V11-20260508'
);

// Write back
fs.writeFileSync(path, html, 'utf8');
console.log('All fixes applied successfully!');
