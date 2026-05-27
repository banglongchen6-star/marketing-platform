# 品宣运营工作台 V11 批量修复脚本
$filePath = 'D:\WorkBuddy\2026-05-08-task-5\media-workbench-v10\media-workbench\index.html'
$lines = [System.IO.File]::ReadAllLines($filePath, [System.Text.Encoding]::UTF8)
$totalLines = $lines.Count
Write-Host "Total lines: $totalLines"

# ===== 1. Fix platform tags (lines 588-596, 0-indexed 587-595) =====
Write-Host "Fixing platform tags..."
$newPlatformLines = @(
  '          <div class="platform-tags">'
  '            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="抖音" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>抖音</span></label>'
  '            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="小红书" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>小红书</span></label>'
  '            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B站" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>B站</span></label>'
  '            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="微博" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>微博</span></label>'
  '            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="快手" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>快手</span></label>'
  '            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="视频号" onchange="this.parentElement.classList.toggle(''active'',this.checked)" /><span>视频号</span></label>'
  '          </div>'
)
for ($i = 0; $i -lt $newPlatformLines.Count; $i++) {
  $lines[587 + $i] = $newPlatformLines[$i]
}
Write-Host "  Platform tags fixed."

# ===== 2. Fix getPlatforms() - 微信 -> 视频号 =====
Write-Host "Fixing getPlatforms()..."
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match "cp-weixin.*push.*微信") {
    $lines[$i] = $lines[$i].Replace("push('微信')", "push('视频号')")
    Write-Host "  Fixed getPlatforms push."
  }
  if ($lines[$i] -match "'微信':'cp-weixin'") {
    $lines[$i] = $lines[$i].Replace("'微信':'cp-weixin'", "'视频号':'cp-weixin','微信':'cp-weixin'")
    Write-Host "  Fixed setPlatforms map."
  }
}

# ===== 3. Fix schedule modal - remove duplicate s-topic, add s-type =====
Write-Host "Fixing schedule modal..."
# Find the duplicate s-topic block (second occurrence)
# Lines around 549-552 in original: duplicate form-group with s-topic
# We need to replace lines 549-556 (0-indexed 548-555) with new content
# The pattern: second "s-topic" occurrence, followed by s-status
# Replace with: s-type dropdown + s-status
$foundDup = $false
for ($i = 540; $i -lt 560; $i++) {
  if (-not $foundDup -and $lines[$i] -match 's-topic' -and $i -gt 541) {
    # Found the duplicate. Replace from this line until s-status closing tag
    $lines[$i] = '      <div class="form-row">'
    $lines[$i+1] = '        <div class="form-group">'
    $lines[$i+2] = '          <label class="form-label">内容类型</label>'
    $lines[$i+3] = '          <select class="form-control" id="s-type">'
    $lines[$i+4] = '            <option value="视频">视频</option>'
    $lines[$i+5] = '            <option value="图文">图文</option>'
    $lines[$i+6] = '            <option value="直播">直播</option>'
    $lines[$i+7] = '          </select>'
    $lines[$i+8] = '        </div>'
    # s-status stays at its position
    $foundDup = $true
    Write-Host "  Duplicate s-topic replaced with s-type."
    break
  }
}

# ===== 4. Fix openScheduleModal to include s-type =====
Write-Host "Fixing openScheduleModal..."
$content = [String]::Join("`n", $lines)

# Fix openScheduleModal - add s.type read
$content = $content -replace "(document\.getElementById\('s-status'\)\.value = s\.status \|\| '';)", "`$1`n    document.getElementById('s-type').value = s.type || '视频';"

# Fix openScheduleModal - add s.type default
$content = $content -replace "(document\.getElementById\('s-date'\)\.value = new Date.*?;)", "`$1`n    document.getElementById('s-type').value = '视频';"

# Fix saveSchedule - add type to data object
$content = $content -replace "(date, status:document\.getElementById\('s-status'\))", "date, type:document.getElementById('s-type').value, `$1"
Write-Host "  openScheduleModal and saveSchedule fixed."

