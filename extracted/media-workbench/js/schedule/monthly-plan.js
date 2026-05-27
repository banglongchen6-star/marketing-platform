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
    return `
      <div class="sched-toolbar">
        <span style="font-size:1.1rem;font-weight:700;color:var(--text-primary);margin-right:12px;white-space:nowrap">月度规划表</span>
        <div class="sched-month-switcher">
          <button class="sched-month-btn" onclick="MonthlyPlanPage.prevMonth()" title="上月">‹</button>
          <div class="sched-month-current">${state.year} 年 ${state.month} 月</div>
          <button class="sched-month-btn" onclick="MonthlyPlanPage.nextMonth()" title="下月">›</button>
          <button class="sched-month-today" onclick="MonthlyPlanPage.goToday()">本月</button>
          <span style="margin-left:8px;color:var(--text-muted);font-size:.78rem">
            该月预算配置 + 与排期实际花费的对比
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
