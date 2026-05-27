# V11 Fix Script v2 - Binary-safe replacement for encoding issues
$filePath = 'D:\WorkBuddy\2026-05-08-task-5\media-workbench-v10\media-workbench\index.html'
$bytes = [System.IO.File]::ReadAllBytes($filePath)
Write-Host "File size: $($bytes.Length) bytes"

# Convert to UTF-8 string for regex operations
$text = [System.Text.Encoding]::UTF8.GetString($bytes)

# ===== Fix 1: Platform tags - replace the entire garbled block =====
Write-Host "Fixing platform tags..."

# Find the pattern from first <div class="platform-tags"> to the closing </div></div> before <!-- 发布信息 -->
# The garbled area starts after "发布平台 *" label
$platformNew = @'
          <div class="platform-tags">
            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="抖音" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>抖音</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="小红书" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>小红书</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B站" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>B站</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="微博" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>微博</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="快手" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>快手</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="视频号" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>视频号</span></label>
          </div>
'@

# Replace from first nested platform-tags div to just before the comment
# Pattern: everything between "发布平台" and the closing </div></div> before 发布信息
$pattern = '(<label class="form-label">.*?\*</label>\s*<div class="platform-tags">\s*<div class="platform-tags">).*?(</div>\s*</div>\s*<!-- 发布信息 -->)'
if ($text -match $pattern) {
    $text = $text.Substring(0, $text.IndexOf($Matches[1])) + "<label class=""form-label"">发布平台 *</label>`n$platformNew" + "`n        </div>" + "`n      </div>" + "`n      <!-- 发布信息 -->" + $text.Substring($text.IndexOf($Matches[2]) + $Matches[2].Length)
    Write-Host "  Platform tags replaced."
} else {
    Write-Host "  WARNING: Could not find platform tags pattern. Trying alternative..."
    # Alternative: find by line ranges
    $lines = $text -split "`n"
    # Find "发布平台" label
    $startLine = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'platform-tag.*checkbox.*douyin') { $startLine = $i; break }
    }
    if ($startLine -eq -1) {
        # Try to find the first <div class="platform-tags"> after the label
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '发布平台' -or $lines[$i] -match 'douyin') { $startLine = $i; break }
        }
    }
    Write-Host "  Found platform area at line: $startLine"
}

# ===== Fix 2: Remove duplicate s-topic and add s-type =====
Write-Host "Fixing schedule modal..."

# Find the second occurrence of s-topic input (the duplicate)
# Pattern: form-group > label "内容主题 *" > input id="s-topic" (second time)
# Replace with: form-row > form-group > select id="s-type" + form-group > s-status stays

$sTypeNew = @'
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">内容类型</label>
          <select class="form-control" id="s-type">
            <option value="视频">视频</option>
            <option value="图文">图文</option>
            <option value="直播">直播</option>
          </select>
        </div>
'@

# Find the duplicate: look for pattern of label + s-topic + /div that appears after the first s-topic
# The duplicate starts with "<div class="form-group">" followed by "内容主题" and "s-topic"
$sTopicPattern = '<div class="form-group">\s*<label class="form-label">\s*\S+\s*\*\s*</label>\s*<input class="form-control" id="s-topic"'
$matches2 = [regex]::Matches($text, $sTopicPattern)
Write-Host "  Found s-topic occurrences: $($matches2.Count)"
if ($matches2.Count -ge 2) {
    # Replace from the start of the second occurrence through to the closing </div>
    $secondStart = $matches2[1].Index
    # Find the closing </div> for this form-group
    $closeDiv = $text.IndexOf('</div>', $secondStart)
    $closeDiv2 = $text.IndexOf('</div>', $closeDiv + 6)
    # Replace this entire block
    $text = $text.Substring(0, $secondStart) + $sTypeNew + "`n        <div class=`"form-group`">" + $text.Substring($closeDiv2)
    Write-Host "  Duplicate s-topic removed and s-type added."
} else {
    Write-Host "  WARNING: Could not find duplicate s-topic."
}

# ===== Fix 3: getPlatforms push 微信 -> 视频号 =====
$text = $text -replace "cp-weixin'\)\.checked\) platforms\.push\('\u5FAE\u4FE1'\)", "cp-weixin').checked) platforms.push('视频号')"
$text = $text -replace "'\u5FAE\u4FE1':'cp-weixin'", "'视频号':'cp-weixin','微信':'cp-weixin'"

# ===== Fix 4: openScheduleModal + saveSchedule for s-type =====
$text = $text -replace "(getElementById\('s-status'\)\.value = s\.status \|\| '';)", "`$1`n    document.getElementById('s-type').value = s.type || '视频';"
$text = $text -replace "(getElementById\('s-date'\)\.value = new Date\(\)\.toISOString.*?;)", "`$1`n    document.getElementById('s-type').value = '视频';"
$text = $text -replace "(date, status:document\.getElementById\('s-status'\))", "date, type:document.getElementById('s-type').value, `$1"

# ===== Fix 5: Candidate modal - add date =====
# Insert after ca-name form-row closing div
$text = $text -replace "(<input class=`"form-control`" id=`"ca-name`"[^/]*/>\s*</div>\s*</div>)", "`$1`n      <div class=`"form-row`">`n        <div class=`"form-group`">`n          <label class=`"form-label`">记录日期</label>`n          <input type=`"date`" class=`"form-control`" id=`"ca-date`" />`n        </div>"

