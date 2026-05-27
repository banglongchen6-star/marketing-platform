/* =====================================================================
 * 达人营销 · 内容排期模块 · Excel 导入向导（4 步） (Phase 6)
 *
 * 步骤：
 *   1. 上传 / 模板下载
 *   2. 字段映射（列名 → 内部字段）
 *   3. 预览 + 校验 + 选冲突策略
 *   4. 执行（分批 100/批，进度条）
 *
 * 暴露：window.ImportWizard = { open(), close() }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  const XL = window.ScheduleExcel;
  if (!SD || !XL) { console.error('[ImportWizard] 依赖未就绪'); return; }

  const state = {
    open: false,
    step: 1,                // 1..4
    file: null,
    headers: [],
    rawRows: [],            // 原始行数据（数组）
    mapping: {},            // colKey → headerName
    parsedRows: [],         // [{ parsed, errors, raw }]
    conflictStrategy: 'skip',
    executing: false,
    progress: { done: 0, total: 0 },
    result: null,           // { success, skipped, overwritten, failed, errors }
  };

  /* ------------------------- 1. DOM 骨架 ------------------------- */
  function ensureNode() {
    if (document.getElementById('sched-import-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sched-import-overlay';
    overlay.className = 'sched-import-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !state.executing) close();
    });
    overlay.innerHTML = `
      <div class="sched-import-panel">
        <div class="sched-import-header">
          <div style="font-weight:600;font-size:1.05rem">📥 Excel 导入排期</div>
          <button class="sched-drawer-close" onclick="ImportWizard.close()">×</button>
        </div>
        <div class="sched-import-steps" id="__imp-steps__"></div>
        <div class="sched-import-body" id="__imp-body__"></div>
        <div class="sched-import-footer" id="__imp-footer__"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open && !state.executing) close();
    });
  }

  /* ------------------------- 2. 入口 ------------------------- */
  function open() {
    ensureNode();
    state.open = true;
    state.step = 1;
    state.file = null;
    state.headers = [];
    state.rawRows = [];
    state.mapping = {};
    state.parsedRows = [];
    state.conflictStrategy = 'skip';
    state.executing = false;
    state.progress = { done: 0, total: 0 };
    state.result = null;
    paint();
    requestAnimationFrame(() => document.getElementById('sched-import-overlay').classList.add('open'));
  }
  function close() {
    state.open = false;
    const o = document.getElementById('sched-import-overlay');
    if (o) o.classList.remove('open');
    // 刷外部视图（若已经导入了部分数据）
    if (state.result && (state.result.success || state.result.overwritten)) {
      window.SchedulePage && SchedulePage.render();
    }
  }

  /* ------------------------- 3. 渲染 ------------------------- */
  function paint() {
    document.getElementById('__imp-steps__').innerHTML = renderSteps();
    document.getElementById('__imp-body__').innerHTML = renderBody();
    document.getElementById('__imp-footer__').innerHTML = renderFooter();
    bindBodyHandlers();
  }

  function renderSteps() {
    const steps = ['上传', '字段映射', '预览校验', '执行导入'];
    return steps.map((label, i) => {
      const n = i + 1;
      const cls = n < state.step ? 'done' : (n === state.step ? 'active' : '');
      const sep = i < steps.length - 1 ? '<div class="sched-import-step-sep"></div>' : '';
      return `
        <div class="sched-import-step ${cls}">
          <span class="num">${n < state.step ? '✓' : n}</span>
          <span>${label}</span>
        </div>
        ${sep}
      `;
    }).join('');
  }

  function renderBody() {
    if (state.step === 1) return renderStep1();
    if (state.step === 2) return renderStep2();
    if (state.step === 3) return renderStep3();
    if (state.step === 4) return renderStep4();
    return '';
  }

  /* ------------------------- Step 1: 上传 ------------------------- */
  function renderStep1() {
    return `
      <div class="sched-import-drop" id="__imp-drop__">
        <div class="icon">📂</div>
        <div class="title">${state.file ? '已选择：' + state.file.name : '点击或拖拽 Excel 文件到此处'}</div>
        <div class="sub">支持 .xlsx / .xls / .csv · 单文件上限 5MB</div>
        <input type="file" id="__imp-file__" accept=".xlsx,.xls,.csv" style="display:none">
        ${state.file ? `<div class="sub" style="margin-top:8px">${(state.file.size/1024).toFixed(1)} KB</div>` : ''}
      </div>
      <div style="text-align:center">
        <span class="sched-import-template-link" onclick="ImportWizard._downloadTemplate()">
          📄 下载导入模板（推荐先看一眼）
        </span>
      </div>
    `;
  }

  function bindStep1() {
    const drop = document.getElementById('__imp-drop__');
    const fi = document.getElementById('__imp-file__');
    if (!drop || !fi) return;
    drop.addEventListener('click', () => fi.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    fi.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) handleFile(f);
    });
  }

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      window.toast && window.toast('文件超过 5MB 限制', 'error');
      return;
    }
    state.file = file;
    paint();
  }

  /* ------------------------- Step 2: 字段映射 ------------------------- */
  function renderStep2() {
    const rows = XL.COLUMNS.map(col => {
      const options = ['<option value="">(不映射)</option>']
        .concat(state.headers.map(h => `<option value="${escapeAttr(h)}" ${state.mapping[col.key]===h?'selected':''}>${escapeHtml(h)}</option>`));
      const required = col.required ? '<span style="color:var(--danger)">*</span>' : '';
      return `
        <div class="sched-import-mapping-col">
          ${escapeHtml(col.header)} ${required}
          <small>示例：${escapeHtml(String(col.example))}</small>
        </div>
        <select data-col="${col.key}">
          ${options.join('')}
        </select>
      `;
    }).join('');
    return `
      <p style="margin-bottom:14px;color:var(--text-secondary);font-size:.88rem">
        识别到 <b>${state.headers.length}</b> 个 Excel 列、<b>${state.rawRows.length}</b> 行数据。系统已尝试自动匹配，请确认或调整：
      </p>
      <div class="sched-import-mapping">${rows}</div>
    `;
  }

  function bindStep2() {
    document.querySelectorAll('.sched-import-mapping select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const col = e.target.dataset.col;
        state.mapping[col] = e.target.value || null;
      });
    });
  }

  /* ------------------------- Step 3: 预览 + 策略 ------------------------- */
  function renderStep3() {
    const total = state.parsedRows.length;
    const errs = state.parsedRows.filter(r => r.errors.length).length;
    const ok = total - errs;
    const visibleRows = state.parsedRows.slice(0, 200);
    return `
      <div class="sched-import-preview-stats">
        <div class="stat">总行数：<b>${total}</b></div>
        <div class="stat ok">校验通过：<b>${ok}</b></div>
        ${errs ? `<div class="stat err">有错误：<b>${errs}</b></div>` : ''}
      </div>

      <div class="sched-import-strategy">
        <strong>冲突策略</strong>
        <span style="color:var(--text-muted);font-size:.78rem">（去重键：日期 + 达人名 + 达人类型）</span>
        <div style="margin-top:8px">
          <label><input type="radio" name="__strat__" value="skip" ${state.conflictStrategy==='skip'?'checked':''}> 跳过（保留已有）</label>
          <label><input type="radio" name="__strat__" value="overwrite" ${state.conflictStrategy==='overwrite'?'checked':''}> 覆盖（用导入值替换）</label>
          <label><input type="radio" name="__strat__" value="fillEmpty" ${state.conflictStrategy==='fillEmpty'?'checked':''}> 仅填空字段</label>
        </div>
      </div>

      <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:4px">
        <table class="sched-import-preview-table">
          <thead><tr>
            <th>#</th>
            <th>日期</th><th>达人名</th><th>类型</th><th>层级</th><th>费用</th>
            <th>平台</th><th>状态</th><th>备注</th>
          </tr></thead>
          <tbody>
            ${visibleRows.map((r, i) => renderPreviewRow(r, i)).join('')}
          </tbody>
        </table>
        ${total > 200 ? `<div style="padding:8px;text-align:center;color:var(--text-muted);font-size:.78rem">（仅显示前 200 行，实际将导入 ${total} 行）</div>` : ''}
      </div>
    `;
  }

  function renderPreviewRow(r, i) {
    const cls = r.errors.length ? 'err' : '';
    const p = r.parsed;
    const errSpan = r.errors.length
      ? `<span class="err-msg">⚠ ${r.errors.join('；')}</span>`
      : '';
    return `
      <tr class="${cls}">
        <td>${i + 1}${errSpan}</td>
        <td>${escapeHtml(p.schedule_date || '—')}</td>
        <td>${escapeHtml(p.kol_name || '—')}</td>
        <td>${escapeHtml(p.category_direction || '—')}</td>
        <td>${escapeHtml(p.tier || '—')}</td>
        <td>${p.amount != null ? '¥' + Number(p.amount).toLocaleString() : '—'}</td>
        <td>${escapeHtml(p.platform || '—')}</td>
        <td>${escapeHtml(XL.STATUS_TO_LABEL[p.status] || p.status || '—')}</td>
        <td>${escapeHtml((p.notes || '').slice(0, 30))}</td>
      </tr>
    `;
  }

  function bindStep3() {
    document.querySelectorAll('input[name="__strat__"]').forEach(r =>
      r.addEventListener('change', e => state.conflictStrategy = e.target.value));
  }

  /* ------------------------- Step 4: 执行 ------------------------- */
  function renderStep4() {
    if (!state.result) {
      const pct = state.progress.total ? Math.round(state.progress.done / state.progress.total * 100) : 0;
      return `
        <div class="sched-import-progress">
          <div style="font-size:1rem;font-weight:500">正在导入…</div>
          <div class="sched-import-progress-bar">
            <div class="sched-import-progress-bar-inner" style="width:${pct}%"></div>
          </div>
          <div style="color:var(--text-secondary)">${state.progress.done} / ${state.progress.total}（${pct}%）</div>
        </div>
      `;
    }
    const r = state.result;
    return `
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
          <details>
            <summary style="cursor:pointer;color:var(--danger);font-size:.85rem">查看 ${r.errors.length} 条失败原因</summary>
            <div style="max-height:200px;overflow:auto;background:#fff;border:1px solid var(--border);padding:8px;margin-top:6px;font-size:.78rem">
              ${r.errors.slice(0, 50).map(e => `<div>行 ${e.row}：${escapeHtml(e.error)}</div>`).join('')}
              ${r.errors.length > 50 ? `<div style="color:var(--text-muted)">…还有 ${r.errors.length - 50} 条</div>` : ''}
            </div>
          </details>
        ` : ''}
      </div>
    `;
  }

  /* ------------------------- 4. Footer & 步骤切换 ------------------------- */
  function renderFooter() {
    const back = state.step > 1 && state.step < 4 && !state.executing
      ? `<button class="btn btn-secondary btn-sm" onclick="ImportWizard._back()">← 上一步</button>` : '';
    const cancel = state.step < 4 || state.result
      ? `<button class="btn btn-secondary btn-sm" onclick="ImportWizard.close()">${state.result ? '关闭' : '取消'}</button>` : '';
    let next = '';
    if (state.step === 1) next = `<button class="btn btn-primary btn-sm" ${state.file?'':'disabled'} onclick="ImportWizard._toStep2()">下一步 →</button>`;
    if (state.step === 2) {
      const missingRequired = XL.COLUMNS.filter(c => c.required).some(c => !state.mapping[c.key]);
      next = `<button class="btn btn-primary btn-sm" ${missingRequired?'disabled':''} onclick="ImportWizard._toStep3()" title="${missingRequired?'必填字段未映射':''}">下一步 →</button>`;
    }
    if (state.step === 3) {
      const okCount = state.parsedRows.filter(r => !r.errors.length).length;
      next = `<button class="btn btn-primary btn-sm" ${okCount?'':'disabled'} onclick="ImportWizard._execute()">开始导入（${okCount} 行）</button>`;
    }
    if (state.step === 4 && state.result) {
      next = `<button class="btn btn-primary btn-sm" onclick="ImportWizard.close()">完成</button>`;
    }
    return `
      ${back}
      <div class="spacer"></div>
      ${cancel}
      ${next}
    `;
  }

  function bindBodyHandlers() {
    if (state.step === 1) bindStep1();
    if (state.step === 2) bindStep2();
    if (state.step === 3) bindStep3();
  }

  /* ------------------------- 5. 步骤动作 ------------------------- */
  async function _toStep2() {
    try {
      window.toast && window.toast('正在解析文件…', 'info');
      const { headers, rows } = await XL.parseFile(state.file);
      if (!headers.length) { window.toast && window.toast('未识别到表头', 'error'); return; }
      state.headers = headers;
      state.rawRows = rows;
      state.mapping = XL.fuzzyMapping(headers);
      state.step = 2;
      paint();
    } catch (e) {
      window.toast && window.toast('解析失败：' + e.message, 'error');
    }
  }

  function _toStep3() {
    // 整体校验
    const contextYear = new Date().getFullYear();
    state.parsedRows = state.rawRows.map(raw => {
      const result = XL.validateRow(raw, state.mapping, state.headers, contextYear);
      return { parsed: result.parsed, errors: result.errors, raw };
    });
    state.step = 3;
    paint();
  }

  function _back() {
    if (state.step > 1) state.step--;
    paint();
  }

  /* 分批执行：每批 100 条，requestAnimationFrame 让进度条更新 */
  async function _execute() {
    const goodRows = state.parsedRows.filter(r => !r.errors.length).map(r => r.parsed);
    state.step = 4;
    state.executing = true;
    state.result = null;
    state.progress = { done: 0, total: goodRows.length };
    paint();

    const BATCH = 100;
    const aggregate = { success: 0, skipped: 0, overwritten: 0, failed: 0, errors: [] };
    // 收集原始解析行里的错误也算入 failed
    state.parsedRows.forEach((r, idx) => {
      if (r.errors.length) {
        aggregate.failed++;
        aggregate.errors.push({ row: idx + 1, error: r.errors.join('；') });
      }
    });

    for (let i = 0; i < goodRows.length; i += BATCH) {
      const batch = goodRows.slice(i, i + BATCH);
      const r = SD.batchCreateSchedules(batch, { conflictStrategy: state.conflictStrategy });
      aggregate.success += r.success;
      aggregate.skipped += r.skipped;
      aggregate.overwritten += r.overwritten;
      // 子批的 failed 加进来
      aggregate.failed += r.failed;
      r.errors.forEach(e => aggregate.errors.push({ row: i + e.row, error: e.error }));
      state.progress.done = Math.min(i + BATCH, goodRows.length);
      paint();
      await new Promise(r => setTimeout(r, 30)); // 给 UI 喘息
    }

    state.executing = false;
    state.result = aggregate;
    SD.recordImportLog({
      filename: state.file?.name || '',
      total_rows: state.parsedRows.length,
      success_count: aggregate.success + aggregate.overwritten,
      skipped_count: aggregate.skipped,
      failed_count: aggregate.failed,
      errors: aggregate.errors.slice(0, 100),
    });
    paint();
    window.toast && window.toast(`导入完成：新增 ${aggregate.success}，覆盖 ${aggregate.overwritten}，跳过 ${aggregate.skipped}，失败 ${aggregate.failed}`, 'success');
  }

  function _downloadTemplate() {
    const wb = XL.buildTemplate();
    XLSX.writeFile(wb, '排期导入模板.xlsx');
  }

  /* ------------------------- 6. 工具 ------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ------------------------- 7. 暴露 ------------------------- */
  window.ImportWizard = {
    open, close,
    _toStep2, _toStep3, _back, _execute, _downloadTemplate,
  };
  console.log('[ImportWizard] 已就绪');
})();
