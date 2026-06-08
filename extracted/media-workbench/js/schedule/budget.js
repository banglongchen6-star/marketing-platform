/* =====================================================================
 * 达人营销 · 内容排期模块 · 月度规划表 (Phase 4 v2)
 *
 * 按达人类型逐行展示。
 * 每月独立数据（默认空），行 key 改用 id（budget 行主键）。
 *
 * 暴露：window.BudgetTable = { render(year, month), refresh() }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[BudgetTable] ScheduleData 未就绪'); return; }

  const state = {
    year: 0,
    month: 0,
    editing: null,      // { id, field } — 用预算行 id 作 key
    addDirOpen: false,  // "+ 添加达人类型" 浮层
  };

  /* ========================= 1. 入口 ========================= */
  function render(year, month) {
    state.year = year;
    state.month = month;
    state.editing = null;
    state.addDirOpen = false;
    paint();
  }
  function refresh() { paint(); }

  function paint() {
    const host = document.getElementById('sched-budget-host');
    if (!host) return;
    const winY = window.scrollY; // 保留滚动位置，避免填预算后跳回顶部
    const data = SD.getMonthlyBudgetRows(state.year, state.month);
    host.innerHTML = `
      <div class="sched-budget-card">
        ${renderHeader(data)}
        ${renderTable(data)}
      </div>
    `;
    bindHandlers();
    if (winY) requestAnimationFrame(() => window.scrollTo(0, winY));
  }

  function renderHeader(data) {
    const totalWan = (data.total.budget / 10000);
    const gapWan   = (data.total.gap / 10000);
    const gapClass = gapWan >= 0 ? 'sched-budget-gap-pos' : 'sched-budget-gap-neg';
    return `
      <div class="sched-budget-header">
        <div class="sched-budget-title">
          📋 ${state.year} 年 ${state.month} 月规划表
          <small>${data.rows.length} 行 · 总预算 ¥${totalWan.toFixed(1)} 万
            · 实际 ¥${(data.total.spent/10000).toFixed(1)} 万
            · 缺口 <span class="${gapClass}">¥${gapWan.toFixed(1)} 万</span></small>
        </div>
        <div class="sched-budget-actions">
          <button class="btn btn-secondary btn-sm" onclick="BudgetTable._copyLastMonth()">📥 复制上月预算</button>
        </div>
      </div>
    `;
  }

  /* ========================= 2. 主表（按类型分组 + rowspan） ========================= */
  function renderTable(data) {
    const rows = data.rows; // 每行含 { id, category, budgetAmount, ... }

    // 每个达人类型一行
    const bodyHtml = rows.map(r => `
      <tr data-id="${escapeAttr(r.id)}">
        <td style="vertical-align:middle;padding:8px 10px;background:#fafbfd;text-align:center">
          <div style="font-weight:600;font-size:.88rem;color:var(--text-primary);margin-bottom:6px">
            ${escapeHtml(r.category)}
          </div>
          <button class="sched-budget-del" title="删除该达人类型"
                  onclick="BudgetTable._deleteRow('${escapeAttr(r.id)}')">🗑</button>
        </td>
        ${renderDataCells(r)}
      </tr>
    `).join('');

    /* "+ 添加达人类型" 行 */
    const addCatRow = `
      <tr class="sched-add-dir-row">
        <td colspan="9" style="position:relative">
          <button class="sched-add-dir-trigger" onclick="BudgetTable._toggleAddDir(event)">
            ＋ 添加达人类型
          </button>
          ${state.addDirOpen ? renderAddDirPop() : ''}
        </td>
      </tr>
    `;

    /* 合计行 */
    const totalRow = `
      <tr class="sched-budget-total-row">
        <td>合计</td>
        <td></td><td></td>
        <td>¥${(data.total.budget/10000).toFixed(1)} 万</td>
        <td>${data.total.target || '—'}</td>
        <td></td><td></td>
        <td>${(data.total.spent/10000).toFixed(1)} 万 · ${data.total.count} 条</td>
        <td><span class="${data.total.gap>=0?'sched-budget-gap-pos':'sched-budget-gap-neg'}">
          ¥${(data.total.gap/10000).toFixed(1)} 万</span></td>
      </tr>
    `;

    return `
      <table class="sched-budget-table">
        <colgroup>
          <col style="width:100px"><!-- 达人类型 -->
          <col style="width:90px"> <!-- 产品线 -->
          <col style="width:80px"> <!-- 平台 -->
          <col style="width:80px"> <!-- 预算 -->
          <col style="width:58px"> <!-- 目标数 -->
          <col style="width:90px"> <!-- 功能展示 -->
          <col style="width:110px"><!-- 要求 -->
          <col style="width:100px"><!-- 预估排期 -->
          <col style="width:80px"> <!-- 缺口 -->
        </colgroup>
        <thead>
          <tr>
            <th>达人类型</th>
            <th>产品线</th>
            <th>平台</th>
            <th>预算（万）</th>
            <th>目标数</th>
            <th>功能展示</th>
            <th>要求</th>
            <th>预估排期（万/条）</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          ${bodyHtml || `<tr><td colspan="9" class="sched-empty" style="padding:32px">
            本月暂无规划数据，点击下方「添加达人类型」开始</td></tr>`}
          ${addCatRow}
          ${totalRow}
        </tbody>
      </table>
    `;
  }

  /* ========================= 3. 单行数据格渲染 ========================= */
  function renderDataCells(r) {
    const id = r.id;
    const gapClass = r.gap >= 0 ? 'sched-budget-gap-pos' : 'sched-budget-gap-neg';
    const budgetWan = r.budgetAmount ? (r.budgetAmount / 10000) : 0;
    return `
      <td>${productCell(id, r.productLine)}</td>
      <td>${platformCell(id, r.platform)}</td>
      <td>${cell(id, 'budget',       budgetWan ? budgetWan.toFixed(1) : '', budgetWan ? budgetWan.toFixed(1) : '—')}</td>
      <td>${cell(id, 'target',       r.targetCount ?? '', r.targetCount != null ? r.targetCount : '—')}</td>
      <td>${cell(id, 'function',     r.functionDisplay, r.functionDisplay || '—')}</td>
      <td>${cell(id, 'requirements', r.requirements,    r.requirements    || '—')}</td>
      <td>
        <div class="sched-budget-cell readonly sched-budget-actual">
          ${(r.actualSpent/10000).toFixed(1)} 万
          <span style="color:var(--text-muted);font-weight:400;font-size:.78rem"> · ${r.actualCount} 条</span>
        </div>
      </td>
      <td>
        <div class="sched-budget-cell readonly">
          <span class="${gapClass}">${r.gap >= 0
            ? '¥'+(r.gap/10000).toFixed(1)+' 万'
            : '-¥'+(-r.gap/10000).toFixed(1)+' 万'
          }</span>
        </div>
      </td>
    `;
    /* 注意：没有单行删除按钮（删除统一用达人类型格里的 🗑，或者用下面的 _deleteRow 方法） */
    /* 如需单行删除：在上面添加 <td><button onclick="_deleteRow(id)">🗑</button></td> */
  }


  /* ---- 产品线（多选浮层） ---- */
  function productCell(id, current) {
    const isEditing = state.editing && state.editing.id === id && state.editing.field === 'product';
    const selected = String(current || '').split(',').map(s => s.trim()).filter(Boolean);
    const allLines = SD.listProductLines ? SD.listProductLines() : [];
    if (isEditing) {
      return `
        <div style="position:relative;padding:6px 8px">
          <div style="display:flex;flex-wrap:wrap;gap:3px;min-height:22px">
            ${selected.length
              ? selected.map(n => `<span class="sched-card-chip" style="background:rgba(124,58,237,.1);color:#6d28d9;font-size:.7rem">${escapeHtml(n)}</span>`).join('')
              : '<span style="color:var(--text-muted);font-size:.7rem">未选</span>'}
          </div>
          <div class="sched-product-multi-pop" id="__prod-multi-pop__">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:6px">勾选多个产品线（自动保存）</div>
            ${allLines.map(p => `
              <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:.82rem">
                <input type="checkbox" value="${escapeAttr(p.name)}" ${selected.includes(p.name) ? 'checked' : ''}
                       onchange="BudgetTable._toggleProduct('${escapeAttr(id)}', this.value, this.checked)">
                <span>${escapeHtml(p.name)}</span>
              </label>
            `).join('')}
            <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:6px;text-align:right">
              <button class="btn btn-secondary btn-sm" style="font-size:.72rem" onclick="BudgetTable._closeProductPop()">关闭</button>
            </div>
          </div>
        </div>
      `;
    }
    const cls = selected.length ? 'sched-budget-cell editable' : 'sched-budget-cell editable muted';
    const display = selected.length
      ? selected.map(n => `<span class="sched-card-chip" style="background:rgba(124,58,237,.1);color:#6d28d9;font-size:.68rem;margin-right:2px">${escapeHtml(n)}</span>`).join('')
      : '—';
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(id)}','product')" style="text-align:left">${display}</button>`;
  }

  /* 产品线多选勾选切换（id 版） */
  function _toggleProduct(id, name, checked) {
    const data = SD.getMonthlyBudgetRows(state.year, state.month);
    const row  = data.rows.find(r => r.id === id);
    if (!row) return;
    const cur = String(row.productLine || '').split(',').map(s => s.trim()).filter(Boolean);
    const next = checked ? [...new Set([...cur, name])] : cur.filter(x => x !== name);
    try {
      SD.updateBudgetById(id, { product_line: next.join(', ') });
      state.editing = { id, field: 'product' };
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }
  function _closeProductPop() { state.editing = null; paint(); }

  /* ---- 平台（字典下拉） ---- */
  function platformCell(id, current) {
    const isEditing = state.editing && state.editing.id === id && state.editing.field === 'platform';
    const allPlats = SD.listPlatforms ? SD.listPlatforms() : [];
    if (isEditing) {
      const opts = ['<option value="">(空)</option>']
        .concat(allPlats.map(p =>
          `<option value="${escapeAttr(p.name)}" ${p.name === current ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
        ));
      const extra = current && !allPlats.some(p => p.name === current)
        ? `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}（自由值）</option>` : '';
      return `<select class="sched-budget-cell-input"
                data-id="${escapeAttr(id)}" data-field="platform"
                onchange="BudgetTable._saveCell(this)"
                onblur="BudgetTable._saveCell(this)"
                autofocus>${opts.join('')}${extra}</select>`;
    }
    const cls = current ? 'sched-budget-cell editable' : 'sched-budget-cell editable muted';
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(id)}','platform')">${escapeHtml(current || '—')}</button>`;
  }

  /* ---- 通用文本/数字单元格 ---- */
  function cell(id, field, rawValue, displayValue) {
    const isEditing = state.editing && state.editing.id === id && state.editing.field === field;
    if (isEditing) {
      const type = (field === 'budget' || field === 'target') ? 'number' : 'text';
      const step = field === 'budget' ? '0.1' : (field === 'target' ? '1' : '');
      const min  = (field === 'budget' || field === 'target') ? '0' : '';
      return `<input class="sched-budget-cell-input" type="${type}" step="${step}" min="${min}"
                value="${escapeAttr(rawValue)}"
                data-id="${escapeAttr(id)}" data-field="${field}"
                onblur="BudgetTable._saveCell(this)"
                onkeydown="BudgetTable._cellKey(event, this)"
                autofocus>`;
    }
    const cls = (displayValue === '—') ? 'sched-budget-cell editable muted' : 'sched-budget-cell editable';
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(id)}','${field}')">${escapeHtml(String(displayValue))}</button>`;
  }

  /* ========================= 5. 内联编辑（id 版） ========================= */
  function _editCell(id, field) {
    state.editing = { id, field };
    paint();
    requestAnimationFrame(() => {
      const inp = document.querySelector('.sched-budget-cell-input');
      if (inp) { inp.focus(); try { inp.select(); } catch(e){} }
    });
  }

  function _cellKey(e, el) {
    if (e.key === 'Enter')  { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') { state.editing = null; paint(); }
  }

  function _saveCell(inp) {
    if (!state.editing) return;
    const { id, field } = state.editing;
    const raw = inp.value;
    state.editing = null;
    const patch = {};
    try {
      if (field === 'budget') {
        const wan = raw === '' ? 0 : Number(raw);
        if (isNaN(wan) || wan < 0) throw new Error('预算必须为非负数');
        patch.budget_amount = Math.round(wan * 10000);
      } else if (field === 'target') {
        if (raw === '') patch.target_count = null;
        else {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 0) throw new Error('目标数必须为非负整数');
          patch.target_count = n;
        }
      } else if (field === 'product') {
        patch.product_line = String(raw || '').trim();
      } else if (field === 'platform') {
        patch.platform = String(raw || '').trim();
      } else if (field === 'function') {
        patch.function_display = String(raw || '');
      } else if (field === 'requirements') {
        patch.requirements = String(raw || '');
      }
      SD.updateBudgetById(id, patch);
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
      paint();
    }
  }

  /* ========================= 6. 删除 ========================= */
  /* 删除该达人类型的预算行 */
  function _deleteRow(id) {
    if (!confirm('确认删除该达人类型的预算配置？')) return;
    try { SD.deleteBudget(id); paint(); }
    catch (e) { window.toast && window.toast(e.message, 'error'); }
  }

  /* ========================= 7. 复制上月预算 ========================= */
  function _copyLastMonth() {
    if (!confirm(`将 ${prevLabel()} 的预算配置复制到 ${state.year} 年 ${state.month} 月？\n（已存在的行不会被覆盖）`)) return;
    const r = SD.copyBudgetsFromLastMonth(state.year, state.month);
    if (r.copied === 0) {
      window.toast && window.toast(r.total === 0 ? '上月无预算可复制' : '上月预算行均已存在，无需复制', 'info');
    } else {
      window.toast && window.toast(`已复制 ${r.copied} 行预算`, 'success');
    }
    paint();
  }
  function prevLabel() {
    const p = SD.prevMonth(state.year, state.month);
    return `${p.year} 年 ${p.month} 月`;
  }

  /* ========================= 8. 「+ 添加达人类型」浮层 ========================= */
  function _toggleAddDir(ev) {
    if (ev) ev.stopPropagation();
    state.addDirOpen = !state.addDirOpen;
    paint();
    if (state.addDirOpen) {
      setTimeout(() => {
        const inp = document.getElementById('__add-dir-search__');
        inp && inp.focus();
        document.addEventListener('click', _outsideAddDirClose);
      }, 0);
    }
  }
  function _outsideAddDirClose(e) {
    const pop = document.querySelector('.sched-add-dir-pop');
    if (!pop) { document.removeEventListener('click', _outsideAddDirClose); return; }
    if (!pop.contains(e.target)) {
      state.addDirOpen = false;
      paint();
      document.removeEventListener('click', _outsideAddDirClose);
    }
  }

  function renderAddDirPop() {
    const all = SD.listDirections ? SD.listDirections({ includeInactive: true }) : [];
    return `
      <div class="sched-add-dir-pop">
        <div class="sched-add-dir-pop-search">
          <input id="__add-dir-search__" placeholder="搜索或键入新名称…"
                 oninput="BudgetTable._filterAddDir(this.value)">
        </div>
        <div class="sched-add-dir-pop-list" id="__add-dir-list__">
          ${renderAddDirList(all, '')}
        </div>
      </div>
    `;
  }

  function renderAddDirList(all, q) {
    /* 已存在本月规划的 category 集合 */
    const thisMonth = new Set(
      SD.getMonthlyBudgetRows(state.year, state.month).rows.map(r => r.category)
    );
    const filtered = q ? all.filter(d => d.name.toLowerCase().includes(q.toLowerCase())) : all;
    const exact = filtered.find(d => d.name === q);

    let html = filtered.map(d => {
      const added = thisMonth.has(d.name);
      if (added) {
        /* 已添加：✓ 标记 + 置灰 + 不可点击 */
        return `
          <div class="sched-add-dir-pop-item sched-add-dir-pop-item--added">
            <span style="display:flex;align-items:center;gap:6px">
              <span style="color:var(--success);font-size:.85rem">✓</span>
              ${escapeHtml(d.name)}
            </span>
            <span class="status-in">本月已有</span>
          </div>
        `;
      }
      return `
        <div class="sched-add-dir-pop-item" onclick="BudgetTable._pickDir('${escapeAttr(d.name)}')">
          <span style="display:flex;align-items:center;gap:6px">
            <span style="color:transparent;font-size:.85rem">✓</span>
            ${escapeHtml(d.name)}
          </span>
          <span style="color:var(--text-muted);font-size:.7rem">${d.is_active === false ? '已停用' : ''}</span>
        </div>
      `;
    }).join('');

    if (q && !exact) {
      html += `<div class="sched-add-dir-pop-create"
                    onclick="BudgetTable._createAndPickDir('${escapeAttr(q)}')">
                 ＋ 新建「${escapeHtml(q)}」
               </div>`;
    }
    if (!filtered.length && !q) html = '<div class="kol-selector-empty" style="padding:16px;text-align:center;color:var(--text-muted)">字典里还没有任何条目</div>';
    return html;
  }

  function _filterAddDir(q) {
    const listEl = document.getElementById('__add-dir-list__');
    if (!listEl) return;
    const all = SD.listDirections ? SD.listDirections({ includeInactive: true }) : [];
    listEl.innerHTML = renderAddDirList(all, q);
  }

  /* 选择已有类型 → 在本月创建预算行 */
  function _pickDir(name) {
    try {
      SD.upsertBudget({ year: state.year, month: state.month, category: name });
      window.toast && window.toast(`已添加「${name}」`, 'success');
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
    state.addDirOpen = false;
    paint();
  }

  /* 新建字典 + 创建预算行 */
  function _createAndPickDir(name) {
    try {
      SD.createOrReactivateDirection && SD.createOrReactivateDirection({ name });
      SD.upsertBudget({ year: state.year, month: state.month, category: name });
      window.toast && window.toast(`已新建并添加「${name}」`, 'success');
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
    state.addDirOpen = false;
    paint();
  }

  /* ========================= 9. 工具 ========================= */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function bindHandlers() { /* onclick 均挂在 DOM 上，预留扩展 */ }

  /* ========================= 10. 暴露 ========================= */
  window.BudgetTable = {
    render, refresh,
    _editCell, _saveCell, _cellKey,
    _copyLastMonth,
    _toggleAddDir, _filterAddDir, _pickDir, _createAndPickDir,
    _deleteRow,
    _toggleProduct, _closeProductPop,
  };
  console.log('[BudgetTable] 已就绪（v2 grouped）');
})();
