/* =====================================================================
 * 达人营销 · 内容排期模块 · 月度规划表 (Phase 4)
 *
 * 三层 JOIN：字典（行底） + 预算（计划层） + 排期（实际层）
 * 实际数据由 ScheduleData.getMonthlyBudgetRows() 一次性返回。
 *
 * 暴露：
 *   window.BudgetTable = { render(year, month), refresh() }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[BudgetTable] ScheduleData 未就绪'); return; }

  const state = {
    year: 0,
    month: 0,
    editing: null,   // { rowId, field } — 当前正在编辑哪个单元格
    addDirOpen: false,
    view: 'category', // 'category' | 'product' | 'tier' | 'bd' — 汇总维度
  };

  const VIEW_LABEL = { category: '按达人类型', bd: '按商务BD' };

  /* ------------------------- 1. 入口 ------------------------- */
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
    const data = SD.getMonthlyBudgetRows(state.year, state.month);
    let table = '';
    if (state.view === 'category') table = renderTable(data);
    else if (state.view === 'product') table = renderGroupedTable(data, 'product');
    else if (state.view === 'tier') table = renderTierTable();
    else if (state.view === 'bd') table = renderBdTable();
    host.innerHTML = `
      <div class="sched-budget-card">
        ${renderHeader(data)}
        ${table}
      </div>
    `;
    bindHandlers();
  }

  /* 视图切换按钮组 */
  function renderViewSwitcher() {
    return Object.entries(VIEW_LABEL).map(([k, label]) => `
      <button class="sched-view-btn ${state.view===k?'active':''}"
              onclick="BudgetTable._setView('${k}')">
        ${escapeHtml(label)}
      </button>
    `).join('');
  }
  function _setView(v) {
    if (!VIEW_LABEL[v]) return;
    state.view = v;
    state.editing = null;
    paint();
  }

  function renderHeader(data) {
    const totalBudgetWan = (data.total.budget / 10000);
    const gapWan = (data.total.gap / 10000);
    const gapClass = gapWan >= 0 ? 'sched-budget-gap-pos' : 'sched-budget-gap-neg';
    return `
      <div class="sched-budget-header">
        <div class="sched-budget-title">
          📋 ${state.year} 年 ${state.month} 月规划表
          <small>${data.rows.length} 个达人类型 · 总预算 ¥${totalBudgetWan.toFixed(1)} 万
            · 实际 ¥${(data.total.spent/10000).toFixed(1)} 万
            · 缺口 <span class="${gapClass}">¥${gapWan.toFixed(1)} 万</span></small>
        </div>
        <div class="sched-budget-actions">
          <div class="sched-view-switcher">${renderViewSwitcher()}</div>
          <button class="btn btn-secondary btn-sm" onclick="BudgetTable._copyLastMonth()">📥 复制上月预算</button>
        </div>
      </div>
    `;
  }

  function renderTable(data) {
    const rows = data.rows;
    const totalBudget = data.total.budget;
    const totalSpent = data.total.spent;
    const totalGap = data.total.gap;
    const totalTarget = data.total.target;
    const totalCount = data.total.count;

    const bodyRows = rows.map(renderRow).join('');
    const addRow = `
      <tr class="sched-add-dir-row">
        <td colspan="10" style="position:relative">
          <button class="sched-add-dir-trigger" onclick="BudgetTable._toggleAddDir(event)">
            ＋ 添加达人类型到规划表
          </button>
          ${state.addDirOpen ? renderAddDirPop() : ''}
        </td>
      </tr>
    `;
    const totalRow = `
      <tr class="sched-budget-total-row">
        <td>合计</td>
        <td></td>
        <td></td>
        <td>¥${(totalBudget/10000).toFixed(1)} 万</td>
        <td>${totalTarget || '—'}</td>
        <td></td>
        <td></td>
        <td>${(totalSpent/10000).toFixed(1)} 万 · ${totalCount} 条</td>
        <td><span class="${totalGap>=0?'sched-budget-gap-pos':'sched-budget-gap-neg'}">¥${(totalGap/10000).toFixed(1)} 万</span></td>
        <td></td>
      </tr>
    `;

    return `
      <table class="sched-budget-table">
        <colgroup>
          <col class="col-type"><col class="col-product"><col class="col-platform"><col class="col-budget">
          <col class="col-count"><col class="col-func"><col class="col-req">
          <col class="col-actual"><col class="col-gap"><col class="col-act">
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
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="9" class="sched-empty">字典里没有 active 的达人类型，请先在「字典管理」里启用</td></tr>`}
          ${addRow}
          ${totalRow}
        </tbody>
      </table>
    `;
  }

  /* ------------------------- 1.5 分组聚合视图 -------------------------
   * 按产品线聚合：以当月预算配置里的 product_line 字段为 group key。
   * 同 product_line 下所有达人类型的 budget / target / actual 合计。
   */
  function aggregateByProduct(data) {
    const groups = {};
    data.rows.forEach(r => {
      const lines = String(r.productLine || '').split(',').map(s => s.trim()).filter(Boolean);
      const keys = lines.length ? lines : ['(未指定产品线)'];
      const n = keys.length; // 多选：均摊到每个产品线
      keys.forEach(key => {
        if (!groups[key]) groups[key] = {
          groupKey: key,
          budgetAmount: 0, targetCount: 0,
          actualSpent: 0, actualCount: 0,
          categories: [],
        };
        const g = groups[key];
        g.budgetAmount += r.budgetAmount / n;
        g.targetCount += (r.targetCount || 0) / n;
        g.actualSpent += r.actualSpent / n;
        g.actualCount += r.actualCount / n;
        // 类型只在第一个 key 下记一次，避免重复显示
        if (key === keys[0]) g.categories.push({ name: r.category, isOrphan: r.isOrphan });
      });
    });
    Object.values(groups).forEach(g => {
      g.gap = g.budgetAmount - g.actualSpent;
      g.targetCount = Math.round(g.targetCount); // 取整
    });
    return Object.values(groups).sort((a, b) => {
      if (a.groupKey.startsWith('(') !== b.groupKey.startsWith('(')) {
        return a.groupKey.startsWith('(') ? 1 : -1;
      }
      return a.groupKey.localeCompare(b.groupKey);
    });
  }

  function renderGroupedTable(data, dim) {
    const groups = aggregateByProduct(data);
    if (!groups.length) {
      return `<div class="sched-empty">本月无任何排期或预算数据</div>`;
    }
    const total = groups.reduce((acc, g) => ({
      budget: acc.budget + g.budgetAmount,
      target: acc.target + g.targetCount,
      spent: acc.spent + g.actualSpent,
      count: acc.count + g.actualCount,
    }), { budget: 0, target: 0, spent: 0, count: 0 });
    const totalGap = total.budget - total.spent;
    return `
      <table class="sched-budget-table">
        <thead>
          <tr>
            <th>产品线</th>
            <th>含达人类型</th>
            <th>预算（万）</th>
            <th>目标数</th>
            <th>预估排期（万/条）</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          ${groups.map(g => {
            const gapClass = g.gap >= 0 ? 'sched-budget-gap-pos' : 'sched-budget-gap-neg';
            const cats = g.categories.map(c => `<span class="sched-card-chip direction">${escapeHtml(c.name)}</span>`).join(' ');
            return `
              <tr>
                <td><strong>${escapeHtml(g.groupKey)}</strong>
                    <span style="font-size:.72rem;color:var(--text-muted);margin-left:6px">(${g.categories.length} 类)</span></td>
                <td><div style="display:flex;flex-wrap:wrap;gap:3px;padding:6px 0">${cats}</div></td>
                <td>¥${(g.budgetAmount/10000).toFixed(1)} 万</td>
                <td>${g.targetCount || '—'}</td>
                <td>${(g.actualSpent/10000).toFixed(1)} 万 · ${g.actualCount} 条</td>
                <td><span class="${gapClass}">${g.gap >= 0 ? '¥'+(g.gap/10000).toFixed(1)+' 万' : '-¥'+(-g.gap/10000).toFixed(1)+' 万'}</span></td>
              </tr>
            `;
          }).join('')}
          <tr class="sched-budget-total-row">
            <td>合计</td>
            <td></td>
            <td>¥${(total.budget/10000).toFixed(1)} 万</td>
            <td>${total.target || '—'}</td>
            <td>${(total.spent/10000).toFixed(1)} 万 · ${total.count} 条</td>
            <td><span class="${totalGap>=0?'sched-budget-gap-pos':'sched-budget-gap-neg'}">¥${(totalGap/10000).toFixed(1)} 万</span></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  /* 按层级聚合：从 schedules 表按 tier 聚合（不来自预算配置，仅展示实际） */
  function renderTierTable() {
    const { start, end } = SD.monthRange(state.year, state.month);
    const schedules = SD.listSchedulesInRange(start, end);
    const groups = {};
    schedules.forEach(s => {
      if (s.status === 'cancelled') return;
      const key = s.tier || '(未填层级)';
      if (!groups[key]) groups[key] = { tier: key, spent: 0, count: 0 };
      groups[key].spent += Number(s.amount) || 0;
      groups[key].count += 1;
    });
    // 按字典顺序排
    const tierOrder = SD.listTiers().map(t => t.name);
    const sorted = Object.values(groups).sort((a, b) => {
      const ai = tierOrder.indexOf(a.tier);
      const bi = tierOrder.indexOf(b.tier);
      const aa = ai < 0 ? 999 : ai;
      const bb = bi < 0 ? 999 : bi;
      return aa - bb;
    });
    if (!sorted.length) {
      return `<div class="sched-empty">本月暂无非取消的排期</div>`;
    }
    const total = sorted.reduce((acc, g) => ({
      spent: acc.spent + g.spent,
      count: acc.count + g.count,
    }), { spent: 0, count: 0 });
    return `
      <div style="padding:10px 18px;font-size:.78rem;color:var(--text-muted);background:#fffbeb;border-bottom:1px solid #fde68a">
        💡 层级维度仅展示"实际花费"（来自排期数据），预算配置没有按层级切片
      </div>
      <table class="sched-budget-table view-table">
        <thead>
          <tr>
            <th>层级</th>
            <th>实际花费（万）</th>
            <th>条数</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(g => {
            const pct = total.spent ? (g.spent / total.spent * 100).toFixed(1) : 0;
            return `
              <tr>
                <td><strong>${escapeHtml(g.tier)}</strong></td>
                <td>${(g.spent/10000).toFixed(1)} 万</td>
                <td>${g.count} 条</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:8px;background:var(--bg-base);border-radius:4px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--primary) 0%,var(--purple) 100%)"></div>
                    </div>
                    <span style="font-size:.78rem;color:var(--text-secondary);min-width:40px;text-align:right">${pct}%</span>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
          <tr class="sched-budget-total-row">
            <td>合计</td>
            <td>${(total.spent/10000).toFixed(1)} 万</td>
            <td>${total.count} 条</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    `;
  }

  /* 按 BD 聚合本月排期统计（实际花费 + 各状态计数 + 待结算金额） */
  function renderBdTable() {
    const { start, end } = SD.monthRange(state.year, state.month);
    const schedules = SD.listSchedulesInRange(start, end);
    // 包括未指定 BD 的"未分配"组
    const bdList = SD.listBds({ includeInactive: true });
    const groups = {};
    bdList.forEach(b => groups[b.id] = {
      id: b.id, name: b.name, color: b.color,
      total: 0, spent: 0, count: 0,
      statusCount: { planned:0, published:0, cancelled:0 },
      pendingSettleAmt: 0,
    });
    groups['__none__'] = { id: null, name: '(未分配 BD)', color: '#94a3b8',
      total: 0, spent: 0, count: 0,
      statusCount: { planned:0, published:0, cancelled:0 },
      pendingSettleAmt: 0,
    };
    schedules.forEach(s => {
      const key = s.bd_id || '__none__';
      const g = groups[key];
      if (!g) return;
      g.total += 1;
      g.statusCount[s.status] = (g.statusCount[s.status] || 0) + 1;
      if (s.status !== 'cancelled') {
        g.spent += Number(s.amount) || 0;
        g.count += 1;
      }
      // 待结算 = 已发布但没对应 settlement 记录
      if (s.status === 'published') {
        const hasSettlement = (window.DB.settlements || []).some(st => st.schedule_id === s.id);
        if (!hasSettlement) g.pendingSettleAmt += Number(s.amount) || 0;
      }
    });
    // 过滤：active BDs + 有数据的 inactive/__none__
    const rows = [
      ...bdList.filter(b => b.is_active !== false).map(b => groups[b.id]),
      ...bdList.filter(b => b.is_active === false && groups[b.id].total > 0).map(b => groups[b.id]),
      ...(groups['__none__'].total > 0 ? [groups['__none__']] : []),
    ];
    if (!rows.length) {
      return `<div class="sched-empty" style="padding:32px 16px">字典里没有 active 的 BD，请先在「字典管理 → 商务BD」里添加</div>`;
    }
    const total = rows.reduce((acc, g) => ({
      total: acc.total + g.total,
      spent: acc.spent + g.spent,
      count: acc.count + g.count,
      pendingSettleAmt: acc.pendingSettleAmt + g.pendingSettleAmt,
    }), { total: 0, spent: 0, count: 0, pendingSettleAmt: 0 });
    return `
      <div style="padding:10px 18px;font-size:.78rem;color:var(--text-muted);background:#fffbeb;border-bottom:1px solid #fde68a">
        💡 BD 维度仅统计"实际花费"（来自排期数据）；如需配 BD 预算，建议在排期里指定 BD 后查看
      </div>
      <table class="sched-budget-table view-table">
        <thead>
          <tr>
            <th>商务 BD</th>
            <th>排期数</th>
            <th>实际花费（万）</th>
            <th>占比</th>
            <th>已发布</th>
            <th>已结算</th>
            <th>已取消</th>
            <th>待回款</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(g => {
            const pct = total.spent ? (g.spent / total.spent * 100).toFixed(1) : 0;
            return `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${g.color};flex-shrink:0"></span>
                    <strong>${escapeHtml(g.name)}</strong>
                  </div>
                </td>
                <td>${g.total}</td>
                <td>${(g.spent/10000).toFixed(1)} 万</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;min-width:60px;height:6px;background:var(--bg-base);border-radius:3px;overflow:hidden">
                      <div style="width:${pct}%;height:100%;background:${g.color}"></div>
                    </div>
                    <span style="font-size:.78rem;color:var(--text-secondary);min-width:42px;text-align:right">${pct}%</span>
                  </div>
                </td>
                <td><b style="color:var(--purple)">${g.statusCount.published || '—'}</b></td>
                <td><b style="color:var(--success)">${g.statusCount.settled || '—'}</b></td>
                <td><span style="color:var(--text-muted)">${g.statusCount.cancelled || '—'}</span></td>
                <td>${g.pendingSettleAmt > 0
                  ? `<span style="color:var(--warning);font-weight:500">¥${g.pendingSettleAmt.toLocaleString()}</span>`
                  : '<span style="color:var(--text-muted)">—</span>'}</td>
              </tr>
            `;
          }).join('')}
          <tr class="sched-budget-total-row">
            <td>合计</td>
            <td>${total.total}</td>
            <td>${(total.spent/10000).toFixed(1)} 万</td>
            <td></td>
            <td></td><td></td><td></td><td></td><td></td>
            <td>${total.pendingSettleAmt > 0 ? `¥${total.pendingSettleAmt.toLocaleString()}` : '—'}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  /* ------------------------- 2. 行渲染 ------------------------- */
  function renderRow(r) {
    const rowKey = r.category; // 用 category 名作为行 key（字典 + 孤儿都可寻址）
    const orphanCls = r.isOrphan ? 'sched-budget-row-orphan' : '';
    const orphanTag = r.isOrphan
      ? `<span class="sched-budget-orphan-tag" title="字典中无此达人类型">未在字典</span>` : '';
    const orphanAction = r.isOrphan
      ? `<button class="btn btn-link btn-sm" style="font-size:.7rem;color:var(--primary);background:none;border:none;cursor:pointer;padding:0 0 0 4px" onclick="BudgetTable._adoptOrphan('${escapeAttr(r.category)}')">加入字典</button>`
      : '';
    const gapClass = r.gap >= 0 ? 'sched-budget-gap-pos' : 'sched-budget-gap-neg';
    const budgetWan = r.budgetAmount ? (r.budgetAmount / 10000) : 0;
    return `
      <tr class="${orphanCls}" data-row="${escapeAttr(rowKey)}">
        <td>
          <div class="sched-budget-cell readonly">
            <strong>${escapeHtml(r.shortName)}</strong>
            ${orphanTag}${orphanAction}
          </div>
        </td>
        <td>${productCell(rowKey, r.productLine)}</td>
        <td>${platformCell(rowKey, r.platform)}</td>
        <td>${cell(rowKey, 'budget',   budgetWan ? budgetWan.toFixed(1) : '', budgetWan ? `${budgetWan.toFixed(1)}` : '—')}</td>
        <td>${cell(rowKey, 'target',   r.targetCount ?? '', r.targetCount != null ? r.targetCount : '—')}</td>
        <td>${cell(rowKey, 'function', r.functionDisplay, r.functionDisplay || '—')}</td>
        <td>${cell(rowKey, 'requirements', r.requirements, r.requirements || '—')}</td>
        <td>
          <div class="sched-budget-cell readonly sched-budget-actual">
            ${(r.actualSpent/10000).toFixed(1)} 万
            <span style="color:var(--text-muted);font-weight:400;font-size:.78rem"> · ${r.actualCount} 条</span>
          </div>
        </td>
        <td>
          <div class="sched-budget-cell readonly">
            <span class="${gapClass}">${r.gap >= 0 ? '¥'+(r.gap/10000).toFixed(1)+' 万' : '-¥'+(-r.gap/10000).toFixed(1)+' 万'}</span>
          </div>
        </td>
        <td>
          ${r.isOrphan ? '' : `<button class="sched-budget-del" title="删除（连带清空所有月份的排期与预算）" onclick="BudgetTable._deleteDir('${escapeAttr(r.category)}')">🗑</button>`}
        </td>
      </tr>
    `;
  }

  /** 字典型下拉单元格（产品线 / 平台 共用模板）
   *  field: 'product' | 'platform'，list: 提供字典项的函数
   */
  function dictCell(rowKey, field, current, list) {
    const isEditing = state.editing && state.editing.rowKey === rowKey && state.editing.field === field;
    if (isEditing) {
      const opts = ['<option value="">(空)</option>']
        .concat(list().map(p => `<option value="${escapeAttr(p.name)}" ${p.name===current?'selected':''}>${escapeHtml(p.name)}</option>`));
      // 老数据可能不在字典里（如"抖音 / 小红书"拼接），保留作为额外选项
      const extra = current && !list().some(p => p.name === current)
        ? `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}（自由值）</option>` : '';
      return `<select class="sched-budget-cell-input"
              data-rowkey="${escapeAttr(rowKey)}" data-field="${field}"
              onchange="BudgetTable._saveCell(this)"
              onblur="BudgetTable._saveCell(this)"
              onkeydown="BudgetTable._cellKey(event, this)"
              autofocus>${opts.join('')}${extra}</select>`;
    }
    const display = current || '—';
    const cls = current ? 'sched-budget-cell editable' : 'sched-budget-cell editable muted';
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(rowKey)}','${field}')">${escapeHtml(display)}</button>`;
  }
  /** 产品线：多选浮层（用 ", " 分隔多个值存进 product_line 字段） */
  function productCell(rowKey, current) {
    const isEditing = state.editing && state.editing.rowKey === rowKey && state.editing.field === 'product';
    const selected = String(current || '').split(',').map(s => s.trim()).filter(Boolean);
    const allLines = SD.listProductLines();
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
                <input type="checkbox" value="${escapeAttr(p.name)}" ${selected.includes(p.name)?'checked':''}
                       onchange="BudgetTable._toggleProduct('${escapeAttr(rowKey)}', this.value, this.checked)">
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
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(rowKey)}','product')" style="text-align:left">${display}</button>`;
  }
  function platformCell(rowKey, current) { return dictCell(rowKey, 'platform', current, () => SD.listPlatforms()); }

  /* 产品线多选切换 */
  function _toggleProduct(rowKey, name, checked) {
    // 读当前
    const data = SD.getMonthlyBudgetRows(state.year, state.month);
    const row = data.rows.find(r => r.category === rowKey);
    const cur = String(row?.productLine || '').split(',').map(s => s.trim()).filter(Boolean);
    let next;
    if (checked) {
      if (!cur.includes(name)) cur.push(name);
      next = cur;
    } else {
      next = cur.filter(x => x !== name);
    }
    try {
      SD.upsertBudget({
        year: state.year, month: state.month, category: rowKey,
        product_line: next.join(', '),
      });
      // 不退出编辑态（用户可能要继续勾选）
      paint();
      // paint() 把状态重置，重新 editCell
      state.editing = { rowKey, field: 'product' };
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }
  function _closeProductPop() {
    state.editing = null;
    paint();
  }

  function cell(rowKey, field, rawValue, displayValue) {
    const isEditing = state.editing && state.editing.rowKey === rowKey && state.editing.field === field;
    if (isEditing) {
      const type = (field === 'budget' || field === 'target') ? 'number' : 'text';
      const step = field === 'budget' ? '0.1' : (field === 'target' ? '1' : '');
      const min = (field === 'budget' || field === 'target') ? '0' : '';
      return `<input class="sched-budget-cell-input" type="${type}" step="${step}" min="${min}"
              value="${escapeAttr(rawValue)}"
              data-rowkey="${escapeAttr(rowKey)}" data-field="${field}"
              onblur="BudgetTable._saveCell(this)"
              onkeydown="BudgetTable._cellKey(event, this)"
              autofocus>`;
    }
    const cls = displayValue === '—' ? 'sched-budget-cell editable muted' : 'sched-budget-cell editable';
    return `<button class="${cls}" onclick="BudgetTable._editCell('${escapeAttr(rowKey)}','${field}')">${escapeHtml(String(displayValue))}</button>`;
  }

  /* ------------------------- 3. 内联编辑 ------------------------- */
  function _editCell(rowKey, field) {
    state.editing = { rowKey, field };
    paint();
    // autofocus 后让输入框 select all
    requestAnimationFrame(() => {
      const inp = document.querySelector('.sched-budget-cell-input');
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  function _cellKey(e, el) {
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    else if (e.key === 'Escape') {
      state.editing = null;
      paint();
    }
  }

  function _saveCell(inp) {
    if (!state.editing) return;
    const { rowKey, field } = state.editing;
    const raw = inp.value;
    state.editing = null;

    const patch = { year: state.year, month: state.month, category: rowKey };
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
      SD.upsertBudget(patch);
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
      paint();
    }
  }

  /* ------------------------- 4. 复制上月预算 ------------------------- */
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

  /* ------------------------- 5. 「+ 添加达人类型」浮层 ------------------------- */
  function _toggleAddDir(ev) {
    if (ev) ev.stopPropagation();
    state.addDirOpen = !state.addDirOpen;
    paint();
    if (state.addDirOpen) {
      setTimeout(() => {
        const search = document.getElementById('__add-dir-search__');
        search && search.focus();
        document.addEventListener('click', outsideAddDirClose);
      }, 0);
    }
  }
  function outsideAddDirClose(e) {
    const pop = document.querySelector('.sched-add-dir-pop');
    if (!pop) {
      document.removeEventListener('click', outsideAddDirClose);
      return;
    }
    if (!pop.contains(e.target)) {
      state.addDirOpen = false;
      paint();
      document.removeEventListener('click', outsideAddDirClose);
    }
  }
  function renderAddDirPop() {
    const all = SD.listDirections({ includeInactive: true });
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
    const filtered = q ? all.filter(d => d.name.toLowerCase().includes(q.toLowerCase())) : all;
    const exact = filtered.find(d => d.name === q);
    let html = filtered.map(d => `
      <div class="sched-add-dir-pop-item" onclick="BudgetTable._adoptDir('${d.id}','${escapeAttr(d.name)}')">
        <span>${escapeHtml(d.name)}</span>
        <span class="${d.is_active ? 'status-in' : 'status-off'}">${d.is_active ? '已在表里' : '已停用'}</span>
      </div>
    `).join('');
    if (q && !exact) {
      html += `<div class="sched-add-dir-pop-create" onclick="BudgetTable._createDir('${escapeAttr(q)}')">＋ 新建「${escapeHtml(q)}」</div>`;
    }
    if (!filtered.length && !q) html = '<div class="kol-selector-empty">字典里还没有任何条目</div>';
    return html;
  }
  function _filterAddDir(q) {
    const list = document.getElementById('__add-dir-list__');
    if (!list) return;
    const all = SD.listDirections({ includeInactive: true });
    list.innerHTML = renderAddDirList(all, q);
  }
  function _adoptDir(id, name) {
    const d = SD.listDirections({ includeInactive: true }).find(x => x.id === id);
    if (!d) return;
    if (d.is_active) {
      window.toast && window.toast(`「${d.name}」已在规划表里`, 'info');
    } else {
      SD.updateDirection(id, { is_active: true });
      window.toast && window.toast(`已启用「${d.name}」`, 'success');
    }
    state.addDirOpen = false;
    paint();
  }
  function _createDir(name) {
    try {
      const d = SD.createOrReactivateDirection({ name });
      window.toast && window.toast(`已新建「${d.name}」`, 'success');
      state.addDirOpen = false;
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }
  function _adoptOrphan(name) {
    try {
      SD.createOrReactivateDirection({ name });
      window.toast && window.toast(`已把「${name}」加入字典`, 'success');
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  /* ------------------------- 6. 删除字典（连锁清理） ------------------------- */
  function _deleteDir(name) {
    const dir = SD.findDirectionByName(name);
    if (!dir) return;
    const usage = SD.countDirectionUsage(name);
    let msg = `删除达人类型「${name}」？\n字典将被停用（软删除）。\n`;
    if (usage.schedules || usage.budgets) {
      msg += `\n⚠️ 关联数据将一并删除（不可恢复，含其他月份）：\n`;
      if (usage.schedules) msg += `  · ${usage.schedules} 条排期\n`;
      if (usage.budgets) msg += `  · ${usage.budgets} 条预算配置\n`;
    }
    if (!confirm(msg)) return;
    const cascade = usage.schedules > 0 || usage.budgets > 0;
    const r = SD.deactivateDirectionCascade(dir.id, { cascadeDeleteSchedules: cascade });
    let info = `已停用「${name}」`;
    if (r.deletedSchedules || r.deletedBudgets) {
      info += `，删除 ${r.deletedSchedules} 条排期 + ${r.deletedBudgets} 条预算`;
    }
    window.toast && window.toast(info, 'success');
    paint();
    // 排期表也要刷新（连带删了排期）
    if (window.SchedulePage && SchedulePage.render) SchedulePage.render();
  }

  /* ------------------------- 7. 工具 ------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function bindHandlers() {
    // 目前所有 onclick 都直接挂在 DOM 上，这里留作扩展点
  }

  /* ------------------------- 8. 暴露 ------------------------- */
  window.BudgetTable = {
    render, refresh,
    _editCell, _saveCell, _cellKey,
    _copyLastMonth, _setView,
    _toggleAddDir, _filterAddDir, _adoptDir, _createDir, _adoptOrphan,
    _deleteDir,
    _toggleProduct, _closeProductPop,
  };
  console.log('[BudgetTable] 已就绪');
})();
