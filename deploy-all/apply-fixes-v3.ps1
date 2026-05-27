# V11 Final Fix - Pure PowerShell (no external exe)
$filePath = 'D:\WorkBuddy\2026-05-08-task-5\media-workbench-v10\media-workbench\index.html'

# Read file as bytes, convert to string
$bytes = [System.IO.File]::ReadAllBytes($filePath)
# Detect and skip BOM if present
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
}
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
Write-Host "Read $($text.Length) chars"

# We'll work with the file as a whole string using .Replace()
# Since the garbled characters are from wrong encoding, we need to find them by context

# Strategy: Replace entire known sections by their surrounding clean text markers

# ===== 1. PLATFORM TAGS FIX =====
# Find the first platform-tag checkbox (douyin - which is correct) to locate the area
# Then replace everything from that point to the closing </div></div></div> before the comment
$correctPlatforms = @"
            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="抖音" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>抖音</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="小红书" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>小红书</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B站" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>B站</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="微博" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>微博</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="快手" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>快手</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="视频号" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>视频号</span></label>
"@

# The platform tags area starts with "id="cp-douyin"" (correct) and ends before the closing divs
# Replace from id="cp-douyin" to the last </div> before <!-- comment
$platformStart = $text.IndexOf('id="cp-douyin"')
$pubInfoComment = $text.IndexOf('<!-- $([char]0x53D8)$([char]0x5E03)$([char]0x4FE1)$([char]0x606F) -->')  # 发布信息

# Find the first line with cp-douyin - this is the correctly encoded line
$firstPlatformLine = $text.IndexOf('value="$([char]0x6296)$([char]0x97F3)"', $platformStart)
# Actually the first platform tag already has correct value
# The problem is lines after it

# Let me find the start of the first <div class="platform-tags"> that contains garbled text
# The first div.platform-tags contains the correctly encoded 抖音, the second div.platform-tags is nested and contains garbled text
# We need to remove the second <div class="platform-tags"> opening, fix all garbled labels, and remove the extra closing </div>

# Simpler approach: replace the entire inner content of the form-group
# Find the form-group that contains the platform tags
$platformMarker = [char]0x53D8 + [char]0x5E03 + [char]0x5E73 + [char]0x53F0  # 发布平台
$pmIdx = $text.IndexOf($platformMarker)
$pubInfo = [char]0x53D8 + [char]0x5E03 + [char]0x4FE1 + [char]0x606F  # 发布信息
$pubInfoIdx = $text.IndexOf("<!-- $pubInfo -->")

# Replace from just after "发布平台" label to just before the comment
# Find the end of the label tag
$labelEndTag = '</label>'
$labelEndIdx = $text.IndexOf($labelEndTag, $pmIdx) + $labelEndTag.Length

# Now find the closing structure: three </div> before the comment
# We want to keep the outermost form-group </div>
# The structure is: label > div.platform-tags > div.platform-tags > labels... > /div > /div > /div(form-group)
# Replace from labelEnd to pubInfoIdx

$replacement = @"
$labelEndTag
          <div class="platform-tags">
$correctPlatforms
          </div>
        </div>
      </div>
      <!-- $pubInfo -->
"@

$text = $text.Substring(0, $labelEndIdx) + $replacement + $text.Substring($pubInfoIdx + "<!-- $pubInfo -->".Length)
Write-Host "1. Platform tags fixed"

# ===== 2. DUPLICATE S-TOPIC + ADD S-TYPE =====
# Find second occurrence of id="s-topic"
$firstStopic = $text.IndexOf('id="s-topic"')
$secondStopic = $text.IndexOf('id="s-topic"', $firstStopic + 1)
Write-Host "  s-topic at: $firstStopic, $secondStopic"

if ($secondStopic -gt 0) {
    # Find the <div class="form-group"> that contains the second s-topic
    $dupFgStart = $text.LastIndexOf('<div class="form-group">', 0, $secondStopic)
    # Find closing </div> after s-topic input
    $inputEnd = $text.IndexOf('/>', $secondStopic) + 2
    $closeDiv1 = $text.IndexOf('</div>', $inputEnd)
    $closeDiv2 = $text.IndexOf('</div>', $closeDiv1 + 6)

    $sTypeBlock = @"
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">内容类型</label>
          <select class="form-control" id="s-type">
            <option value="视频">视频</option>
            <option value="图文">图文</option>
            <option value="直播">直播</option>
          </select>
        </div>
"@

    $text = $text.Substring(0, $dupFgStart) + $sTypeBlock + $text.Substring($closeDiv2)
    Write-Host "2. Duplicate s-topic removed, s-type added"
}

