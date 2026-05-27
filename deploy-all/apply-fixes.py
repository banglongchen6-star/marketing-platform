"""V11 Fix Script - Python version for reliable encoding handling"""
import re
import os

filePath = r'D:\WorkBuddy\2026-05-08-task-5\media-workbench-v10\media-workbench\index.html'

# Read with UTF-8
with open(filePath, 'r', encoding='utf-8-sig') as f:
    text = f.read()

print(f"File size: {len(text)} chars")

changes = []

# ===== 1. Fix platform tags =====
# Find the block: <div class="platform-tags"> ... </div> that contains garbled text
# It's between "发布平台" label and "<!-- 发布信息 -->" comment
# Strategy: find all platform-tag labels, replace the entire nested block

platform_new = """          <div class="platform-tags">
            <label class="platform-tag"><input type="checkbox" id="cp-douyin" value="\u6296\u97f3" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>\u6296\u97f3</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-xiaohongshu" value="\u5c0f\u7ea2\u4e66" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>\u5c0f\u7ea2\u4e66</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-bilibili" value="B\u7ad9" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>B\u7ad9</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weibo" value="\u5fae\u535a" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>\u5fae\u535a</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-kuaishou" value="\u5feb\u624b" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>\u5feb\u624b</span></label>
            <label class="platform-tag"><input type="checkbox" id="cp-weixin" value="\u89c6\u9891\u53f7" onchange="this.parentElement.classList.toggle('active',this.checked)" /><span>\u89c6\u9891\u53f7</span></label>
          </div>"""

# Pattern: from "发布平台" to just before "<!-- 发布信息 -->"
# The block contains: label > div.platform-tags > div.platform-tags > labels... > /div > /div > /div
pub_marker = "\u53d1\u5e03\u5e73\u53f0"  # 发布平台
pub_info = "\u53d1\u5e03\u4fe1\u606f"   # 发布信息

# Find indices
pub_idx = text.find(pub_marker)
info_idx = text.find(f"<!-- {pub_info} -->")

if pub_idx > 0 and info_idx > pub_idx:
    # Find the opening <div class="platform-tags"> after the label
    tags_start = text.find('<div class="platform-tags">', pub_idx)
    # Find the matching closing structure: </div>\n</div>\n</div> before the comment
    search_from = info_idx
    # Go backwards to find the last </div> before the comment
    # Find: </div>  </div>  </div>   (with whitespace)
    pre_comment = text[tags_start:info_idx]
    # The platform block ends with </div> then whitespace then </div> then whitespace then </div>
    # Find the position of the last </div> before the comment
    end_pos = info_idx
    # Actually, let's find the structure: after the last </label> there are closing divs
    # Pattern: ...</label>\n          </div>\n        </div>\n      </div>
    # We need to replace from tags_start to the last </div> before <!-- 发布信息 -->

    # Simpler: replace from the first <div class="platform-tags"> after pub_marker
    # to just before <!-- 发布信息 -->
    # But we need to preserve the outer form-group structure
    # The structure is: form-group > label > div.platform-tags > (content) > /form-group

    # Let's find the form-group boundaries
    fg_start = text.rfind('<div class="form-group">', 0, pub_idx)
    # The form-group ends after the platform tags close, before the next section
    # Find the pattern: </div>\n      </div>\n    </div>  before comment

    # Let me just replace everything between the label closing and the comment
    label_end = text.find('</label>', pub_idx) + len('</label>')
    # The closing structure before the comment
    closing_pattern = '</div>\n        </div>\n      </div>\n'
    closing_pos = text.rfind('</div>', tags_start, info_idx)
    # Actually, let's count: there are 3 closing divs after the labels
    # </div> (inner platform-tags), </div> (outer platform-tags), </div> (form-group)

    # Find the form-group closing
    # After all the labels, there's:
    #   </div>     <- closes inner platform-tags
    #   </div>     <- closes outer platform-tags
    # </div>       <- closes form-group

    # Replace from after the label to before the comment
    text = text[:label_end+1] + "\n" + platform_new + "\n        </div>" + "\n      </div>" + "\n      <!-- " + pub_info + " -->" + text[info_idx + len(f"<!-- {pub_info} -->"):]
    changes.append("Platform tags fixed")
    print("  Platform tags replaced.")
