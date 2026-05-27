/* =====================================================================
 * 达人库 · Excel 解析器 + 导入导出模块
 *
 * 暴露：window.KolsExcel = {
 *   COLUMNS, parseFile, fuzzyMapping, validateRow,
 *   buildTemplate, exportToWorkbook
 * }
 * 暴露：window.KolsImportExport = { openImport(), doExport() }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[KolsExcel] ScheduleData 未就绪'); return; }

  const COLUMNS = [
    { key: 'name',      header: '达人名',  required: true,  example: '万万也没想到' },
    { key: 'platform',  header: '平台',    required: false, example: '抖音' },
    { key: 'homepage',  header: '主页链接',required: false, example: 'https://www.douyin.com/user/...' },
    { key: 'followers', header: '粉丝量',  required: false, example: 380000 },
    { key: 'category',  header: '达人类型',required: false, example: '弹唱' },
    { key: 'notes',     header: '备注',    required: false, example: '报价 800-1500' },
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
          const headers = rows[0].map(h => String(h || '').trim()).filter(Boolean);
          const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
          resolve({ headers, rows: dataRows });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  const ALIASES = {
    name:      ['达人名', '达人', '昵称', '博主', 'name'],
    platform:  ['平台', '渠道', 'platform'],
    homepage:  ['主页链接', '主页', '链接', 'url', 'homepage'],
    followers: ['粉丝量', '粉丝数', '粉丝', 'followers', 'fans'],
    category:  ['达人类型', '类型', '类目', '方向', 'category'],
    notes:     ['备注', '说明', '报价', 'notes', 'remark'],
  };

  function fuzzyMapping(headers) {
    const map = {};
    COLUMNS.forEach(col => {
      let pick = headers.find(h => h === col.header);
      if (!pick) {
        const aliases = ALIASES[col.key] || [];
        pick = headers.find(h => aliases.some(a => h === a || h.toLowerCase() === a.toLowerCase()));
      }
      if (!pick) pick = headers.find(h => h.includes(col.header) || col.header.includes(h));
      if (!pick) {
        const aliases = ALIASES[col.key] || [];
        pick = headers.find(h => aliases.some(a => h.toLowerCase().includes(a.toLowerCase())));
      }
      map[col.key] = pick || null;
    });
    return map;
  }

  function validateRow(rawRow, mapping, headers) {
    const errors = [];
    const out = {};
    const get = key => {
      const hdr = mapping[key];
      if (!hdr) return '';
      const idx = headers.indexOf(hdr);
      return idx >= 0 ? rawRow[idx] : '';
    };
    const name = String(get('name') || '').trim();
    if (!name) errors.push('达人名不能为空');
    else out.name = name;
    out.platform = String(get('platform') || '').trim();
    out.homepage = String(get('homepage') || '').trim();
    if (out.homepage && !/^https?:\/\//i.test(out.homepage)) {
      errors.push('主页链接需以 http(s):// 开头');
    }
    const fansRaw = get('followers');
    if (fansRaw !== '' && fansRaw !== undefined && fansRaw !== null) {
      // 支持 "38万" / "380000" / "38.0万"
      const s = String(fansRaw).replace(/[,，\s]/g, '').trim();
      const wanMatch = s.match(/^([\d.]+)\s*万$/);
      if (wanMatch) {
        out.followers = Math.round(Number(wanMatch[1]) * 10000);
      } else {
        const n = Number(s);
        if (Number.isFinite(n) && n >= 0) out.followers = n;
        else errors.push(`粉丝量「${fansRaw}」无效`);
      }
    } else {
      out.followers = null;
    }
    out.category = String(get('category') || '').trim();
    out.notes = String(get('notes') || '').trim();
    return { parsed: out, errors };
  }

  /* ------------------------- 模板 + 导出 ------------------------- */
  function buildTemplate() {
    const headers = COLUMNS.map(c => c.header);
    const example = COLUMNS.map(c => c.example);
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '达人库');
    const help = [
      ['字段',     '是否必填', '说明'],
      ['达人名',   '是',       '同名同平台会被识别为同一达人；冲突可选跳过/覆盖/仅填空'],
      ['平台',     '否',       '抖音 / 小红书 / B站 / 视频号 等'],
      ['主页链接', '否',       '需以 http:// 或 https:// 开头'],
      ['粉丝量',   '否',       '数字或"38万"格式，万元转算'],
      ['达人类型', '否',       '弹唱 / 弹奏 / 生活 等（同字典）'],
      ['备注',     '否',       '联系人 / 报价 / 合作历史等'],
    ];
    const wsHelp = XLSX.utils.aoa_to_sheet(help);
    wsHelp['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, '填写说明');
    return wb;
  }

  function exportToWorkbook(kols) {
    const data = [COLUMNS.map(c => c.header)];
    kols.forEach(k => {
      data.push(COLUMNS.map(c => {
        if (c.key === 'followers') return k.followers != null ? k.followers : '';
        return k[c.key] != null ? k[c.key] : '';
      }));
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '达人库');
    return wb;
  }

  window.KolsExcel = { COLUMNS, parseFile, fuzzyMapping, validateRow, buildTemplate, exportToWorkbook };

  /* ===================================================================
   * 导入对话框（单 modal，简化版：上传 → 自动解析 → 预览 → 执行）
   * =================================================================== */
  const state = {
    open: false,
    file: null, headers: [], rawRows: [], mapping: {}, parsedRows: [],
    conflictStrategy: 'skip',
    executing: false, result: null,
  };

  function ensureNode() {
    if (document.getElementById('kols-import-overlay')) return;
    const o = document.createElement('div');
    o.id = 'kols-import-overlay';
    o.className = 'sched-import-overlay';
    o.addEventListener('click', e => { if (e.target === o && !state.executing) closeImport(); });
    o.innerHTML = `
      <div class="sched-import-panel" style="width:760px">
        <div class="sched-import-header">
          <div style="font-weight:600;font-size:1.05rem">📥 导入达人库</div>
          <button class="sched-drawer-close" onclick="KolsImportExport.closeImport()">×</button>
        </div>
        <div class="sched-import-body" id="__ki-body__"></div>
        <div class="sched-import-footer" id="__ki-footer__"></div>
      </div>
    `;
    document.body.appendChild(o);
  }

  function openImport() {
    ensureNode();
    state.open = true;
    state.file = null; state.headers = []; state.rawRows = [];
    state.mapping = {}; state.parsedRows = [];
    state.conflictStrategy = 'skip';
    state.executing = false; state.result = null;
    paint();
    requestAnimationFrame(() => document.getElementById('kols-import-overlay').classList.add('open'));
  }

  function closeImport() {
    state.open = false;
    const o = document.getElementById('kols-import-overlay');
    if (o) o.classList.remove('open');
    if (state.result && (state.result.success || state.result.overwritten)) {
      window.KolsPage && KolsPage.render();
    }
  }

  function paint() {
    const body = document.getElementById('__ki-body__');
    const footer = document.getElementById('__ki-footer__');
    if (state.result) {
      // 完成态
      const r = state.result;
      body.innerHTML = `
        <div class="sched-import-progress">
          <div style="font-size:2rem">✅</div>
          <div style="font-size:1.05rem;font-weight:600;margin-top:6px">导入完成</div>
        </div>
        <div class="sched-import-result-card">
          <div class="sched-import-result-stats">
            <div>✓ 新增：<b style="color:var(--success)">${r.success}</b></div>
            <div>↻ 覆盖/填空：<b style="color:var(--primary)">${r.overwritten || 0}</b></div>
            <div>⊝ 跳过：<b>${r.skipped}</b></div>
            ${r.failed ? `<div>✗ 失败：<b style="color:var(--danger)">${r.failed}</b></div>` : ''}
          </div>
          ${(r.errors && r.errors.length) ? `
            <details><summary style="cursor:pointer;color:var(--danger);font-size:.85rem">查看 ${r.errors.length} 条失败原因</summary>
              <div style="max-height:200px;overflow:auto;background:#fff;border:1px solid var(--border);padding:8px;margin-top:6px;font-size:.78rem">
                ${r.errors.slice(0,50).map(e => `<div>行 ${e.row}：${escapeHtml(e.error)}</div>`).join('')}
              </div>
            </details>` : ''}
        </div>
      `;
      footer.innerHTML = `<div class="spacer" style="flex:1"></div><button class="btn btn-primary btn-sm" onclick="KolsImportExport.closeImport()">完成</button>`;
      return;
    }
    if (!state.file) {
      // 上传态
      body.innerHTML = `
        <div class="sched-import-drop" id="__ki-drop__">
          <div class="icon">📂</div>
          <div class="title">点击或拖拽 Excel 文件到此处</div>
          <div class="sub">支持 .xlsx / .xls / .csv · 上限 5MB</div>
          <input type="file" id="__ki-file__" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div style="text-align:center">
          <span class="sched-import-template-link" onclick="KolsImportExport.downloadTemplate()">
            📄 下载导入模板
          </span>
        </div>
      `;
      footer.innerHTML = `<div class="spacer" style="flex:1"></div><button class="btn btn-secondary btn-sm" onclick="KolsImportExport.closeImport()">取消</button>`;
      bindUpload();
      return;
    }
    // 预览态
    const total = state.parsedRows.length;
    const errs = state.parsedRows.filter(r => r.errors.length).length;
    const ok = total - errs;
    body.innerHTML = `
      <div class="sched-import-preview-stats">
        <div class="stat">📂 ${escapeHtml(state.file.name)}</div>
        <div class="stat">总行数：<b>${total}</b></div>
        <div class="stat ok">校验通过：<b>${ok}</b></div>
        ${errs ? `<div class="stat err">有错误：<b>${errs}</b></div>` : ''}
      </div>
      <div class="sched-import-strategy">
        <strong>冲突策略</strong><span style="color:var(--text-muted);font-size:.78rem">（同名 + 同平台视为冲突）</span>
        <div style="margin-top:8px">
          <label><input type="radio" name="__ki-strat__" value="skip" ${state.conflictStrategy==='skip'?'checked':''}> 跳过</label>
          <label><input type="radio" name="__ki-strat__" value="overwrite" ${state.conflictStrategy==='overwrite'?'checked':''}> 覆盖</label>
          <label><input type="radio" name="__ki-strat__" value="fillEmpty" ${state.conflictStrategy==='fillEmpty'?'checked':''}> 仅填空字段</label>
        </div>
      </div>
      <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:4px">
        <table class="sched-import-preview-table">
          <thead><tr>
            <th>#</th><th>达人名</th><th>平台</th><th>主页</th><th>粉丝量</th><th>类型</th><th>备注</th>
          </tr></thead>
          <tbody>${state.parsedRows.slice(0,200).map((r,i)=>renderPreviewRow(r,i)).join('')}</tbody>
        </table>
        ${total>200?`<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:.78rem">仅显示前 200 行，实际将导入 ${total} 行</div>`:''}
      </div>
    `;
    footer.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="KolsImportExport.reset()">← 重新上传</button>
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-secondary btn-sm" onclick="KolsImportExport.closeImport()">取消</button>
      <button class="btn btn-primary btn-sm" ${ok?'':'disabled'} onclick="KolsImportExport.execute()">开始导入（${ok} 行）</button>
    `;
    document.querySelectorAll('input[name="__ki-strat__"]').forEach(r =>
      r.addEventListener('change', e => state.conflictStrategy = e.target.value));
  }

  function renderPreviewRow(r, i) {
    const cls = r.errors.length ? 'err' : '';
    const p = r.parsed;
    return `
      <tr class="${cls}">
        <td>${i+1}${r.errors.length?`<span class="err-msg">⚠ ${escapeHtml(r.errors.join('；'))}</span>`:''}</td>
        <td>${escapeHtml(p.name || '—')}</td>
        <td>${escapeHtml(p.platform || '—')}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.homepage || '—')}</td>
        <td>${p.followers != null ? (p.followers >= 10000 ? (p.followers/10000).toFixed(1)+'万' : p.followers) : '—'}</td>
        <td>${escapeHtml(p.category || '—')}</td>
        <td>${escapeHtml((p.notes||'').slice(0,30))}</td>
      </tr>
    `;
  }

  function bindUpload() {
    const drop = document.getElementById('__ki-drop__');
    const fi = document.getElementById('__ki-file__');
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
      window.toast && window.toast('文件超过 5MB 限制', 'error');
      return;
    }
    state.file = file;
    try {
      const { headers, rows } = await parseFile(file);
      state.headers = headers;
      state.rawRows = rows;
      state.mapping = fuzzyMapping(headers);
      state.parsedRows = rows.map(raw => validateRow(raw, state.mapping, headers));
      paint();
    } catch (e) {
      window.toast && window.toast('解析失败：' + e.message, 'error');
      state.file = null;
    }
  }

  function reset() {
    state.file = null; state.parsedRows = []; state.headers = []; state.rawRows = []; state.mapping = {};
    paint();
  }

  function execute() {
    const items = state.parsedRows.filter(r => !r.errors.length).map(r => r.parsed);
    const r = SD.batchImportKols(items, { conflictStrategy: state.conflictStrategy });
    // 把解析阶段失败的也算进 result
    const parseErrors = state.parsedRows
      .map((row, idx) => row.errors.length ? { row: idx + 1, error: row.errors.join('；') } : null)
      .filter(Boolean);
    r.failed += parseErrors.length;
    r.errors = parseErrors.concat(r.errors);
    state.result = r;
    paint();
    window.toast && window.toast(`导入完成：新增 ${r.success} · 覆盖 ${r.overwritten} · 跳过 ${r.skipped} · 失败 ${r.failed}`, 'success');
  }

  function downloadTemplate() {
    const wb = buildTemplate();
    XLSX.writeFile(wb, '达人库导入模板.xlsx');
  }

  /* ------------------------- 导出 ------------------------- */
  function doExport() {
    const list = SD.listKols();
    if (!list.length) {
      window.toast && window.toast('达人库为空，没有可导出的内容', 'info');
      return;
    }
    const wb = exportToWorkbook(list);
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
    XLSX.writeFile(wb, `达人库_${stamp}_${list.length}人.xlsx`);
    window.toast && window.toast(`已导出 ${list.length} 位达人`, 'success');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  window.KolsImportExport = { openImport, closeImport, doExport, downloadTemplate, reset, execute };
  console.log('[KolsExcel] 已就绪');
})();