# ===== 3. FIX getPlatforms =====
$text = $text.Replace("platforms.push('微信')", "platforms.push('视频号')")
# Add 微信 mapping for backward compat
$oldMap = "'微信':'cp-weixin'"
$newMap = "'视频号':'cp-weixin','微信':'cp-weixin'"
$text = $text.Replace($oldMap, $newMap)
Write-Host "3. getPlatforms fixed"

# ===== 4. FIX openScheduleModal + saveSchedule =====
$text = $text.Replace(
    "getElementById('s-status').value = s.status || '';",
    "getElementById('s-status').value = s.status || '';`n    document.getElementById('s-type').value = s.type || '视频';"
)
$text = $text.Replace(
    "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];",
    "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];`n    document.getElementById('s-type').value = '视频';"
)
$text = $text.Replace(
    "date, status:document.getElementById('s-status')",
    "date, type:document.getElementById('s-type').value, status:document.getElementById('s-status')"
)
Write-Host "4. Schedule functions fixed"

# ===== 5. CANDIDATE MODAL - ADD DATE =====
# Find ca-name input, then the closing of its form-row
$caNameIdx = $text.IndexOf('id="ca-name"')
$caNameRowEnd = $text.IndexOf('</div>' + "`n" + '      </div>', $caNameIdx)
if ($caNameRowEnd -lt 0) { $caNameRowEnd = $text.IndexOf("</div>`n      </div>", $caNameIdx) }
if ($caNameRowEnd -lt 0) { $caNameRowEnd = $text.IndexOf('</div>', $text.IndexOf('/>', $caNameIdx)) + 6 }

$caDateBlock = @"
</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">记录日期</label>
          <input type="date" class="form-control" id="ca-date" />
        </div>
"@

# Find the ca-link form-row to remove it (we'll re-add it above with date)
$caLinkIdx = $text.IndexOf('id="ca-link"')
$caLinkRowStart = $text.LastIndexOf('<div class="form-row">', 0, $caLinkIdx)
$caLinkRowEnd = $text.IndexOf('</div>' + "`n" + '      </div>', $caLinkIdx)
if ($caLinkRowEnd -lt 0) { $caLinkRowEnd = $text.IndexOf("</div>`n      </div>", $caLinkIdx) }
if ($caLinkRowEnd -lt 0) { $caLinkRowEnd = $text.IndexOf('</div>', $text.IndexOf('/>', $caLinkIdx)) + 6 }

# Get the ca-link form-row content
$caLinkRow = $text.Substring($caLinkRowStart, $caLinkRowEnd - $caLinkRowStart + 6)

# Insert date + ca-link row after ca-name row end, remove old ca-link row
$text = $text.Substring(0, $caNameRowEnd) + $caDateBlock + "`n" + $caLinkRow + $text.Substring($caLinkRowEnd + 6)
# Remove the old ca-link row that's now duplicated
$text = $text.Substring(0, $caLinkRowStart) + $text.Substring($caLinkRowEnd + 6)

Write-Host "5. Candidate date field added"

# Fix openCandidateModal
$text = $text.Replace(
    "getElementById('ca-name').value=c.name;",
    "getElementById('ca-name').value=c.name; document.getElementById('ca-date').value=c.date||'';"
)
$text = $text.Replace("clearFields('ca-name','ca-link'", "clearFields('ca-name','ca-date','ca-link")
$text = $text.Replace(
    "name, link:document.getElementById('ca-link')",
    "name, date:document.getElementById('ca-date').value, link:document.getElementById('ca-link')"
)
$text = $text.Replace("date:new Date().toISOString().split('T')[0], ...data", "...data")
Write-Host "6. Candidate functions fixed"

