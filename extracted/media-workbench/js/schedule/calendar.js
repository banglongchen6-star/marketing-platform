/* =====================================================================
 * 达人营销 · 内容排期模块 · 双月日历视图 (Phase 2)
 *
 * 暴露：
 *   window.SchedulePage = { render, prevMonth, nextMonth, goToday, ... }
 *   window.openScheduleEditor(scheduleId | null, prefillDate?)  — Phase 3 实现
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[SchedulePage] ScheduleData 未就绪'); return; }

  /* ------------------------- 1. 模块状态 ------------------------- */
  const state = {
    year: 0,
    month: 0,          // 1-12
    tiers: [],         // 层级筛选，空数组 = 全部
    bd_id: '',         // BD 筛选，空 = 全部
  };

  const TIERS = ['头部', '中部', '腰部', '尾部', '素人'];
  const STATUS_LABEL = {
    draft: '草稿', planned: '计划中', published: '已发布',
  };
  const STATUS_KEYS = Object.keys(STATUS_LABEL).filter(k => k !== 'draft');

  function initState() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
  }

  function fmtMonthLabel(y, m) {
    return `${y} 年 ${m} 月`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function nextMonthOf(y, m) {
    if (m === 12) return { year: y + 1, month: 1 };
    return { year: y, month: m + 1 };
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /* ------------------------- 2. 日历网格计算 -------------------------
   * 返回 5-6 周 × 7 天的二维数组，每格 { dateStr, dayNum, isCurrentMonth, isToday }
   */
  function buildMonthGrid(year, month) {
    const first = new Date(year, month - 1, 1);
    const firstWeekday = first.getDay(); // 0=Sun, 6=Sat
    // 我们以周一为起点：weekday=0 表示周一
    const offset = (firstWeekday + 6) % 7;
    const lastOfMonth = new Date(year, month, 0).getDate();
    const gridStart = new Date(year, month - 1, 1 - offset);

    const today = todayStr();
    const cells = [];
    // 总共最多 6 周
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
      const dateStr = `${y}-${pad2(m)}-${pad2(day)}`;
      cells.push({
        dateStr,
        dayNum: day,
        weekday: i % 7, // 0=Mon
        isCurrentMonth: m === month,
        isToday: dateStr === today,
      });
      // 若已经到下月且本周已满，可提前结束（最少 5 周）
      if (i >= 34 && d.getMonth() + 1 !== month && (i + 1) % 7 === 0) break;
    }
    // 切成 7 列
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  /* ------------------------- 3. 渲染：工具条 ------------------------- */
  function renderToolbar() {
    const next = nextMonthOf(state.year, state.month);
    const tierChip = state.tiers.length
      ? `<span class="sched-filter-chip">层级：${state.tiers.join('、')}
           <span class="clear" onclick="SchedulePage.clearTiers()">×</span></span>`
      : '';
    return `
      <div class="sched-toolbar">
        <div class="sched-month-switcher">
          <button class="sched-month-btn" onclick="SchedulePage.prevMonth()" title="上月">‹</button>
          <div class="sched-month-current">${fmtMonthLabel(state.year, state.month)}</div>
          <button class="sched-month-btn" onclick="SchedulePage.nextMonth()" title="下月">›</button>
          <button class="sched-month-today" onclick="SchedulePage.goToday()">今天</button>
          <span style="margin-left:8px;color:var(--text-muted);font-size:.78rem">
            同时显示 ${state.year}/${state.month} 与 ${next.year}/${next.month}
          </span>
        </div>
        ${renderBdFilter()}
        <button class="btn btn-secondary btn-sm" onclick="SchedulePage.openDictManager()" title="达人类型字典">
          ⚙️ 字典管理
        </button>
        <button class="btn btn-secondary btn-sm" onclick="SchedulePage.openImport()" title="Excel 导入">
          📥 导入
        </button>
        <button class="btn btn-secondary btn-sm" onclick="SchedulePage.openExport()" title="Excel 导出">
          📤 导出
        </button>
        <button class="btn btn-secondary btn-sm" onclick="RecycleBin.open()" title="查看 7 天内删除的排期">
          🗑 回收站${(()=>{ const n = window.RecycleBin?.countActive?.() || 0; return n ? `（${n}）` : ''; })()}
        </button>
        <button class="btn btn-primary btn-sm" onclick="openScheduleEditor(null)">
          ＋ 新增排期
        </button>
      </div>
    `;
  }

  /* ------------------------- 4. 渲染：单个日历 ------------------------- */
  function statusClass(status) {
    return 'sched-status-' + (status || 'planned');
  }

  function _cardMonthFrozen(s) {
    if (!s.schedule_date) return false;
    const [y, m] = s.schedule_date.split('-').map(Number);
    return SD.isMonthFrozen(y, m);
  }

  function renderCard(s) {
    const frozen = _cardMonthFrozen(s);
    const st = (window.DB?.settlements || []).find(x => x.schedule_id === s.id && !x.settled);
    const amount = st
      ? (parseFloat(st.contract_amount || s.amount) || 0) + (st.bonus_enabled ? (parseFloat(st.bonus_amount) || 0) : 0)
      : (Number(s.amount) || 0);
    const amountText = amount >= 10000
      ? `¥${(amount/10000).toFixed(1)}万`
      : `¥${amount.toLocaleString()}`;
    const tierChip = ''; // 层级已移除
    const dirChip = s.category_direction
      ? `<span class="sched-card-chip direction" title="达人类型">${escapeHtml(s.category_direction)}</span>` : '';
    const plats = Array.isArray(s.platforms) && s.platforms.length ? s.platforms : (s.platform ? [s.platform] : []);
    const mainPlat = s.platform || plats[0] || '';
    const syncPlats = Array.isArray(s.sync_platforms) && s.sync_platforms.length ? s.sync_platforms : plats.slice(1);
    const platChip = [
      mainPlat ? `<span class="sched-card-chip platform" title="主平台">${escapeHtml(mainPlat)}<sup style="font-size:.6rem;color:var(--primary);font-weight:600;margin-left:1px;vertical-align:super">主</sup></span>` : '',
      ...syncPlats.map(p => `<span class="sched-card-chip platform" title="同步平台">${escapeHtml(p)}</span>`),
    ].filter(Boolean).join('');
    const bd = s.bd_id ? SD.findBdPersonById(s.bd_id) : null;
    const bdStyle = ''; // 不再用 BD 颜色覆盖左边框，左边框恢复为「状态颜色」
    // 金额提示：≥1万 淡金色（大单）；5000~1万 淡蓝色（中单）
    const _amt = Number(s.amount) || 0;
    const bigStyle = _amt >= 10000 ? 'background:#fef3c7;'
                   : _amt >= 5000  ? 'background:#dbeafe;' : '';
    const frozenStyle = frozen ? 'opacity:.55;filter:grayscale(0.4);cursor:not-allowed;' : '';
    const bdChip = bd ? `<span class="sched-card-chip" style="background:${bd.color}20;color:${bd.color};font-weight:500" title="BD：${escapeHtml(bd.name)}">${escapeHtml(bd.name)}</span>` : '';
    const titleAttr = [
      frozen ? '🔒 已冻结' : '',
      STATUS_LABEL[s.status] || s.status || '',
      bd ? `BD：${bd.name}` : '',
      plats.length ? `平台：${plats.join('、')}` : '',
      s.category_direction ? `类型：${s.category_direction}` : '',
    ].filter(Boolean).join(' · ');
    const homepageLink = s.kol_homepage
      ? `<a class="sched-card-link" href="${escapeHtml(s.kol_homepage)}" target="_blank" rel="noopener noreferrer"
            onclick="event.stopPropagation()" title="新窗口打开达人主页">🔗</a>`
      : '';
    const isDraft = s.status === 'draft';
    const draftStyle = isDraft ? 'border-style:dashed;opacity:.75;' : '';
    const draftBadge = isDraft ? `<span class="sched-card-draft-badge">草稿</span>` : '';
    const dragAttrs = (frozen || isDraft) ? '' : `draggable="true"
           ondragstart="event.stopPropagation();SchedulePage._onCardDragStart(event,'${s.id}')"
           ondragend="SchedulePage._onCardDragEnd(event)"`;
    const clickHandler = frozen
      ? `onclick="event.stopPropagation();window.toast&&window.toast('该月已冻结，请先解冻再操作','error')"`
      : `onclick="event.stopPropagation();openScheduleEditor('${s.id}')"
           oncontextmenu="event.preventDefault();event.stopPropagation();SchedulePage._openStatusMenu(event,'${s.id}')"`;
    return `
      <div class="sched-card" data-status="${s.status || 'planned'}" style="${bdStyle}${bigStyle}${frozenStyle}${draftStyle}"
           ${dragAttrs} ${clickHandler}
           title="${escapeHtml(titleAttr)}">
        <div class="sched-card-row1">
          <span class="sched-card-name">${frozen ? '🔒 ' : ''}${escapeHtml(s.kol_name || '未命名')}</span>
          ${draftBadge}${homepageLink}
        </div>
        <div class="sched-card-row2">
          <span class="sched-card-amount ${statusClass(s.status)}">${amountText}</span>
        </div>
        ${(() => {
          const _sep = '<span style="color:var(--text-muted);margin:0 4px;opacity:.55">·</span>';
          const parts = [];
          if (s.category_direction) parts.push(`<span title="达人类型">${escapeHtml(s.category_direction)}</span>`);
          if (mainPlat) parts.push(`<span title="主平台">${escapeHtml(mainPlat)}<sup style="font-size:.6rem;color:var(--primary);font-weight:600;margin-left:1px;vertical-align:super">主</sup></span>`);
          syncPlats.forEach(p => parts.push(`<span title="同步平台">${escapeHtml(p)}</span>`));
          if (bd) parts.push(`<span title="BD：${escapeHtml(bd.name)}">${escapeHtml(bd.name)}</span>`);
          return parts.length ? `<div class="sched-card-meta" style="display:block;font-size:.7rem;color:var(--text-secondary);line-height:1.5">${parts.join(_sep)}</div>` : '';
        })()}
      </div>
    `;
  }

  function renderCell(cell, schedulesByDate, frozen) {
    const items = schedulesByDate[cell.dateStr] || [];
    const classes = ['sched-cal-cell'];
    if (!cell.isCurrentMonth) classes.push('other-month');
    if (cell.isToday) classes.push('today');
    if (frozen) classes.push('frozen-cell');
    const dropAttrs = frozen ? '' : `ondragover="SchedulePage._onCellDragOver(event, this)"
           ondragleave="SchedulePage._onCellDragLeave(event, this)"
           ondrop="SchedulePage._onCellDrop(event, '${cell.dateStr}', this)"`;
    const clickAttr = frozen
      ? `onclick="window.toast&&window.toast('该月已冻结，请先解冻再操作','error')"`
      : `onclick="openScheduleEditor(null, '${cell.dateStr}')"`;
    return `
      <div class="${classes.join(' ')}"
           data-date="${cell.dateStr}"
           ${dropAttrs} ${clickAttr}>
        <div class="sched-cal-dayrow">
          <span class="sched-cal-daynum">${cell.dayNum}</span>
          ${cell.isToday ? '<span class="sched-cal-todaybadge">今</span>' : ''}
        </div>
        ${items.map(renderCard).join('')}
      </div>
    `;
  }

  function renderOneCalendar(year, month) {
    const frozen = SD.isMonthFrozen(year, month);
    const isSupervisor = window.currentUser?.identity === 'supervisor';
    const grid = buildMonthGrid(year, month);
    const { start, end } = SD.monthRange(year, month);
    let schedules = SD.listSchedulesInRange(start, end, { tiers: state.tiers });

    const firstCell = grid[0][0].dateStr;
    const lastCell = grid[grid.length - 1][6].dateStr;
    const endStr = addOneDay(lastCell);
    schedules = SD.listSchedulesInRange(firstCell, endStr, { tiers: state.tiers, bd_id: state.bd_id || undefined });

    const byDate = {};
    schedules.forEach((s) => {
      if (!byDate[s.schedule_date]) byDate[s.schedule_date] = [];
      byDate[s.schedule_date].push(s);
    });
    Object.values(byDate).forEach(arr => arr.sort((a, b) => (b.amount || 0) - (a.amount || 0)));

    const monthList = SD.listSchedulesInRange(start, end, { tiers: state.tiers, bd_id: state.bd_id || undefined })
      .filter(s => s.status !== 'cancelled');
    const monthSpent = monthList.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const monthCount = monthList.length;

    const weekHead = ['一','二','三','四','五','六','日']
      .map((w, i) => `<div class="sched-cal-wkhead ${i===5?'sat':i===6?'sun':''}">${w}</div>`).join('');
    const body = grid.map(week => week.map(c => renderCell(c, byDate, frozen)).join('')).join('');

    const freezeBtn = isSupervisor
      ? frozen
        ? `<button class="btn btn-sm" style="font-size:.72rem;padding:3px 10px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:6px;cursor:pointer"
               onclick="SchedulePage._toggleFreeze(${year},${month})">🔓 解冻</button>`
        : `<button class="btn btn-sm" style="font-size:.72rem;padding:3px 10px;background:#f1f5f9;border:1px solid #94a3b8;color:#475569;border-radius:6px;cursor:pointer"
               onclick="SchedulePage._toggleFreeze(${year},${month})">🔒 冻结</button>`
      : frozen
        ? `<span style="font-size:.72rem;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:10px;border:1px solid #f59e0b">🔒 已冻结</span>`
        : '';

    return `
      <div class="sched-cal-card" style="${frozen ? 'opacity:.85' : ''}">
        <div class="sched-cal-header">
          <span>${year} 年 ${month} 月</span>
          <span class="sched-cal-month-stats" style="display:flex;align-items:center;gap:10px">
            排期金额 <b>¥${monthSpent.toLocaleString()}</b> · 共 <b>${monthCount}</b> 条
            ${freezeBtn}
          </span>
        </div>
        <div class="sched-cal-grid">
          ${weekHead}
          ${body}
        </div>
      </div>
    `;
  }

  function addOneDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }

  /* ------------------------- 5. 渲染：主入口 ------------------------- */
  function render() {
    if (!state.year) initState();
    const page = document.getElementById('page-schedule');
    if (!page) return;
    const next = nextMonthOf(state.year, state.month);
    page.innerHTML = `
      ${renderToolbar()}
      <div class="sched-calendars">
        ${renderOneCalendar(state.year, state.month)}
        ${renderOneCalendar(next.year, next.month)}
      </div>
    `;
    // 月度规划表已独立成 /monthly-plan 页面，不在排期页内联展示
  }

  function renderBdFilter() {
    // 含品宣主管（主管也可作为排期负责人，需可被筛选）
    const bds = SD.listBdPersonnel ? SD.listBdPersonnel() : SD.listBds();
    if (!bds.length) return '';
    const opts = ['<option value="">全部 BD</option>']
      .concat(bds.map(b => `<option value="${escapeHtml(b.id)}" ${state.bd_id===b.id?'selected':''}>${escapeHtml(b.name)}${b._kind==='supervisor'?'（主管）':''}</option>`));
    const cur = bds.find(b => b.id === state.bd_id);
    // 选中 BD 时左边加色块指示当前过滤 BD 颜色
    const dotStyle = cur ? `style="border-left:4px solid ${cur.color}"` : '';
    return `<select class="filter-select" ${dotStyle}
                    onchange="SchedulePage._setBdFilter(this.value)">${opts.join('')}</select>`;
  }

  function _setBdFilter(v) {
    state.bd_id = v || '';
    render();
  }

  function renderLegend() {
    const chips = STATUS_KEYS.map(s => `
      <span class="sched-legend-chip">
        <span class="sched-legend-dot" data-status="${s}"></span>
        <span class="${statusClass(s)}">${STATUS_LABEL[s]}</span>
      </span>
    `).join('');
    return `
      <div class="sched-legend">
        <span class="sched-legend-label">状态：</span>
        ${chips}
        <span class="sched-legend-hint">💡 右键卡片可快速切换状态</span>
      </div>
    `;
  }

  /* ------------------------- 6. 操作 ------------------------- */
  function prevMonth() {
    if (state.month === 1) { state.year--; state.month = 12; }
    else state.month--;
    render();
  }
  function nextMonthAction() {
    if (state.month === 12) { state.year++; state.month = 1; }
    else state.month++;
    render();
  }
  function goToday() { initState(); render(); }

  function openTierFilter(ev) {
    closePopover();
    const btn = ev.currentTarget;
    const rect = btn.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'sched-filter-pop';
    pop.id = '__tier-pop__';
    pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    pop.style.left = (rect.left + window.scrollX) + 'px';
    pop.innerHTML = `
      ${TIERS.map(t => `
        <label><input type="checkbox" value="${t}" ${state.tiers.includes(t)?'checked':''}> ${t}</label>
      `).join('')}
      <div class="actions">
        <button onclick="SchedulePage._applyTiers()">应用</button>
        <button onclick="SchedulePage.clearTiers()">清除</button>
      </div>
    `;
    document.body.appendChild(pop);
    setTimeout(() => document.addEventListener('click', outsideClickClose), 0);
  }
  function outsideClickClose(e) {
    const pop = document.getElementById('__tier-pop__');
    if (!pop) return document.removeEventListener('click', outsideClickClose);
    if (!pop.contains(e.target)) closePopover();
  }
  function closePopover() {
    const pop = document.getElementById('__tier-pop__');
    if (pop) pop.remove();
    document.removeEventListener('click', outsideClickClose);
  }
  function _applyTiers() {
    const pop = document.getElementById('__tier-pop__');
    if (!pop) return;
    state.tiers = [...pop.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
    closePopover();
    render();
  }
  function clearTiers() {
    state.tiers = [];
    closePopover();
    render();
  }

  /* ---- 拖拽改日期 ---- */
  let _dragId = null;
  function _onCardDragStart(ev, scheduleId) {
    _dragId = scheduleId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', scheduleId);
    }
    ev.target.classList.add('dragging');
  }
  function _onCardDragEnd(ev) {
    ev.target.classList.remove('dragging');
    document.querySelectorAll('.sched-cal-cell.drop-target').forEach(c => c.classList.remove('drop-target'));
    _dragId = null;
  }
  function _onCellDragOver(ev, cell) {
    if (!_dragId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    cell.classList.add('drop-target');
  }
  function _onCellDragLeave(ev, cell) {
    cell.classList.remove('drop-target');
  }
  function _toggleFreeze(year, month) {
    if (window.currentUser?.identity !== 'supervisor') {
      window.toast && window.toast('仅品宣主管可操作冻结', 'error');
      return;
    }
    const isFrozen = SD.isMonthFrozen(year, month);
    const label = isFrozen ? `解冻 ${year}年${month}月` : `冻结 ${year}年${month}月`;
    window.confirmSupervisorPass(label, () => {
      if (isFrozen) {
        SD.unfreezeMonth(year, month);
        window.toast && window.toast(`${year}年${month}月 已解冻`, 'success');
      } else {
        SD.freezeMonth(year, month);
        window.toast && window.toast(`${year}年${month}月 已冻结`, 'success');
      }
      render();
    });
  }

  function _onCellDrop(ev, newDate, cell) {
    ev.preventDefault();
    cell.classList.remove('drop-target');
    const id = _dragId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
    _dragId = null;
    if (!id) return;
    const s = (window.DB.schedules || []).find(x => x.id === id);
    if (!s) return;
    if (s.schedule_date === newDate) return;
    // 拖出月也检查冻结
    const [sy, sm] = (s.schedule_date || '').split('-').map(Number);
    if (sy && SD.isMonthFrozen(sy, sm)) {
      window.toast && window.toast('来源月已冻结，无法拖动', 'error');
      return;
    }
    // 目标月检查冻结
    const [dy, dm] = newDate.split('-').map(Number);
    if (SD.isMonthFrozen(dy, dm)) {
      window.toast && window.toast('目标月已冻结，无法移入', 'error');
      return;
    }

    const oldDate = s.schedule_date;
    const today = todayStr();
    const newStatus = newDate < today ? 'published' : 'planned';

    const doMove = () => {
      try {
        SD.updateSchedule(id, { schedule_date: newDate, status: newStatus });
        window.toast && window.toast(`已移动「${s.kol_name}」 ${oldDate} → ${newDate}`, 'success');
        render();
        if (window.MonthlyPlanPage && document.getElementById('sched-budget-host')) {
          window.MonthlyPlanPage.render();
        }
      } catch (e) {
        window.toast && window.toast('移动失败：' + e.message, 'error');
      }
    };

    if (typeof window._schedImpactWarning === 'function') {
      window._schedImpactWarning(id, 'move', {
        title: '确认移动排期',
        subtitle: `${s.kol_name || '—'} · ${oldDate} → ${newDate}`,
        newDate,
      }, doMove);
    } else {
      doMove();
    }
  }

  /* ---- 右键菜单（状态由日期自动决定，仅展示提示） ---- */
  function _openStatusMenu(ev, scheduleId) {
    closeStatusMenu();
    const s = window.DB.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    const label = STATUS_LABEL[s.status] || s.status;
    const menu = document.createElement('div');
    menu.className = 'sched-status-menu';
    menu.id = '__status-menu__';
    menu.innerHTML = `
      <div class="sched-status-menu-title">当前状态</div>
      <div style="padding:8px 14px;font-size:.85rem;color:var(--text-secondary)">
        <span class="${statusClass(s.status)}">${label}</span>
        <div style="margin-top:6px;font-size:.75rem;color:var(--text-muted)">状态由日期自动决定，拖动卡片可改变日期</div>
      </div>
    `;
    document.body.appendChild(menu);
    const x = Math.min(ev.clientX, window.innerWidth - 200);
    const y = Math.min(ev.clientY, window.innerHeight - 100);
    menu.style.left = (x + window.scrollX) + 'px';
    menu.style.top = (y + window.scrollY) + 'px';
    setTimeout(() => document.addEventListener('click', outsideStatusMenuClose), 0);
  }
  function outsideStatusMenuClose(e) {
    const m = document.getElementById('__status-menu__');
    if (!m || !m.contains(e.target)) closeStatusMenu();
  }
  function closeStatusMenu() {
    const m = document.getElementById('__status-menu__');
    if (m) m.remove();
    document.removeEventListener('click', outsideStatusMenuClose);
  }
  function _setStatus() {} // 已停用，状态由日期自动决定

  // 这些是后续 Phase 的钩子，暂时给提示
  function openDictManager() {
    if (window.DictManager && window.DictManager.open) return window.DictManager.open();
    window.toast ? window.toast('字典管理 (Phase 5 待实现)', 'info') : alert('字典管理 (Phase 5)');
  }
  function openImport() {
    if (window.ImportWizard && window.ImportWizard.open) return window.ImportWizard.open();
    window.toast ? window.toast('Excel 导入 (Phase 6 待实现)', 'info') : alert('Excel 导入 (Phase 6)');
  }
  function openExport() {
    if (window.ExportWizard && window.ExportWizard.open) return window.ExportWizard.open();
    window.toast ? window.toast('Excel 导出 (Phase 7 待实现)', 'info') : alert('Excel 导出 (Phase 7)');
  }

  // Phase 3 之前的 stub
  if (typeof window.openScheduleEditor !== 'function') {
    window.openScheduleEditor = function (id, prefillDate) {
      if (window.ScheduleEditor && window.ScheduleEditor.open) {
        return window.ScheduleEditor.open(id, prefillDate);
      }
      const msg = id ? `编辑排期 ${id}` : `新增排期 ${prefillDate || ''}`;
      window.toast ? window.toast(msg + ' (Phase 3 待实现)', 'info') : alert(msg);
    };
  }

  /* ------------------------- 7. HTML 转义 ------------------------- */
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  /* ------------------------- 8. 暴露 ------------------------- */
  window.SchedulePage = {
    render, prevMonth, nextMonth: nextMonthAction, goToday,
    openTierFilter, clearTiers, _applyTiers,
    openDictManager, openImport, openExport,
    _openStatusMenu, _setStatus, _setBdFilter,
    _onCardDragStart, _onCardDragEnd, _onCellDragOver, _onCellDragLeave, _onCellDrop,
    _toggleFreeze,
    getState() { return { ...state }; },
    setMonth(y, m) { state.year = y; state.month = m; render(); },
  };

  // 替换旧 renderCalendar：navigate('schedule') 时被调用
  // 旧函数定义在内联 script 里，这里只是覆盖 window 上的引用
  window.renderCalendar = render;

  console.log('[SchedulePage] 已就绪');
})();