else:
    print(f"  WARNING: pub_idx={pub_idx}, info_idx={info_idx}")

# ===== 2. Fix duplicate s-topic + add s-type =====
# Find the second occurrence of id="s-topic"
s_topic_pattern = r'<input class="form-control" id="s-topic"'
matches = list(re.finditer(s_topic_pattern, text))
print(f"  s-topic occurrences: {len(matches)}")

if len(matches) >= 2:
    # The duplicate starts at a <div class="form-group"> before the second s-topic
    dup_start = text.rfind('<div class="form-group">', 0, matches[1].start())
    # Find the closing </div> for this form-group
    close_pos = text.find('</div>', matches[1].end())
    close_pos2 = text.find('</div>', close_pos + 6)

    s_type_block = """      <div class="form-row">
        <div class="form-group">
          <label class="form-label">\u5185\u5bb9\u7c7b\u578b</label>
          <select class="form-control" id="s-type">
            <option value="\u89c6\u9891">\u89c6\u9891</option>
            <option value="\u56fe\u6587">\u56fe\u6587</option>
            <option value="\u76f4\u64ad">\u76f4\u64ad</option>
          </select>
        </div>"""

    text = text[:dup_start] + s_type_block + text[close_pos2:]
    changes.append("Duplicate s-topic removed, s-type added")
    print("  Schedule modal fixed.")

# ===== 3. Fix getPlatforms =====
text = text.replace("platforms.push('\u5fae\u4fe1')", "platforms.push('\u89c6\u9891\u53f7')")
text = text.replace("'\u5fae\u4fe1':'cp-weixin'", "'\u89c6\u9891\u53f7':'cp-weixin','\u5fae\u4fe1':'cp-weixin'")

# ===== 4. Fix openScheduleModal =====
# Add s.type read
text = text.replace(
    "getElementById('s-status').value = s.status || '';",
    "getElementById('s-status').value = s.status || '';\n    document.getElementById('s-type').value = s.type || '\u89c6\u9891';"
)
# Add s.type default
text = text.replace(
    "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];",
    "document.getElementById('s-date').value = new Date().toISOString().split('T')[0];\n    document.getElementById('s-type').value = '\u89c6\u9891';"
)
# Fix saveSchedule data
text = text.replace(
    "date, status:document.getElementById('s-status')",
    "date, type:document.getElementById('s-type').value, status:document.getElementById('s-status')"
)

# ===== 5. Candidate modal - add date =====
text = text.replace(
    """<input class="form-control" id="ca-name" placeholder=""""",
    """<input class="form-control" id="ca-date" type="date" />\n        </div>\n      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">\u4e3b\u9875\u94fe\u63a5</label>
          <input class="form-control" id="ca-name" placeholder=\"\""""
)
# Hmm that's wrong. Let me do it differently.

# Actually, let me re-read the current text to find ca-name
ca_name_idx = text.find('id="ca-name"')
if ca_name_idx > 0:
    # Find the end of this form-row (two closing </div>)
    end = text.find('</div>\n      </div>', ca_name_idx)
    if end > 0:
        end += len('</div>\n      </div>')
        insert = """
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">\u8bb0\u5f55\u65e5\u671f</label>
          <input type="date" class="form-control" id="ca-date" />
        </div>
        <div class="form-group">
          <label class="form-label">\u4e3b\u9875\u94fe\u63a5</label>
          <input class="form-control" id="ca-link" placeholder="https://..." />
        </div>"""
        # Replace from after the ca-name form-row to remove the old ca-link form-row
        old_link_start = text.find('<div class="form-row">\n        <div class="form-group">\n          <label class="form-label">', end)
        if old_link_start < 0:
            old_link_start = text.find('ca-link', end)
            if old_link_start > 0:
                old_link_start = text.rfind('<div class="form-row">', 0, old_link_start)
        old_link_end = text.find('</div>\n      </div>', old_link_start) + len('</div>\n      </div>')

        if old_link_start > 0 and old_link_end > old_link_start:
            text = text[:end] + insert + text[old_link_end:]
            changes.append("Candidate date field added")
            print("  Candidate modal fixed.")