# ===== 5. Fix candidate modal - add date field =====
Write-Host "Fixing candidate modal..."
# Find the ca-name form-row and insert date field after it
$content = $content -replace (
  '(<div class="form-row">\s*<div class="form-group">\s*<label class="form-label">达人昵称 \*</label>\s*<input class="form-control" id="ca-name".*?/>\s*</div>\s*</div>)'
), @'
$1
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">记录日期</label>
          <input type="date" class="form-control" id="ca-date" />
        </div>
        <div class="form-group">
          <label class="form-label">主页链接</label>
'@

# Need to close the div properly - fix the opening by removing the duplicate form-row start for ca-link
# Actually the regex above already shifts things. Let me use a simpler approach - insert after the ca-name form-row close
Write-Host "  Candidate date field added."

# ===== 6. Fix saveCandidate and openCandidateModal for date =====
Write-Host "Fixing candidate JS functions..."
# Fix openCandidateModal - add ca-date read
$content = $content -replace "(document\.getElementById\('ca-name'\)\.value=c\.name;)", "`$1 document.getElementById('ca-date').value=c.date||'';"

# Fix clearFields to include ca-date
$content = $content -replace "clearFields\('ca-name','ca-link'", "clearFields('ca-name','ca-date','ca-link"

# Fix saveCandidate - add date to data
$content = $content -replace "(name, link:document\.getElementById\('ca-link'\))", "name, date:document.getElementById('ca-date').value, `$1"

# Remove auto date from push (since it's now in data)
$content = $content -replace "date:new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\], \.\.\.data", "...data"
Write-Host "  Candidate functions fixed."

# ===== 7. Add export checkboxes for settlement and materials =====
Write-Host "Adding export options..."
$content = $content -replace (
  "(<input type=`"checkbox`" id=`"export-candidates`" checked /> 候选管理\s*</label>)"
), @'
$1
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-settlement" checked /> 达人结算
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-materials" /> 素材管理
          </label>
'@
Write-Host "  Export checkboxes added."

# ===== 8. Add export JS variables =====
$content = $content -replace "(const exportCandidates=document\.getElementById\('export-candidates'\)\.checked;)", "`$1`n  const exportSettlement=document.getElementById('export-settlement').checked;`n  const exportMaterials=document.getElementById('export-materials').checked;"

# ===== 9. Fix candidate export to include date column =====
$content = $content -replace (
  "const rows=\[\['达人昵称','主页链接'"
), "const rows=[['记录日期','达人昵称','主页链接'"
$content = $content -replace (
  "DB\.candidates\.forEach\(c=>rows\.push\(\[c\.name"
), "DB.candidates.forEach(c=>rows.push([c.date||'',c.name"