# Fix openCandidateModal
$text = $text -replace "(getElementById\('ca-name'\)\.value=c\.name;)", "`$1 document.getElementById('ca-date').value=c.date||'';"
$text = $text -replace "clearFields\('ca-name','ca-link'", "clearFields('ca-name','ca-date','ca-link"

# Fix saveCandidate
$text = $text -replace "(name, link:document\.getElementById\('ca-link'\))", "name, date:document.getElementById('ca-date').value, `$1"
$text = $text -replace "date:new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\], \.\.\.data", "...data"

# ===== Fix 6: Export - add settlement and materials =====
$text = $text -replace "(id=`"export-candidates`" checked /> 候选管理\s*</label>)", "`$1`n          <label style=`"display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer`">`n            <input type=`"checkbox`" id=`"export-settlement`" checked /> 达人结算`n          </label>`n          <label style=`"display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer`">`n            <input type=`"checkbox`" id=`"export-materials`" /> 素材管理`n          </label>"

# Add export variables
$text = $text -replace "(const exportCandidates=document\.getElementById\('export-candidates'\)\.checked;)", "`$1`n  const exportSettlement=document.getElementById('export-settlement').checked;`n  const exportMaterials=document.getElementById('export-materials').checked;"

# Fix candidate export header
$text = $text -replace "const rows=\[\['达人昵称'", "const rows=[['记录日期','达人昵称'"
$text = $text -replace "DB\.candidates\.forEach\(c=>rows\.push\(\[c\.name", "DB.candidates.forEach(c=>rows.push([c.date||'',c.name"

# Add settlement and materials export
$settleExport = @'

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
  }
'@
$text = $text -replace "(XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.aoa_to_sheet\(rows\), '候选管理'\);)", "`$1$settleExport"

# ===== Fix 7: Dashboard =====
# Add avgInteraction
$text = $text -replace "(const totalLikes = contents\.reduce.*?;)", "`$1`n  const avgInteraction = contents.length > 0 ? (contents.reduce((s,c) => s+(c.interaction||0), 0) / contents.length).toFixed(1) : '0.0';"

# Add more stat cards
$text = $text -replace "(label:'总花费',\s*value:fmtMoney\(totalPrice\),\s*icon:'💰',\s*cls:'orange' },)", "`$1`n    { label:'总点赞数',    value:fmtNum(totalLikes), icon:'👍', cls:'blue' },"
$text = $text -replace "(label:'CPM',\s*value:cpm,\s*icon:'📊',\s*cls:'purple' },)", "`$1`n    { label:'平均互动率',   value:avgInteraction+'%', icon:'💬', cls:'green' },"

# Grid 3 columns
$text = $text -replace 'grid-template-columns:repeat\(4,1fr\) !important', 'grid-template-columns:repeat(3,1fr) !important'

# Talent rank chart
$text = $text -replace '(<div class="charts-grid">.*?</div>\s*</div>)\s*(</div>\s*<!-- Schedule)', "`$1`n      <div class=`"card`" style=`"margin-top:16px`">`n        <div class=`"card-title`">🏆 达人合作排行 Top5（按播放量）</div>`n        <div class=`"chart-container`" style=`"height:280px`"><canvas id=`"talent-rank-chart`"></canvas></div>`n      </div>`n    </div>`n`n<!-- Schedule"

# talentRankChart variable
$text = $text -replace 'let trendChart, platformChart;', 'let trendChart, platformChart, talentRankChart;'

# Add render call
$text = $text -replace '(renderPlatformChart\(contents\);)', "`$1`n  renderTalentRankChart(contents);"

# Add renderTalentRankChart function
$rankFunc = @'

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
  if (!sorted.length) { talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:[], datasets:[] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y' } }); return; }
  talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:sorted.map(([n])=>n), datasets:[{ label:'总播放量', data:sorted.map(([,d])=>d.views), backgroundColor:['rgba(26,86,219,.8)','rgba(5,150,105,.8)','rgba(217,119,6,.8)','rgba(124,58,237,.8)','rgba(220,38,38,.8)'], borderRadius:6, barThickness:28 }] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{ legend:{display:false}, tooltip:{callbacks:{afterLabel:(ctx)=>sorted[ctx.dataIndex][1].count+'条内容'}} }, scales:{ x:{ticks:{color:'#9ca3af',font:{size:10},callback:v=>v>=10000?(v/10000).toFixed(0)+'万':v},grid:{color:'#e4e8ed'}}, y:{ticks:{color:'#374151',font:{size:12,weight:'500'}},grid:{display:false}} } } });
}
'@
$text = $text -replace '(/\* =+ Calendar =+ \*/)', "$rankFunc`n`$1"

# ===== Fix 8: Clean up =====
$text = $text -replace "alert\('TOPBAR按钮可以点击!'\);openSampleModal\(\)", 'openSampleModal()'
$text = $text -replace '\[测试\]', ''
$text = $text -replace "内部管理系统.*?刷新后标题.*?\[V10", '内部管理系统'
$text = $text -replace '\[V10-20260508\]', '[V11-20260508]'

# ===== Save =====
Write-Host "Saving..."
$newBytes = [System.Text.Encoding]::UTF8.GetBytes($text)
# Write without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllBytes($filePath, $utf8NoBom.GetBytes($text))
Write-Host "Done! New size: $($text.Length) chars"