# ===== 6. EXPORT ADDITIONS =====
# Add checkboxes
$candCheckEnd = 'id="export-candidates" checked /> 候选管理' + "`n" + '          </label>'
$text = $text.Replace(
    $candCheckEnd,
    $candCheckEnd + "`n" + @'
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-settlement" checked /> 达人结算
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-materials" /> 素材管理
          </label>
'@
)

# Add export variables
$text = $text.Replace(
    "const exportCandidates=document.getElementById('export-candidates').checked;",
    "const exportCandidates=document.getElementById('export-candidates').checked;`n  const exportSettlement=document.getElementById('export-settlement').checked;`n  const exportMaterials=document.getElementById('export-materials').checked;"
)

# Fix candidate export header
$text = $text.Replace("const rows=[['达人昵称'", "const rows=[['记录日期','达人昵称'")
$text = $text.Replace("DB.candidates.forEach(c=>rows.push([c.name", "DB.candidates.forEach(c=>rows.push([c.date||'',c.name")

# Add settlement and materials export after candidates
$settleBlock = @'

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
$text = $text.Replace(
    "XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '候选管理');",
    "XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '候选管理');$settleBlock"
)
Write-Host "7. Export additions done"

# ===== 7. DASHBOARD =====
# Add avgInteraction
$text = $text.Replace(
    "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);",
    "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);`n  const avgInteraction = contents.length > 0 ? (contents.reduce((s,c) => s+(c.interaction||0), 0) / contents.length).toFixed(1) : '0.0';"
)

# Add stat cards
$text = $text.Replace(
    "{ label:'总花费',     value:fmtMoney(totalPrice), icon:'💰', cls:'orange' },",
    "{ label:'总花费',     value:fmtMoney(totalPrice), icon:'💰', cls:'orange' },`n    { label:'总点赞数',    value:fmtNum(totalLikes), icon:'👍', cls:'blue' },"
)
$text = $text.Replace(
    "{ label:'CPM',        value:cpm, icon:'📊', cls:'purple' },",
    "{ label:'CPM',        value:cpm, icon:'📊', cls:'purple' },`n    { label:'平均互动率',   value:avgInteraction+'%', icon:'💬', cls:'green' },"
)

# Grid 3 columns
$text = $text.Replace('grid-template-columns:repeat(4,1fr) !important', 'grid-template-columns:repeat(3,1fr) !important')

# Talent rank chart
$text = $text.Replace(
    "</div>`n      </div>`n    </div>`n`n    <!-- Schedule",
    "</div>`n      </div>`n      <div class=`"card`" style=`"margin-top:16px`">`n        <div class=`"card-title`">🏆 达人合作排行 Top5（按播放量）</div>`n        <div class=`"chart-container`" style=`"height:280px`"><canvas id=`"talent-rank-chart`"></canvas></div>`n      </div>`n    </div>`n`n    <!-- Schedule"
)

# Variable and render call
$text = $text.Replace('let trendChart, platformChart;', 'let trendChart, platformChart, talentRankChart;')
$text = $text.Replace('renderPlatformChart(contents);', "renderPlatformChart(contents);`n  renderTalentRankChart(contents);")

# Add function
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
$text = $text.Replace('/* ==================== Calendar ==================== */', "$rankFunc`n/* ==================== Calendar ==================== */")
Write-Host "8. Dashboard improved"

# ===== 8. CLEAN UP =====
# Remove test buttons
$text = $text -replace '<button class="btn btn-primary btn-sm" onclick="alert\([^"]*\)[^"]*">[^<]*</button>', ''
$text = $text.Replace('[测试]', '')
$text = $text.Replace('[V10-20260508]', '[V11-20260508]')

# Clean login subtitle
$subIdx = $text.IndexOf('内部管理系统')
if ($subIdx -gt 0) {
    $subEnd = $text.IndexOf('</div>', $subIdx)
    if ($subEnd -gt $subIdx) {
        $subLine = $text.Substring($subIdx, $subEnd - $subIdx)
        if ($subLine.Length -gt 10) {
            $text = $text.Substring(0, $subIdx) + '内部管理系统' + $text.Substring($subEnd)
        }
    }
}
Write-Host "9. Cleaned up"

# ===== SAVE =====
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($filePath, $text, $utf8NoBom)
Write-Host "`nDone! Saved $($text.Length) chars to $filePath"