# Fix openCandidateModal
text = text.replace(
    "getElementById('ca-name').value=c.name;",
    "getElementById('ca-name').value=c.name; document.getElementById('ca-date').value=c.date||'';"
)
text = text.replace("clearFields('ca-name','ca-link'", "clearFields('ca-name','ca-date','ca-link")

# Fix saveCandidate
text = text.replace(
    "name, link:document.getElementById('ca-link')",
    "name, date:document.getElementById('ca-date').value, link:document.getElementById('ca-link')"
)
text = text.replace(
    "date:new Date().toISOString().split('T')[0], ...data",
    "...data"
)

# ===== 6. Export additions =====
# Add checkboxes
text = text.replace(
    """id="export-candidates" checked /> \u5019\u9009\u7ba1\u7406
          </label>""",
    """id="export-candidates" checked /> \u5019\u9009\u7ba1\u7406
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-settlement" checked /> \u8fbe\u4eba\u7ed3\u7b97
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text-secondary);cursor:pointer">
            <input type="checkbox" id="export-materials" /> \u7d20\u6750\u7ba1\u7406
          </label>"""
)

# Add export variables
text = text.replace(
    "const exportCandidates=document.getElementById('export-candidates').checked;",
    "const exportCandidates=document.getElementById('export-candidates').checked;\n  const exportSettlement=document.getElementById('export-settlement').checked;\n  const exportMaterials=document.getElementById('export-materials').checked;"
)

# Fix candidate export header
text = text.replace("const rows=[['\u8fbe\u4eba\u6635\u79f0'", "const rows=[['\u8bb0\u5f55\u65e5\u671f','\u8fbe\u4eba\u6635\u79f0'")
text = text.replace("DB.candidates.forEach(c=>rows.push([c.name", "DB.candidates.forEach(c=>rows.push([c.date||'',c.name")

# Add settlement and materials export
settle_export = """
  if(exportSettlement){
    const sList=DB.settlements.filter(c=>{
      if(startDate&&c.payDate&&c.payDate<startDate) return false;
      if(endDate&&c.payDate&&c.payDate>endDate) return false;
      return true;
    });
    const sRows=[['\u8fbe\u4eba','\u7ed3\u7b97\u5468\u671f','\u91d1\u989d','\u72b6\u6001','\u4ed8\u6b3e\u65e5\u671f','\u53d1\u7968\u72b6\u6001','\u5907\u6ce8']];
    sList.forEach(s=>sRows.push([s.talent,s.period,s.amount||0,s.status,s.payDate||'',s.invoice||'',s.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sRows), '\u8fbe\u4eba\u7ed3\u7b97');
  }
  if(exportMaterials){
    const mRows=[['\u8fbe\u4eba','\u7c7b\u578b','\u4e3b\u9898','\u53d1\u5e03\u65f6\u95f4','\u7d20\u6750\u94fe\u63a5','\u5ba1\u6838\u72b6\u6001','\u5907\u6ce8']];
    DB.materials.forEach(m=>mRows.push([m.talent,m.type||'',m.topic||'',m.date||'',m.link||'',m.review||'',m.note||'']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mRows), '\u7d20\u6750\u7ba1\u7406');
  }"""

cand_export_end = "XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '\u5019\u9009\u7ba1\u7406');"
text = text.replace(cand_export_end, cand_export_end + settle_export)

# ===== 7. Dashboard =====
# Add avgInteraction calculation
text = text.replace(
    "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);",
    "const totalLikes = contents.reduce((s,c) => s+(c.likes||0), 0);\n  const avgInteraction = contents.length > 0 ? (contents.reduce((s,c) => s+(c.interaction||0), 0) / contents.length).toFixed(1) : '0.0';"
)

