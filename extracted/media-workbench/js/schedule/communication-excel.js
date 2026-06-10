/* =====================================================================
 * 内容发布 · Excel 解析器 + 导入向导 + 导出 + 模板
 *
 * 暴露：
 *   window.CommunicationExcel = { COLUMNS, parseFile, validateRows, ... }
 *   window.CommunicationIE = { openImport, closeImport, doExport, downloadTemplate, ... }
 *
 * Excel 格式说明：
 *   主达人行：填昵称、价格、粉丝量、作品类型、首个平台行的发布信息
 *   子平台行：留空昵称/价格/粉丝量/作品类型，只填发布平台 + 时间 + 链接 + 指标
 *   遇到"昵称非空"开始新的合作；后续"昵称为空"归属上一条
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[CommunicationExcel] ScheduleData 未就绪'); return; }

  const COLUMNS = [
    // 主信息（仅主行填）
    { key: 'talent',      header: '抖音昵称',  group: '基本信息', mainOnly: true },
    { key: 'price',       header: '价格',      group: '基本信息', mainOnly: true },
    { key: 'fans',        header: '粉丝量(W)', group: '基本信息', mainOnly: true },
    { key: 'category',    header: '作品类型',  group: '基本信息', mainOnly: true },
    // 渠道信息（每行都填）
    { key: 'platform',    header: '发布平台',  group: '发布信息' },
    { key: 'date',        header: '发布时间',  group: '发布信息' },
    { key: 'link',        header: '发布链接',  group: '发布信息' },
    // 第 7 天数据
    { key: 'views',       header: '播放量(W)', group: '第7天' },
    { key: 'likes',       header: '赞',        group: '第7天' },
    { key: 'comments',    header: '评论',      group: '第7天' },
    { key: 'completion',  header: '完播率',    group: '第7天' },
    { key: 'interaction', header: '互动率',    group: '第7天' },
    // 看后搜（抖音独有）
    { key: 'search_views',header: '看后搜量',  group: '看后搜', douyinOnly: true },
    { key: 'search_rate', header: '看后搜率',  group: '看后搜', douyinOnly: true },
    // 归因（抖音独有）
    { key: 'attr_direct',   header: '直接归因', group: '归因', douyinOnly: true },
    { key: 'attr_indirect', header: '简介归因', group: '归因', douyinOnly: true },
    { key: 'attr_search',   header: '看后搜归因', group: '归因', douyinOnly: true },
    { key: 'attr_audience', header: '人群获取', group: '归因', douyinOnly: true },
    { key: 'attr_store',    header: '店铺表现', group: '归因', douyinOnly: true },
    { key: 'cpa3',          header: 'CPA3',     group: '归因', douyinOnly: true },
  ];

  /* ------------------------- 解析 ------------------------- */
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) return reject(new Error('Excel 文件没有 Sheet'));
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (!rows.length) return reject(new Error('Sheet 为空'));
          const headers = rows[0].map(h => String(h || '').trim());
          const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
          resolve({ headers, rows: dataRows });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  function findColIdx(headers, key) {
    const col = COLUMNS.find(c => c.key === key);
    if (!col) return -1;
    // 精确 + 模糊匹配
    let idx = headers.indexOf(col.header);
    if (idx >= 0) return idx;
    idx = headers.findIndex(h => h.includes(col.header) || col.header.includes(h));
    return idx;
  }

  /** 把扁平行数据聚合为主子结构 */
  function groupRowsToContents(headers, rawRows) {
    const idxMap = {};
    COLUMNS.forEach(c => { idxMap[c.key] = findColIdx(headers, c.key); });
    const contents = [];   // [{ main: {...}, channels: [{...}, ...], rowIdxStart }]
    let current = null;
    rawRows.forEach((row, i) => {
      const get = key => idxMap[key] >= 0 ? row[idxMap[key]] : '';
      const talent = String(get('talent') || '').trim();
      // 主行判断：昵称非空 => 新主合作
      if (talent) {
        current = {
          rowIdxStart: i + 2, // 实际 Excel 行号（1 是表头，所以 +2）
          main: {
            talent,
            price: get('price'),
            fans: get('fans'),
            category: String(get('category') || '').trim(),
          },
          channels: [],
        };
        contents.push(current);
      }
      if (!current) {
        // 头几行没有主行的话忽略
        return;
      }
      // 渠道：每行都尝试解析为渠道（包括主行自己）
      const platform = String(get('platform') || '').trim();
      const date = get('date');
      if (platform || date) {
        current.channels.push({
          platform,
          date: parseDate(date),
          link: String(get('link') || '').trim(),
          views: numeric(get('views')),
          likes: numeric(get('likes')),
          comments: numeric(get('comments')),
          completion: numericPct(get('completion')),
          interaction: numericPct(get('interaction')),
          search_views: numeric(get('search_views')),
          search_rate: numericPct(get('search_rate')),
          attr_direct: numeric(get('attr_direct')),
          attr_indirect: numeric(get('attr_indirect')),
          attr_search: numeric(get('attr_search')),
          attr_audience: numeric(get('attr_audience')),
          attr_store: String(get('attr_store') || '').trim(),
          cpa3: numeric(get('cpa3')),
        });
      }
    });
    return contents;
  }

  function numeric(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[,，\s]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function numericPct(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[%,，\s]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function parseDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') {
      // Excel 序列号
      const epoch = Date.UTC(1899, 11, 30);
      const d = new Date(epoch + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m;
    if (m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    return s;
  }

  /** 把聚合好的 content 转为最终入库格式（含 schedule 匹配/创建） */
  function resolveSchedule(content, opts = {}) {
    const { autoCreate = true } = opts;
    const m = content.main;
    const firstChannel = content.channels[0];
    const date = firstChannel?.date || '';
    // 匹配规则：同名 + 当月内的排期；如不存在则按 talent + date 精确匹配
    if (!date || !m.talent) return null;
    let sched = (window.DB.schedules || []).find(s =>
      !s.deleted_at &&
      s.kol_name === m.talent &&
      s.schedule_date === date
    );
    if (sched) return { schedule_id: sched.id, created: false };
    // 按"同月+同名"宽松匹配
    const monthPrefix = date.slice(0, 7);
    sched = (window.DB.schedules || []).find(s =>
      !s.deleted_at &&
      s.kol_name === m.talent &&
      (s.schedule_date || '').startsWith(monthPrefix)
    );
    if (sched) return { schedule_id: sched.id, created: false };
    // 自动创建排期
    if (autoCreate) {
      const tier = window.SD?.listTiers?.()[0]?.name || '';
      try {
        const newSched = SD.createSchedule({
          schedule_date: date,
          kol_name: m.talent,
          kol_homepage: '',  // 留空
          amount: Number(m.price) || 0,
          category_direction: m.category || '',
          tier: '',
          platform: firstChannel?.platform || '',
          status: 'published',
        });
        return { schedule_id: newSched.id, created: true };
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /* ------------------------- 模板 + 导出 ------------------------- */
  function buildTemplate() {
    const headers = COLUMNS.map(c => c.header);
    const example = [
      // 主达人行（抖音）
      ['万万也没想到', 500, 1.5, '情侣弹唱', '抖音', '2026-05-01', 'https://v.douyin.com/xxx',
       5.3, 712, 107, '19.3', '1.0', 9, '0', 1, 0, 0, 0, '', 0],
      // 子平台行（同达人小红书）
      ['', '', '', '', '小红书', '2026-05-01', 'http://xhslink.com/yyy',
       0.3, '', '', '', '', '', '', '', '', '', '', '', ''],
      // 子平台行（同达人B站）
      ['', '', '', '', 'B站', '2026-05-01', 'https://b23.tv/zzz',
       0.6, '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...example]);
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '内容发布');
    const help = [
      ['字段', '是否必填', '说明'],
      ['抖音昵称', '主行必填', '主达人行需填昵称；子平台行（同一次合作的其他平台）昵称留空'],
      ['价格', '主行', '主达人行的合作总价，子行留空'],
      ['粉丝量(W)', '主行', '主行填，单位万'],
      ['作品类型', '主行', '弹唱 / 弹奏 / 生活 等'],
      ['发布平台', '每行必填', '抖音 / 小红书 / B站 / 视频号 / 快手 等'],
      ['发布时间', '每行必填', '2026-05-01 / 2026/5/1 格式'],
      ['发布链接', '否', 'https:// 开头'],
      ['播放量(W)', '否', '万为单位，如 5.3'],
      ['完播率/互动率', '否', '%数字，如 19.3'],
      ['看后搜量/看后搜率/归因', '抖音独有', '其他平台保持空'],
      ['', '', ''],
      ['📌 导入逻辑：每条主达人行会自动匹配排期，找不到时按"昵称+日期"自动创建一条 status=已发布 的排期'],
    ];
    const wsHelp = XLSX.utils.aoa_to_sheet(help);
    wsHelp['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, '填写说明');
    return wb;
  }

  function exportToWorkbook(year, month, mainPlatform, bd_id) {
    const list = SD.listContents({ year, month, mainPlatform, bd_id });
    if (!list.length) return null;
    const data = [COLUMNS.map(c => c.header)];
    const merges = [];   // 同一达人多平台时，合并前4列（昵称/价格/粉丝量/作品类型）
    let rowIdx = 1;      // 数据从第 1 行开始（第 0 行是表头）
    list.forEach(content => {
      const r = SD.resolveContent(content);
      const pubs = content.publications || [];
      const n = pubs.length;
      pubs.forEach((p, i) => {
        if (i === 0) {
          // 主行
          data.push([
            r.talent, r.price, content.fans != null ? (content.fans/10000).toFixed(1) : '', r.category,
            p.platform, p.date, p.link,
            p.views, p.likes, p.comments, p.completion, p.interaction,
            p.search_views, p.search_rate,
            p.attr_direct, p.attr_indirect, p.attr_search, p.attr_audience, p.attr_store, p.cpa3,
          ]);
        } else {
          // 子行
          data.push([
            '', '', '', '',
            p.platform, p.date, p.link,
            p.views, p.likes, p.comments, p.completion, p.interaction,
            p.search_views, p.search_rate,
            p.attr_direct, p.attr_indirect, p.attr_search, p.attr_audience, p.attr_store, p.cpa3,
          ]);
        }
      });
      // 多平台 → 把前 4 列纵向合并成一个格子（和网页 rowspan 一致）
      if (n > 1) {
        for (let col = 0; col < 4; col++) {
          merges.push({ s: { r: rowIdx, c: col }, e: { r: rowIdx + n - 1, c: col } });
        }
      }
      rowIdx += n;
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 14) }));
    if (merges.length) ws['!merges'] = merges;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${year}-${String(month).padStart(2,'0')}`);
    return wb;
  }

  /* ===================================================================
   * 导入对话框
   * =================================================================== */
  const state = {
    open: false,
    file: null, headers: [], rawRows: [],
    contents: [],   // 解析后聚合的合作
    autoCreate: true,
    result: null,
  };

  function ensureNode() {
    if (document.getElementById('comm-import-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'comm-import-overlay';
    ov.className = 'sched-import-overlay';
    ov.addEventListener('click', e => { if (e.target === ov) closeImport(); });
    ov.innerHTML = `
      <div class="sched-import-panel" style="width:880px">
        <div class="sched-import-header">
          <div style="font-weight:600;font-size:1.05rem">📥 导入内容发布数据</div>
          <button class="sched-drawer-close" onclick="CommunicationIE.closeImport()">×</button>
        </div>
        <div class="sched-import-body" id="__ci-body__"></div>
        <div class="sched-import-footer" id="__ci-footer__"></div>
      </div>
    `;
    document.body.appendChild(ov);
  }

  function openImport() {
    ensureNode();
    state.open = true;
    state.file = null; state.contents = []; state.result = null;
    state.autoCreate = true;
    paintImport();
    requestAnimationFrame(() => document.getElementById('comm-import-overlay').classList.add('open'));
  }
  function closeImport() {
    state.open = false;
    const o = document.getElementById('comm-import-overlay');
    if (o) o.classList.remove('open');
    if (state.result && state.result.success > 0) {
      window.CommunicationPage && CommunicationPage.render();
    }
  }

  function paintImport() {
    const body = document.getElementById('__ci-body__');
    const footer = document.getElementById('__ci-footer__');
    if (state.result) {
      const r = state.result;
      body.innerHTML = `
        <div class="sched-import-progress">
          <div style="font-size:2rem">✅</div>
          <div style="font-size:1.05rem;font-weight:600;margin-top:6px">导入完成</div>
        </div>
        <div class="sched-import-result-card">
          <div class="sched-import-result-stats">
            <div>✓ 新增内容：<b style="color:var(--success)">${r.success}</b></div>
            <div>📅 自动建排期：<b style="color:var(--primary)">${r.schedCreated}</b></div>
            <div>⊝ 跳过：<b>${r.skipped}</b></div>
            ${r.failed ? `<div>✗ 失败：<b style="color:var(--danger)">${r.failed}</b></div>` : ''}
          </div>
          ${(r.errors && r.errors.length) ? `
            <details><summary style="cursor:pointer;color:var(--danger);font-size:.85rem">查看 ${r.errors.length} 条失败原因</summary>
              <div style="max-height:200px;overflow:auto;background:#fff;border:1px solid var(--border);padding:8px;margin-top:6px;font-size:.78rem">
                ${r.errors.map(e => `<div>行 ${e.row}：${escapeHtml(e.error)}</div>`).join('')}
              </div>
            </details>` : ''}
        </div>
      `;
      footer.innerHTML = `<div class="spacer" style="flex:1"></div><button class="btn btn-primary btn-sm" onclick="CommunicationIE.closeImport()">完成</button>`;
      return;
    }
    if (!state.file) {
      body.innerHTML = `
        <div class="sched-import-drop" id="__ci-drop__">
          <div class="icon">📂</div>
          <div class="title">点击或拖拽 Excel 文件到此处</div>
          <div class="sub">支持 .xlsx / .xls / .csv · 上限 5MB</div>
          <input type="file" id="__ci-file__" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div style="text-align:center">
          <span class="sched-import-template-link" onclick="CommunicationIE.downloadTemplate()">
            📄 下载导入模板（主达人 + 子平台示例）
          </span>
        </div>
      `;
      footer.innerHTML = `<div class="spacer" style="flex:1"></div><button class="btn btn-secondary btn-sm" onclick="CommunicationIE.closeImport()">取消</button>`;
      bindUpload();
      return;
    }
    // 预览
    const totalContents = state.contents.length;
    const totalChannels = state.contents.reduce((s, c) => s + c.channels.length, 0);
    body.innerHTML = `
      <div class="sched-import-preview-stats">
        <div class="stat">📂 ${escapeHtml(state.file.name)}</div>
        <div class="stat">解析到：<b>${totalContents}</b> 个达人合作 · <b>${totalChannels}</b> 个发布渠道</div>
      </div>
      <div class="sched-import-strategy">
        <strong>排期匹配策略</strong>
        <div style="margin-top:8px;font-size:.85rem">
          <label><input type="checkbox" ${state.autoCreate?'checked':''} onchange="CommunicationIE._toggleAutoCreate(this.checked)">
          找不到匹配排期时自动创建（推荐）</label>
        </div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">
          匹配规则：达人名 + 发布日期 → 找不到 → 同月达人 → ${state.autoCreate ? '自动创建排期' : '跳过此条'}
        </div>
      </div>
      <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:4px">
        <table class="sched-import-preview-table">
          <thead><tr>
            <th>#</th><th>达人</th><th>价格</th><th>类型</th><th>渠道数</th><th>主渠道</th><th>首日</th>
          </tr></thead>
          <tbody>${state.contents.slice(0,100).map((c,i)=>renderContentPreview(c,i)).join('')}</tbody>
        </table>
        ${totalContents>100?`<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:.78rem">仅显示前 100 条，实际将导入 ${totalContents} 条合作</div>`:''}
      </div>
    `;
    footer.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="CommunicationIE._reset()">← 重新上传</button>
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-secondary btn-sm" onclick="CommunicationIE.closeImport()">取消</button>
      <button class="btn btn-primary btn-sm" onclick="CommunicationIE._execute()">开始导入（${totalContents} 条）</button>
    `;
  }

  function renderContentPreview(c, i) {
    const first = c.channels[0];
    return `
      <tr>
        <td>${i+1}</td>
        <td><strong>${escapeHtml(c.main.talent)}</strong></td>
        <td>${c.main.price || '-'}</td>
        <td>${escapeHtml(c.main.category || '-')}</td>
        <td>${c.channels.length}</td>
        <td>${escapeHtml(first?.platform || '-')}</td>
        <td>${escapeHtml(first?.date || '-')}</td>
      </tr>
    `;
  }

  function bindUpload() {
    const drop = document.getElementById('__ci-drop__');
    const fi = document.getElementById('__ci-file__');
    if (!drop || !fi) return;
    drop.addEventListener('click', () => fi.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', async e => {
      e.preventDefault();
      drop.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) await handleFile(f);
    });
    fi.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (f) await handleFile(f);
    });
  }

  async function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      window.toast && window.toast('文件超过 5MB', 'error');
      return;
    }
    state.file = file;
    try {
      const { headers, rows } = await parseFile(file);
      state.headers = headers;
      state.rawRows = rows;
      state.contents = groupRowsToContents(headers, rows);
      paintImport();
    } catch (e) {
      window.toast && window.toast('解析失败：' + e.message, 'error');
      state.file = null;
    }
  }

  function _reset() {
    state.file = null; state.contents = [];
    paintImport();
  }
  function _toggleAutoCreate(v) { state.autoCreate = v; paintImport(); }

  function _execute() {
    const result = { success: 0, skipped: 0, failed: 0, schedCreated: 0, errors: [] };
    state.contents.forEach((c, idx) => {
      try {
        if (!c.main.talent) { result.skipped++; return; }
        if (!c.channels.length) {
          result.skipped++;
          return;
        }
        const r = resolveSchedule(c, { autoCreate: state.autoCreate });
        if (!r) {
          result.failed++;
          result.errors.push({ row: c.rowIdxStart, error: `「${c.main.talent}」未找到匹配排期${state.autoCreate?'且创建失败':'（已禁用自动创建）'}` });
          return;
        }
        if (r.created) result.schedCreated++;
        // 把粉丝量从"万"转人
        let fansPersons = null;
        if (c.main.fans != null && c.main.fans !== '') {
          const n = Number(c.main.fans);
          if (Number.isFinite(n)) fansPersons = Math.round(n * 10000);
        }
        SD.createContent({
          schedule_id: r.schedule_id,
          fans: fansPersons,
          publications: c.channels,
        });
        result.success++;
      } catch (e) {
        result.failed++;
        result.errors.push({ row: c.rowIdxStart, error: e.message });
      }
    });
    state.result = result;
    paintImport();
    window.toast && window.toast(`导入完成：新增 ${result.success} 条`, 'success');
  }

  function downloadTemplate() {
    const wb = buildTemplate();
    XLSX.writeFile(wb, '内容发布导入模板.xlsx');
  }

  function doExport() {
    if (!window.CommunicationPage) return;
    const s = (window.DB.contents || []);
    if (!s.length) {
      window.toast && window.toast('当前无内容可导出', 'info');
      return;
    }
    // 用页面当前的筛选条件导出
    const page = window.CommunicationPage._getState ? window.CommunicationPage._getState() : null;
    const year = page?.year || new Date().getFullYear();
    const month = page?.month || (new Date().getMonth()+1);
    const mainPlatform = page?.mainPlatform || '';
    const bd_id = page?.bd_id || undefined;
    const wb = exportToWorkbook(year, month, mainPlatform, bd_id);
    if (!wb) {
      window.toast && window.toast('当前筛选条件下无数据', 'info');
      return;
    }
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
    XLSX.writeFile(wb, `内容发布_${year}-${String(month).padStart(2,'0')}_${mainPlatform || '全部'}_${stamp}.xlsx`);
    window.toast && window.toast('已导出', 'success');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  window.CommunicationExcel = { COLUMNS, parseFile, groupRowsToContents, buildTemplate, exportToWorkbook };
  window.CommunicationIE = {
    openImport, closeImport, doExport, downloadTemplate,
    _reset, _execute, _toggleAutoCreate,
  };
  console.log('[CommunicationExcel] 已就绪');
})();