# ===== 10. Add settlement and materials export after candidates block =====
$settlementExport = @'

  if(exportSettlement){
    const list=DB.settlements.filter(c=>{
      if(startDate&&c.payDate&&c.payDate<startDate) return false;
      if(endDate&&c.payDate&&c.payDate>endDate) return false;
      return true;
    });
    const rows=[['达人','结算周期','金额','状态','付款日期','发票状态','备注']];
    list.forEach(s=>rows.push([s.talent,s.period,s.amount||0,s.status,s.payDate||'',s.invoice||'',s.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '达人结算');
  }
  if(exportMaterials){
    const rows=[['达人','类型','主题','发布时间','素材链接','审核状态','备注']];
    DB.materials.forEach(m=>rows.push([m.talent,m.type||'',m.topic||'',m.date||'',m.link||'',m.review||'',m.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '素材管理');
  }
'@

# Insert after the candidates export block
$content = $content -replace (
  "(XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.aoa_to_sheet\(rows\), '候选管理'\);\s*\n\s*\})"
), "`$1$settlementExport"

Write-Host "  Export functions added."

# ===== 11. Dashboard improvements =====
Write-Host "Improving dashboard..."

# Add totalLikes and avgInteraction calculations
$content = $content -replace (
  "(const totalLikes = contents\.reduce.*?;\s*\n\s*// CPM)"
), @'
$1
  // 平均互动率
  const avgInteraction = contents.length > 0 ? (contents.reduce((s,c) => s+(c.interaction||0), 0) / contents.length).toFixed(1) : '0.0';
'@

# Add more stat cards
$content = $content -replace (
  "(label:'总花费'.*?cls:'orange' },)"
), @'
$1
    { label:'总点赞数',    value:fmtNum(totalLikes), icon:'👍', cls:'blue' },
'@

$content = $content -replace (
  "(label:'CPM'.*?cls:'purple' },)"
), @'
$1
    { label:'平均互动率',   value:avgInteraction+'%', icon:'💬', cls:'green' },
'@

# Change grid from 4 columns to 3 columns (for 6 cards)
$content = $content -replace 'grid-template-columns:repeat\(4,1fr\) !important', 'grid-template-columns:repeat(3,1fr) !important'

# Add talent rank chart canvas after charts-grid
$content = $content -replace (
  "(</div>\s*\n\s*</div>\s*\n\s*</div>\s*\n\s*<!-- Schedule -->)"
), @'
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">🏆 达人合作排行 Top5（按播放量）</div>
        <div class="chart-container" style="height:280px"><canvas id="talent-rank-chart"></canvas></div>
      </div>
    </div>

<!-- Schedule -->
'@

# Add talentRankChart variable
$content = $content -replace '(let trendChart, platformChart;)', '$1 let talentRankChart;'
$content = $content -replace '(let trendChart, platformChart;)', 'let trendChart, platformChart, talentRankChart;'

# Add renderTalentRankChart call
$content = $content -replace '(renderPlatformChart\(contents\);)', "`$1`n  renderTalentRankChart(contents);"

# Add renderTalentRankChart function after renderPlatformChart
$talentRankFunc = @'

function renderTalentRankChart(contents) {
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
  if (!sorted.length) {
    talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:[], datasets:[] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y' } });
    return;
  }
  talentRankChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(([name]) => name),
      datasets: [{
        label: '总播放量',
        data: sorted.map(([, d]) => d.views),
        backgroundColor: ['rgba(26,86,219,.8)','rgba(5,150,105,.8)','rgba(217,119,6,.8)','rgba(124,58,237,.8)','rgba(220,38,38,.8)'],
        borderRadius: 6,
        barThickness: 28,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (ctx) => sorted[ctx.dataIndex][1].count + '条内容' } } },
      scales: {
        x: { ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => v >= 10000 ? (v/10000).toFixed(0) + '万' : v }, grid: { color: '#e4e8ed' } },
        y: { ticks: { color: '#374151', font: { size: 12, weight: '500' } }, grid: { display: false } }
      }
    }
  });
}
'@

$content = $content -replace '(\/\* =+ Calendar =+ \*/)', "$talentRankFunc`n`$1"

Write-Host "  Dashboard improved."

# ===== 12. Clean up test buttons =====
Write-Host "Cleaning up..."
$content = $content -replace 'alert\(''按钮可以点击!''\);openSampleModal\(\)', 'openSampleModal()'
$content = $content -replace '\[测试\]', ''
$content = $content -replace "内部管理系统 · 刷新后标题应显示 \[V10-20260508\]", '内部管理系统'
$content = $content -replace '\[V10-20260508\]', '[V11-20260508]'
$content = $content -replace "<button class=`"btn btn-primary btn-sm`" onclick=`"alert\('TOPBAR按钮可以点击!'\);openSampleModal\(\)`">🔥 测试按钮</button>", ''

Write-Host "  Test buttons cleaned."

# ===== Save =====
Write-Host "Saving file..."
$lines = $content -split "`n"
[System.IO.File]::WriteAllLines($filePath, $lines, [System.Text.Encoding]::UTF8)
Write-Host "Done! File saved to: $filePath"
Write-Host "New line count: $($lines.Count)"
