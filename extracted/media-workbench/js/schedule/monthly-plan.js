/* =====================================================================
 * 达人营销 · 月度规划表（独立页面）
 *
 * 该页面与「内容排期」平级，独立月份状态。
 *
 * 暴露：window.MonthlyPlanPage = { render, prevMonth, nextMonth, goToday, ... }
 *
 * 内部仍调用 BudgetTable.render(year, month) 把规划表渲染到本页内 #sched-budget-host
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[MonthlyPlanPage] ScheduleData 未就绪'); return; }

  const state = {
    year: 0,
    month: 0,
  };

  function initState() {
    if (state.year) return;
    // 默认跟随排期页（若已初始化）；否则按当前月
    if (window.SchedulePage) {
      const s = SchedulePage.getState();
      if (s.year && s.month) {
        state.year = s.year;
        state.month = s.month;
        return;
      }
    }
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth() + 1;
  }

  /* ------------------------- 渲染 ------------------------- */
  function render() {
    initState();
    const page = document.getElementById('page-monthly-plan');
    if (!page) return;
    page.innerHTML = `
      ${renderToolbar()}
      <div id="sched-budget-host"></div>
    `;
    if (window.BudgetTable && typeof window.BudgetTable.render === 'function') {
      window.BudgetTable.render(state.year, state.month);
    }
  }

  function renderToolbar() {
    const data = (window.ScheduleData && ScheduleData.getMonthlyBudgetRows)
      ? ScheduleData.getMonthlyBudgetRows(state.year, state.month)
      : { total: { budget: 0, spent: 0 } };
    const total = data.total;
    const fmt = v => (v / 10000).toFixed(1);
    const remaining = total.budget - total.spent;
    const remainColor = remaining < 0 ? '#dc2626' : '#16a34a';
    return `
      <div class="sched-toolbar">
        <span style="font-size:1.1rem;font-weight:700;color:var(--text-primary);margin-right:12px;white-space:nowrap">月度规划表</span>
        <div class="sched-month-switcher">
          <button class="sched-month-btn" onclick="MonthlyPlanPage.prevMonth()" title="上月">‹</button>
          <div class="sched-month-current">${state.year} 年 ${state.month} 月</div>
          <button class="sched-month-btn" onclick="MonthlyPlanPage.nextMonth()" title="下月">›</button>
          <button class="sched-month-today" onclick="MonthlyPlanPage.goToday()">本月</button>
        </div>
        <div style="display:flex;align-items:center;gap:16px;padding:0 4px;flex:1">
          <span style="color:var(--text-secondary);font-size:.85rem;white-space:nowrap">
            总预算 <strong style="color:var(--text-primary)">${fmt(total.budget)}万</strong>
          </span>
          <span style="color:var(--border)">|</span>
          <span style="color:var(--text-secondary);font-size:.85rem;white-space:nowrap">
            已排期 <strong style="color:#2563eb">${fmt(total.spent)}万</strong>
          </span>
          <span style="color:var(--border)">|</span>
          <span style="color:var(--text-secondary);font-size:.85rem;white-space:nowrap">
            剩余预算 <strong style="color:${remainColor}">${fmt(remaining)}万</strong>
          </span>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="SchedulePage && SchedulePage.setMonth(${state.year}, ${state.month}); navigate('schedule')" title="切到内容排期查看具体排期">
          📅 查看排期
        </button>
        <button class="btn btn-secondary btn-sm" onclick="DictManager.open()" title="管理达人类型字典">
          ⚙️ 字典管理
        </button>
      </div>
    `;
  }

  /* ------------------------- 月份切换 ------------------------- */
  function prevMonth() {
    if (state.month === 1) { state.year--; state.month = 12; } else state.month--;
    render();
  }
  function nextMonthAction() {
    if (state.month === 12) { state.year++; state.month = 1; } else state.month++;
    render();
  }
  function goToday() {
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth() + 1;
    render();
  }
  function setMonth(y, m) {
    state.year = y; state.month = m; render();
  }

  window.MonthlyPlanPage = {
    render, prevMonth, nextMonth: nextMonthAction, goToday, setMonth,
    getState() { return { ...state }; },
  };
  console.log('[MonthlyPlanPage] 已就绪');
})();
