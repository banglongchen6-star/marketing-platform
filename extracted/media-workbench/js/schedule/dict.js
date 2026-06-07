/* =====================================================================
 * 达人营销 · 内容排期模块 · 字典管理面板（Tab 化）
 *
 * 暴露：window.DictManager = { open(tab?), close }
 *
 * 两个 Tab：
 *   - 'direction' 达人类型字典（关联 schedule_directions / kol_schedules.category_direction）
 *   - 'product'   产品线字典（关联 product_lines / schedule_budgets.product_line）
 *
 * 通过 TAB_CONFIG 抽象出每个 tab 的 API 与文案，公共逻辑共用。
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[DictManager] ScheduleData 未就绪'); return; }

  // 每个 tab 的策略对象：把数据 API + 文案 + 删除行为统一进来
  const TAB_CONFIG = {
    direction: {
      label: '达人类型',
      nameEditable: true,
      placeholder: '键入新达人类型名（已停用的同名会自动复用并重新启用）',
      list:    () => SD.listDirections({ includeInactive: true }),
      create:  (name) => SD.createOrReactivateDirection({ name }),
      update:  (id, patch) => SD.updateDirection(id, patch),
      countUsage: (name) => {
        const u = SD.countDirectionUsage(name);
        return { schedules: u.schedules, budgets: u.budgets };
      },
      // 停用：不级联清理；删除：级联清理 schedules + budgets
      deactivate: (id, _opts) => SD.deactivateDirectionCascade(id, { cascadeDeleteSchedules: false }),
      hardDelete: (id) => {
        const r = SD.deactivateDirectionCascade(id, { cascadeDeleteSchedules: true });
        return { cleared: `${r.deletedSchedules} 排期 + ${r.deletedBudgets} 预算` };
      },
      usageLabel: (u) => (u.schedules || u.budgets)
        ? `${u.schedules} 排期 · ${u.budgets} 预算` : '未使用',
      deleteWarn: (name, u) => {
        let msg = `⚠️ 完全删除「${name}」？\n字典将被停用；`;
        if (u.schedules || u.budgets) {
          msg += `\n\n关联数据将一并删除（不可恢复，含其他月份）：\n`;
          if (u.schedules) msg += `  · ${u.schedules} 条排期\n`;
          if (u.budgets) msg += `  · ${u.budgets} 条预算配置\n`;
        } else msg += `\n当前无关联数据。`;
        return msg;
      },
      footerHint: '💡 删除会停用并清空跨月份的关联排期与预算，不可恢复。',
    },
    product: {
      label: '产品线',
      nameEditable: true,
      placeholder: '键入新产品线名（如：键盘 / 鼓锤 / 其他乐器）',
      list:    () => SD.listProductLines({ includeInactive: true }),
      create:  (name) => SD.createOrReactivateProductLine({ name }),
      update:  (id, patch) => SD.updateProductLine(id, patch),
      countUsage: (name) => {
        const n = SD.countProductLineUsage(name);
        return { budgets: n };
      },
      deactivate: (id) => SD.deactivateProductLine(id, { cascadeClearBudgets: false }),
      hardDelete: (id) => {
        const r = SD.deactivateProductLine(id, { cascadeClearBudgets: true });
        return { cleared: `${r.clearedBudgets} 预算行的产品线被清空` };
      },
      usageLabel: (u) => u.budgets ? `${u.budgets} 条预算引用` : '未使用',
      deleteWarn: (name, u) => {
        let msg = `⚠️ 完全删除产品线「${name}」？\n字典将被停用；`;
        if (u.budgets) msg += `\n\n${u.budgets} 条预算行的"产品线"字段将被清空（其他数据保留）。`;
        else msg += `\n当前无关联数据。`;
        return msg;
      },
      footerHint: '💡 删除会停用并把所有引用此产品线的预算行清空该字段，不影响其他数据。',
    },
    platform: {
      label: '平台',
      nameEditable: true,
      placeholder: '键入新平台名（如：抖音 / 小红书 / B站 / 视频号 / 快手 / 微博）',
      list:    () => SD.listPlatforms({ includeInactive: true }),
      create:  (name) => SD.createOrReactivatePlatform({ name }),
      update:  (id, patch) => SD.updatePlatform(id, patch),
      countUsage: (name) => SD.countPlatformUsage(name),
      deactivate: (id) => SD.deactivatePlatform(id, { cascadeClearBudgets: false }),
      hardDelete: (id) => {
        const r = SD.deactivatePlatform(id, { cascadeClearBudgets: true });
        return { cleared: `${r.clearedBudgets} 预算行的平台被清空` };
      },
      usageLabel: (u) => {
        const parts = [];
        if (u.schedules) parts.push(`${u.schedules} 排期`);
        if (u.budgets) parts.push(`${u.budgets} 预算`);
        return parts.length ? parts.join(' · ') : '未使用';
      },
      deleteWarn: (name, u) => {
        let msg = `⚠️ 完全删除平台「${name}」？\n字典将被停用；`;
        if (u.budgets) msg += `\n${u.budgets} 条预算行的"平台"字段将被清空。`;
        if (u.schedules) msg += `\n${u.schedules} 条排期的"平台"字段保留原值（不会清空），但下拉里不再出现该选项。`;
        if (!u.budgets && !u.schedules) msg += `\n当前无关联数据。`;
        return msg;
      },
      footerHint: '💡 删除只停用字典；预算行清空该字段，排期里保留原值，不会丢数据。',
    },
    tier: {
      label: '层级',
      nameEditable: true,
      placeholder: '键入新层级名（如：sss级 / 头部 / 腰部 / 尾部 / KOC素人）',
      list:    () => SD.listTiers({ includeInactive: true }),
      create:  (name) => SD.createOrReactivateTier({ name }),
      update:  (id, patch) => SD.updateTier(id, patch),
      countUsage: (name) => SD.countTierUsage(name),
      deactivate: (id) => SD.deactivateTier(id, { cascadeClearSchedules: false }),
      hardDelete: (id) => {
        const r = SD.deactivateTier(id, { cascadeClearSchedules: true });
        return { cleared: `${r.clearedSchedules} 条排期的层级被清空` };
      },
      usageLabel: (u) => u.schedules ? `${u.schedules} 条排期` : '未使用',
      deleteWarn: (name, u) => {
        let msg = `⚠️ 完全删除层级「${name}」？\n字典将被停用；`;
        if (u.schedules) msg += `\n\n${u.schedules} 条排期的"层级"字段将被清空（其他数据保留）。`;
        else msg += `\n当前无关联数据。`;
        return msg;
      },
      footerHint: '💡 删除只停用字典并清空引用该层级的排期字段，不影响其他数据。',
    },
    bd: {
      label: '商务',
      nameLabel: '姓名',
      nameEditable: false,  // 只读
      readonly: true,
      noActions: true,
      placeholder: '',
      list: () => {
        // 合并商务BD和品宣主管
        const bds = SD.listBds({ includeInactive: true }).map(b => ({ ...b, _type: 'bd' }));
        const svs = ((window.DB && window.DB.supervisors) || []).map(sv => ({
          id: sv.id,
          name: sv.name,
          color: '#7c3aed',
          is_active: true,
          _type: 'supervisor',
          hasPassword: !!sv.password,
        }));
        return [...bds, ...svs];
      },
      countUsage: () => ({}),
      usageLabel: () => '',
      deleteWarn: () => '',
      footerHint: '💡 商务和品宣主管在「账号管理」中管理，此处仅展示。',
      extraColumn: {
        header: '身份',
        render: (row) => row._type === 'supervisor'
          ? '<span style="padding:2px 8px;border-radius:10px;font-size:.72rem;background:#7c3aed22;color:#7c3aed;font-weight:600">品宣主管</span>'
          : '<span style="padding:2px 8px;border-radius:10px;font-size:.72rem;background:#3b82f622;color:#3b82f6;font-weight:600">商务BD</span>',
      },
    },
  };

  const state = { open: false, tab: 'direction', editingNameId: null };

  /* ------------------------- 1. DOM 骨架 ------------------------- */
  function ensureNode() {
    if (document.getElementById('sched-dict-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sched-dict-overlay';
    overlay.className = 'sched-dict-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.innerHTML = `
      <div class="sched-dict-panel">
        <div class="sched-dict-header">
          <div class="sched-dict-title">⚙️ 字典管理</div>
          <button class="sched-drawer-close" onclick="DictManager.close()" title="关闭">×</button>
        </div>
        <div class="sched-dict-tabs" id="sched-dict-tabs"></div>
        <div class="sched-dict-body" id="sched-dict-body"></div>
        <div class="sched-dict-footer" id="sched-dict-footer"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  /* ------------------------- 2. 打开 / 关闭 ------------------------- */
  function open(tab) {
    ensureNode();
    state.open = true;
    if (tab && TAB_CONFIG[tab]) state.tab = tab;
    paint();
    requestAnimationFrame(() => {
      document.getElementById('sched-dict-overlay').classList.add('open');
      document.getElementById('__dict-new-name__')?.focus();
    });
  }
  function close() {
    state.open = false;
    const o = document.getElementById('sched-dict-overlay');
    if (o) o.classList.remove('open');
    // 关闭后刷新所有视图（避免外部数据脏读）
    if (window.SchedulePage) SchedulePage.render();
    if (window.BudgetTable) BudgetTable.refresh();
    if (window.MonthlyPlanPage && document.getElementById('sched-budget-host')) {
      window.MonthlyPlanPage.render();
    }
  }
  function _switchTab(tab) {
    if (!TAB_CONFIG[tab]) return;
    state.tab = tab;
    paint();
    setTimeout(() => document.getElementById('__dict-new-name__')?.focus(), 0);
  }

  /* ------------------------- 3. 渲染 ------------------------- */
  function paint() {
    const cfg = TAB_CONFIG[state.tab];
    document.getElementById('sched-dict-tabs').innerHTML = renderTabs();
    const body = document.getElementById('sched-dict-body');
    body.innerHTML = `
      ${cfg.readonly ? '' : renderCreateRow(cfg)}
      ${renderTable(cfg)}
    `;
    document.getElementById('sched-dict-footer').innerHTML = `
      <span style="font-size:.78rem;color:var(--text-muted)">${cfg.footerHint}</span>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" onclick="DictManager.close()">关闭</button>
    `;
  }

  function renderTabs() {
    return Object.entries(TAB_CONFIG).map(([key, c]) => `
      <button class="sched-dict-tab ${state.tab===key?'active':''}"
              onclick="DictManager._switchTab('${key}')">
        ${escapeHtml(c.label)}
      </button>
    `).join('');
  }

  function renderCreateRow(cfg) {
    return `
      <div class="sched-dict-create-row">
        <input id="__dict-new-name__" placeholder="${escapeAttr(cfg.placeholder)}"
               onkeydown="if(event.key==='Enter')DictManager._create()">
        <button class="btn btn-primary btn-sm" onclick="DictManager._create()">＋ 新建</button>
      </div>
    `;
  }

  function renderTable(cfg) {
    const all = cfg.list();
    if (!all.length) {
      if (cfg.readonly) {
        return `<div class="sched-empty" style="padding:32px 16px;color:var(--text-muted);font-size:.85rem">暂无品宣主管账号，可在「账号管理」中添加。</div>`;
      }
      return `<div class="sched-empty">字典里还没有任何条目，请在上方添加。</div>`;
    }
    const sorted = all.slice().sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
    const rows = sorted.map((d, i, arr) => renderRow(cfg, d, i, arr)).join('');
    const extraTh = cfg.extraColumn ? `<th>${escapeHtml(cfg.extraColumn.header)}</th>` : '';
    const nameLabel = cfg.nameLabel || '名称';
    const readonlyClass = cfg.readonly ? 'readonly' : '';
    const actionsTh = cfg.noActions ? '' : '<th class="col-actions">操作</th>';
    return `
      <table class="sched-dict-table ${readonlyClass}">
        <thead>
          <tr>
            <th>${escapeHtml(nameLabel)}</th>
            ${extraTh}
            <th class="col-order">顺序</th>
            <th class="col-status">状态</th>
            <th class="col-usage">使用情况</th>
            ${actionsTh}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderRow(cfg, d, idx, all) {
    const usage = cfg.countUsage(d.name, d.id);
    const usageText = `<span style="font-size:.72rem;color:var(--text-muted)">${escapeHtml(cfg.usageLabel(usage))}</span>`;
    const inactiveCls = d.is_active ? '' : 'inactive';
    const prev = idx > 0 ? all[idx - 1] : null;
    const next = idx < all.length - 1 ? all[idx + 1] : null;
    const canUp = prev && prev.is_active === d.is_active;
    const canDown = next && next.is_active === d.is_active;
    const extraTd = cfg.extraColumn ? `<td>${cfg.extraColumn.render(d)}</td>` : '';
    // 姓名/名称单元格：可编辑模式（仅 cfg.nameEditable=true 时）
    let nameCell;
    if (cfg.nameEditable && state.editingNameId === d.id) {
      nameCell = `<td><input type="text" class="sched-budget-cell-input" value="${escapeAttr(d.name)}"
                    onblur="DictManager._saveName('${d.id}', this.value)"
                    onkeydown="DictManager._nameKey(event, this, '${d.id}')"
                    autofocus></td>`;
    } else if (cfg.nameEditable) {
      nameCell = `<td><button class="sched-budget-cell editable" style="font-weight:600"
                    onclick="DictManager._editName('${d.id}')"
                    title="点击编辑姓名">${escapeHtml(d.name)}</button></td>`;
    } else {
      nameCell = `<td><strong>${escapeHtml(d.name)}</strong></td>`;
    }
    // 只读模式不显示操作按钮
    const noActions = cfg.noActions;
    const actionsTd = noActions ? '' : `
      <td class="col-actions">
        ${d.is_active
          ? `<button class="sched-dict-row-action" onclick="DictManager._toggle('${d.id}',false)">停用</button>`
          : `<button class="sched-dict-row-action primary" onclick="DictManager._toggle('${d.id}',true)">启用</button>`
        }
        ${Object.values(usage).some(v => v > 0)
          ? `<span style="color:var(--text-muted);font-size:.75rem;cursor:default" title="已有关联数据，不可删除">不可删除</span>`
          : `<button class="sched-dict-row-action danger" onclick="DictManager._delete('${d.id}')">删除</button>`
        }
      </td>
    `;
    // 只读模式不显示顺序按钮
    const orderTd = noActions ? '<td></td>' : `
      <td>
        <button class="sched-dict-order-btn" onclick="DictManager._move('${d.id}',-1)" ${canUp?'':'disabled'} title="上移">▲</button>
        <button class="sched-dict-order-btn" onclick="DictManager._move('${d.id}',1)" ${canDown?'':'disabled'} title="下移">▼</button>
      </td>
    `;
    // 只读模式显示密码状态
    const pwdTd = (cfg.readonly && d.hasPassword !== undefined) ? `<td>${d.hasPassword ? '<span class="sched-dict-status-on">✓ 已设置密码</span>' : '<span class="sched-dict-status-off">未设置</span>'}</td>` : '';
    return `
      <tr class="${inactiveCls}">
        ${nameCell}
        ${extraTd}
        ${orderTd}
        <td>${d.is_active
            ? '<span class="sched-dict-status-on">✓ 已启用</span>'
            : '<span class="sched-dict-status-off">○ 已停用</span>'}</td>
        <td>${usageText}</td>
        ${pwdTd}
        ${actionsTd}
      </tr>
    `;
  }

  /* BD 专用：姓名内联编辑 */
  function _editName(id) {
    state.editingNameId = id;
    paint();
    requestAnimationFrame(() => {
      const inp = document.querySelector('.sched-budget-cell-input');
      if (inp) { inp.focus(); inp.select(); }
    });
  }
  function _nameKey(ev, el, id) {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Escape') { state.editingNameId = null; paint(); }
  }
  function _saveName(id, newName) {
    if (state.editingNameId !== id) return;
    state.editingNameId = null;
    newName = String(newName || '').trim();
    const cfg = TAB_CONFIG[state.tab];
    const current = cfg.list().find(x => x.id === id);
    if (!current) { paint(); return; }
    if (!newName) {
      window.toast && window.toast('姓名不能为空', 'error');
      paint();
      return;
    }
    if (newName === current.name) { paint(); return; }
    // 重名检测
    if (cfg.list().some(x => x.id !== id && x.name === newName)) {
      window.toast && window.toast(`已存在同名「${newName}」`, 'error');
      paint();
      return;
    }
    try {
      cfg.update(id, { name: newName });
      window.toast && window.toast('已更新姓名', 'success');
      paint();
      // 同步刷新外部视图（卡片 chip 等）
      if (window.SchedulePage) SchedulePage.render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
      paint();
    }
  }

  /* BD 专用：颜色变更直接更新 */
  function _updateBdColor(bdId, hex) {
    try {
      SD.updateBd(bdId, { color: hex });
      // 刷新其他视图（卡片色会变）
      if (window.SchedulePage) SchedulePage.render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  /* ------------------------- 4. 操作 ------------------------- */
  function _create() {
    const cfg = TAB_CONFIG[state.tab];
    const inp = document.getElementById('__dict-new-name__');
    const name = (inp?.value || '').trim();
    if (!name) { window.toast && window.toast('请输入名称', 'error'); return; }
    try {
      const d = cfg.create(name);
      window.toast && window.toast(`已新建/启用「${d.name}」`, 'success');
      inp.value = '';
      paint();
      setTimeout(() => document.getElementById('__dict-new-name__')?.focus(), 0);
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  function _toggle(id, toActive) {
    const cfg = TAB_CONFIG[state.tab];
    const d = cfg.list().find(x => x.id === id);
    if (!d) return;
    if (toActive) {
      cfg.update(id, { is_active: true });
      window.toast && window.toast(`已启用「${d.name}」`, 'success');
    } else {
      const usage = cfg.countUsage(d.name);
      const msg = `停用「${d.name}」？\n（停用后不会清除关联数据，可随时重新启用）\n${cfg.usageLabel(usage)}`;
      if (!confirm(msg)) return;
      cfg.deactivate(id);
      window.toast && window.toast(`已停用「${d.name}」`, 'info');
    }
    paint();
  }

  function _delete(id) {
    const cfg = TAB_CONFIG[state.tab];
    const d = cfg.list().find(x => x.id === id);
    if (!d) return;
    const usage = cfg.countUsage(d.name);
    if (!confirm(cfg.deleteWarn(d.name, usage))) return;
    const r = cfg.hardDelete(id);
    window.toast && window.toast(`已删除「${d.name}」${r.cleared?'（清理 '+r.cleared+'）':''}`, 'success');
    paint();
  }

  function _move(id, dir) {
    const cfg = TAB_CONFIG[state.tab];
    const all = cfg.list();
    const active = all.filter(d => d.is_active).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    const inactive = all.filter(d => !d.is_active).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    const group = active.find(d => d.id === id) ? active : inactive;
    const idx = group.findIndex(d => d.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= group.length) return;
    const a = group[idx], b = group[target];
    const ao = a.sort_order || 0, bo = b.sort_order || 0;
    cfg.update(a.id, { sort_order: bo });
    cfg.update(b.id, { sort_order: ao });
    paint();
  }

  /* ------------------------- 5. 工具 ------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ------------------------- 6. 暴露 ------------------------- */
  window.DictManager = {
    open, close,
    _create, _toggle, _delete, _move, _switchTab, _updateBdColor,
    _editName, _saveName, _nameKey,
  };
  console.log('[DictManager] 已就绪（含产品线）');
})();