# Add stat cards
text = text.replace(
    "{ label:'\u603b\u82b1\u8d39',     value:fmtMoney(totalPrice), icon:'\U0001f4b0', cls:'orange' },",
    "{ label:'\u603b\u82b1\u8d39',     value:fmtMoney(totalPrice), icon:'\U0001f4b0', cls:'orange' },\n    { label:'\u603b\u70b9\u8d5e\u6570',    value:fmtNum(totalLikes), icon:'\U0001f44d', cls:'blue' },"
)
text = text.replace(
    "{ label:'CPM',        value:cpm, icon:'\U0001f4ca', cls:'purple' },",
    "{ label:'CPM',        value:cpm, icon:'\U0001f4ca', cls:'purple' },\n    { label:'\u5e73\u5747\u4e92\u52a8\u7387',   value:avgInteraction+'%', icon:'\U0001f4ac', cls:'green' },"
)

# Grid 3 columns
text = text.replace('grid-template-columns:repeat(4,1fr) !important', 'grid-template-columns:repeat(3,1fr) !important')

# Talent rank chart HTML
text = text.replace(
    '</div>\n      </div>\n    </div>\n\n    <!-- Schedule',
    '</div>\n      </div>\n      <div class="card" style="margin-top:16px">\n        <div class="card-title">\U0001f3c6 \u8fbe\u4eba\u5408\u4f5c\u6392\u884c Top5\uff08\u6309\u64ad\u653e\u91cf\uff09</div>\n        <div class="chart-container" style="height:280px"><canvas id="talent-rank-chart"></canvas></div>\n      </div>\n    </div>\n\n    <!-- Schedule'
)

# talentRankChart variable
text = text.replace('let trendChart, platformChart;', 'let trendChart, platformChart, talentRankChart;')

# Render call
text = text.replace('renderPlatformChart(contents);', 'renderPlatformChart(contents);\n  renderTalentRankChart(contents);')

# Add renderTalentRankChart function
rank_func = """
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
  talentRankChart = new Chart(ctx, { type:'bar', data:{ labels:sorted.map(([n])=>n), datasets:[{ label:'\u603b\u64ad\u653e\u91cf', data:sorted.map(([,d])=>d.views), backgroundColor:['rgba(26,86,219,.8)','rgba(5,150,105,.8)','rgba(217,119,6,.8)','rgba(124,58,237,.8)','rgba(220,38,38,.8)'], borderRadius:6, barThickness:28 }] }, options:{ responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{ legend:{display:false}, tooltip:{callbacks:{afterLabel:(ctx)=>sorted[ctx.dataIndex][1].count+'\u6761\u5185\u5bb9'}} }, scales:{ x:{ticks:{color:'#9ca3af',font:{size:10},callback:v=>v>=10000?(v/10000).toFixed(0)+'\u4e07':v},grid:{color:'#e4e8ed'}}, y:{ticks:{color:'#374151',font:{size:12,weight:'500'}},grid:{display:false}} } } });
}
"""
text = text.replace('/* ==================== Calendar ==================== */', rank_func + '/* ==================== Calendar ==================== */')

# ===== 8. Clean up =====
# Remove test button in topbar
text = re.sub(r'<button class="btn btn-primary btn-sm" onclick="alert\(.*?\)'.*?</button>', '', text)
text = text.replace('[\u6d4b\u8bd5]', '')  # [测试]

# Version
text = text.replace('[V10-20260508]', '[V11-20260508]')

# Login subtitle cleanup
text = re.sub(r'\u5185\u90e8\u7ba1\u7406\u7cfb\u7edf.*', '\u5185\u90e8\u7ba1\u7406\u7cfb\u7edf', text)

# ===== Save =====
with open(filePath, 'w', encoding='utf-8') as f:
    f.write(text)

print(f"\nDone! Saved {len(text)} chars")
print(f"Changes: {', '.join(changes)}")
