/* =====================================================================
 * 离火品宣 · 月度总结（原「月度规划表」改造）
 *
 * 只统计达人合作内容（listContents，排除占位）。总览口径与「品宣ROI」一致
 * （复用 getBrandRoiMatrix().kpi）。
 * 版块：① 总览  ② 每日花费与播放趋势(Chart.js)  ③ 达人类型(表)+平台作品分布(环形)
 *       ④ 爆款/性价比 Top5  ⑤ 手动复盘
 *
 * 暴露：window.MonthlyPlanPage = { render, prevMonth, nextMonth, goToday, setMonth, saveReview, getState }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[MonthlyPlanPage] ScheduleData 未就绪'); return; }

  const state = { year: 0, month: 0, _trendChart: null, _donutChart: null };
  const PLAT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

  function initState() {
    if (state.year) return;
    if (window.SchedulePage && SchedulePage.getState) {
      const s = SchedulePage.getState();
      if (s.year && s.month) { state.year = s.year; state.month = s.month; return; }
    }
    const d = new Date(); state.year = d.getFullYear(); state.month = d.getMonth() + 1;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const fmtYuan = (n) => '¥' + fmtInt(n);
  const fmtWan = (n) => { const v = Number(n) || 0; return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).replace(/\.?0+$/, '') + '万'; };
  const hasRealData = (c) => (c.publications || []).some(p =>
    p.link || (p.views > 0) || (p.promo_views > 0) || (p.likes > 0) || (p.comments > 0));

  /* ------------------------- 数据计算 ------------------------- */
  function computeData() {
    const { year, month } = state;
    const roi = SD.getBrandRoiMatrix ? SD.getBrandRoiMatrix({ year, month }) : { kpi: {}, totalsPerDay: {}, allDays: [] };
    const platOrder = (SD.listPlatforms ? SD.listPlatforms() : []).map(p => p.name);
    const mStart = `${year}-${pad2(month)}-01`;
    const mEnd = `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
    const inMonth = (d) => !!d && d >= mStart && d <= mEnd;

    // 统一按「当月每条发布(publication)」统计：发布次数 & 平台分布，口径与数据看板一致
    const typeMap = {};        // 类型 -> { exp(万), count(发布次数) }
    const perPlatform = {};    // 平台 -> 发布次数
    const perContent = [];
    const contentSet = new Set();
    let interactTotal = 0;

    ((window.DB && window.DB.contents) || []).forEach(c => {
      const pubs = c.publications || [];
      const monthPubs = pubs.filter(p => inMonth(p.date));
      if (!monthPubs.length) return;
      const r = SD.resolveContent(c);
      const type = (r.category || '').trim() || '未标注';
      const mainPlat = (pubs[0] && pubs[0].platform) || '';
      contentSet.add(c.id);
      let cExp = 0, cInter = 0, cPromo = 0;
      monthPubs.forEach(p => {
        const exp = (Number(p.views) || 0) + (Number(p.promo_views) || 0);
        const inter = (Number(p.likes) || 0) + (Number(p.collects) || 0) + (Number(p.comments) || 0);
        cExp += exp; cInter += inter; cPromo += (Number(p.promo_cost) || 0);
        interactTotal += inter;
        const t = typeMap[type] || (typeMap[type] = { exp: 0, count: 0 });
        t.exp += exp; t.count += 1;               // 发布次数：每条发布计1
        const plat = p.platform || '其他';
        perPlatform[plat] = (perPlatform[plat] || 0) + 1;
      });
      perContent.push({ talent: r.talent, plat: mainPlat, exp: cExp, inter: cInter, cost: (Number(r.price) || 0) + cPromo });
    });

    const typeAgg = Object.entries(typeMap).map(([name, v]) => ({ name, exp: v.exp, count: v.count }))
      .sort((a, b) => b.exp - a.exp);
    const platDist = Object.entries(perPlatform).map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const ia = platOrder.indexOf(a.name), ib = platOrder.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1; if (ib !== -1) return 1;
        return b.count - a.count;
      });

    // 趋势：每日花费(元) + 每日播放(万)
    const days = roi.allDays || [];
    const trend = {
      labels: days.map(dd => String(Number(dd))),
      spend: days.map(dd => Math.round((roi.totalsPerDay[dd] && roi.totalsPerDay[dd].spend) || 0)),
      views: days.map(dd => Number(((roi.totalsPerDay[dd] && roi.totalsPerDay[dd].exposure) || 0).toFixed(2))),
    };

    const topHot = perContent.filter(x => x.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, 5);
    const topValue = perContent.filter(x => x.cost > 0 && x.exp > 0)
      .map(x => ({ ...x, cpm: x.cost / (x.exp * 10000) * 1000 }))
      .sort((a, b) => a.cpm - b.cpm).slice(0, 5);

    const exposureWan = Number(roi.kpi.totalExposure) || 0;
    const brandSpend = Number(roi.kpi.brandSpend) || 0;
    const avgInterRate = exposureWan > 0 ? interactTotal / (exposureWan * 10000) * 100 : 0;

    return {
      contentCount: contentSet.size,
      pubCount: Number(roi.kpi.contentCount) || 0,
      exposureWan, brandSpend,
      cpm: Number(roi.kpi.cpm) || 0,
      interactTotal, avgInterRate,
      typeAgg, platDist, trend, topHot, topValue,
    };
  }

  /* ------------------------- 各版块渲染 ------------------------- */
  function renderCards(d) {
    const card = (k, v, u, hi) => `<div class="mp-card${hi ? ' hi' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${u}</div></div>`;
    return `<div class="mp-cards">
      ${card('发布数', fmtInt(d.pubCount) + '<small> 次</small>', `${fmtInt(d.contentCount)} 条内容`)}
      ${card('总曝光', fmtWan(d.exposureWan), '自然+投流', true)}
      ${card('总互动', fmtInt(d.interactTotal), '赞+藏+评')}
      ${card('总品宣费', fmtYuan(d.brandSpend), '合作+投流+置换', true)}
      ${card('CPM', d.cpm.toFixed(2), '千次曝光成本')}
      ${card('平均互动率', d.avgInterRate.toFixed(2) + '<small>%</small>', '互动/曝光')}
    </div>`;
  }

  function renderTrend(d) {
    if (!d.trend.labels.length) return '<div class="mp-panel"><div style="text-align:center;color:var(--text-muted);padding:24px 0">本月暂无数据</div></div>';
    return `<div class="mp-panel">
      <div class="mp-hint">柱＝花费(元) · 折线＝播放(万) · 双轴按 CPM=10 对齐</div>
      <div style="position:relative;height:230px"><canvas id="mp-trend-canvas"></canvas></div>
    </div>`;
  }

  function renderTypePlatform(d) {
    if (!d.typeAgg.length) {
      return '<div class="mp-panel"><div style="text-align:center;color:var(--text-muted);padding:30px 0">📭 本月暂无达人合作内容</div></div>';
    }
    const maxExp = Math.max(...d.typeAgg.map(t => t.exp), 0) || 1;
    const rows = d.typeAgg.map(t => `
      <tr>
        <td style="text-align:left"><span class="mp-chip">${esc(t.name)}</span></td>
        <td><div class="mp-exp"><div class="mp-bartrack"><div class="mp-bar" style="width:${Math.max(2, Math.round(t.exp / maxExp * 100))}%"></div></div><span class="mp-expval">${fmtWan(t.exp)}</span></div></td>
        <td style="text-align:right">${fmtInt(t.count)}</td>
      </tr>`).join('');
    const totalExp = d.typeAgg.reduce((s, t) => s + t.exp, 0);
    const totalCnt = d.typeAgg.reduce((s, t) => s + t.count, 0);
    const totalPlat = d.platDist.reduce((s, x) => s + x.count, 0) || 1;
    const legend = d.platDist.map((x, i) =>
      `<li><i class="mp-dot" style="background:${PLAT_COLORS[i % PLAT_COLORS.length]}"></i>${esc(x.name)}<b>${Math.round(x.count / totalPlat * 100)}%</b></li>`).join('');
    return `
      <div class="mp-panel mp-split">
        <div class="mp-col" style="flex:1.5">
          <h3 class="mp-h3">按达人类型</h3><div class="mp-hint">全平台总曝光 + 发布次数（每条发布计1）</div>
          <table class="mp-tbl">
            <thead><tr><th>达人类型</th><th>总曝光</th><th>发布次数</th></tr></thead>
            <tbody>${rows}
              <tr class="tot"><td>合计</td><td style="text-align:right">${fmtWan(totalExp)}</td><td style="text-align:right">${fmtInt(totalCnt)}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="mp-divider"></div>
        <div class="mp-col" style="flex:1;display:flex;flex-direction:column">
          <h3 class="mp-h3">🧩 平台作品分布</h3><div class="mp-hint">各平台作品数占比（每条发布计1，与数据看板一致）</div>
          <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;padding:6px 0">
            <div style="position:relative;width:130px;height:130px;flex-shrink:0">
              <canvas id="mp-donut-canvas"></canvas>
              <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
                <div style="font-size:1.05rem;font-weight:800">${fmtInt(totalPlat)}</div>
                <div style="font-size:.6rem;color:var(--text-muted)">条作品</div>
              </div>
            </div>
            <ul class="mp-dl">${legend}</ul>
          </div>
        </div>
      </div>`;
  }

  function renderRank(d) {
    const hot = d.topHot.length ? d.topHot.map((x, i) => `
      <div class="mp-row"><div class="mp-no ${i === 0 ? 'g1' : ''}">${i + 1}</div>
        <div class="mp-nm">${esc(x.talent)} <span style="color:var(--text-muted)">· ${esc(x.plat || '-')}</span></div>
        <div class="mp-mt"><b>${fmtWan(x.exp)}</b> · ${fmtInt(x.inter)}</div></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:.8rem;padding:10px 0">暂无数据</div>';
    const val = d.topValue.length ? d.topValue.map((x, i) => `
      <div class="mp-row"><div class="mp-no ${i === 0 ? 'g1' : ''}">${i + 1}</div>
        <div class="mp-nm">${esc(x.talent)}</div>
        <div class="mp-mt">${fmtYuan(x.cost)}·${fmtWan(x.exp)} <b>CPM ${x.cpm.toFixed(2)}</b></div></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:.8rem;padding:10px 0">暂无付费内容</div>';
    return `
      <div class="mp-two">
        <div class="mp-rank"><h3 class="mp-h3">🔥 爆款 Top5 <span style="color:var(--text-muted);font-weight:400;font-size:.72rem">按曝光</span></h3>${hot}</div>
        <div class="mp-rank"><h3 class="mp-h3">💰 性价比 Top5 <span style="color:var(--text-muted);font-weight:400;font-size:.72rem">按CPM最低</span></h3>${val}</div>
      </div>`;
  }

  function renderReview(d) {
    const key = `${state.year}-${pad2(state.month)}`;
    const DB = window.DB || {};
    const saved = (DB.monthly_reviews || {})[key] || '';
    const topType = (d.typeAgg[0] || {}).name || '—';
    const bestVal = d.topValue[0];
    const auto = d.contentCount
      ? `自动小结：本月发布 ${fmtInt(d.contentCount)} 条达人内容、总曝光 ${fmtWan(d.exposureWan)}，「${esc(topType)}」曝光最高${bestVal ? `；性价比最优为「${esc(bestVal.talent)}」（CPM ${bestVal.cpm.toFixed(2)}）` : ''}。`
      : '自动小结：本月暂无达人合作内容。';
    return `
      <div class="mp-review">
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6">${auto}</div>
        <textarea class="mp-review-box" placeholder="✍️ 写点本月复盘心得…（失焦自动保存）"
          onblur="MonthlyPlanPage.saveReview(this.value)">${esc(saved)}</textarea>
      </div>`;
  }

  /* ------------------------- Chart.js 图表 ------------------------- */
  function destroyCharts() {
    if (state._trendChart) { try { state._trendChart.destroy(); } catch (e) {} state._trendChart = null; }
    if (state._donutChart) { try { state._donutChart.destroy(); } catch (e) {} state._donutChart = null; }
  }
  function buildCharts(d) {
    if (!window.Chart) return;
    destroyCharts();
    const tc = document.getElementById('mp-trend-canvas');
    if (tc && d.trend.labels.length) {
      const maxV = Math.max(...d.trend.views, 0);
      const maxC = Math.max(...d.trend.spend, 0);
      const yMax = Math.max(maxV, maxC / 100) * 1.15 || 10;
      state._trendChart = new Chart(tc, {
        data: {
          labels: d.trend.labels,
          datasets: [
            { type: 'bar', label: '花费（元）', data: d.trend.spend, backgroundColor: 'rgba(245,158,11,.45)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3, yAxisID: 'y1' },
            { type: 'line', label: '播放量（万）', data: d.trend.views, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: 0.4, pointRadius: 2, borderWidth: 2, yAxisID: 'y' },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { labels: { font: { size: 11 }, boxWidth: 12 } },
            tooltip: { callbacks: { afterBody: () => '— CPM=10 基准：等高时刚好1元/100次' } }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, autoSkip: false, maxRotation: 0, minRotation: 0 } },
            y: { position: 'left', min: 0, max: yMax, ticks: { font: { size: 10 }, color: '#3b82f6' }, title: { display: true, text: '播放量(万)', font: { size: 9 }, color: '#3b82f6' } },
            y1: { position: 'right', min: 0, max: yMax * 100, ticks: { font: { size: 10 }, color: '#d97706' }, title: { display: true, text: '花费(元)', font: { size: 9 }, color: '#d97706' }, grid: { drawOnChartArea: false } },
          }
        }
      });
    }
    const dc = document.getElementById('mp-donut-canvas');
    if (dc && d.platDist.length) {
      state._donutChart = new Chart(dc, {
        type: 'doughnut',
        data: { labels: d.platDist.map(x => x.name), datasets: [{ data: d.platDist.map(x => x.count), backgroundColor: PLAT_COLORS.slice(0, d.platDist.length), borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false } } }
      });
    }
  }

  /* ------------------------- 主渲染 ------------------------- */
  function render() {
    initState();
    ensureStyle();
    destroyCharts();
    const page = document.getElementById('page-monthly-plan');
    if (!page) return;
    const winY = window.scrollY;
    const d = computeData();
    const monthLabel = `${state.year}-${pad2(state.month)}`;
    page.innerHTML = `
      <div id="sched-budget-host" class="mp-wrap">
        <div class="mp-head">
          <h1 class="mp-title">月度总结</h1>
          <div class="mp-mn">
            <button class="sched-month-btn" onclick="MonthlyPlanPage.prevMonth()" title="上月">‹</button>
            <b>${monthLabel}</b>
            <button class="sched-month-btn" onclick="MonthlyPlanPage.nextMonth()" title="下月">›</button>
            <button class="sched-month-today" onclick="MonthlyPlanPage.goToday()">本月</button>
          </div>
          <span class="mp-tag">仅统计达人合作内容</span>
        </div>

        <div class="mp-sec">① 本月总览</div>
        ${renderCards(d)}

        <div class="mp-sec">② 每日花费与播放趋势</div>
        ${renderTrend(d)}

        <div class="mp-sec">③ 达人类型 × 平台</div>
        ${renderTypePlatform(d)}

        <div class="mp-sec">④ 本月榜单</div>
        ${renderRank(d)}

        <div class="mp-sec">⑤ 本月复盘</div>
        ${renderReview(d)}
      </div>`;
    requestAnimationFrame(() => {
      buildCharts(d);
      if (winY) window.scrollTo(0, winY);
    });
  }

  function ensureStyle() {
    if (document.getElementById('mp-style')) return;
    const s = document.createElement('style');
    s.id = 'mp-style';
    s.textContent = `
      #page-monthly-plan .mp-wrap{padding:2px}
      #page-monthly-plan .mp-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
      #page-monthly-plan .mp-title{font-size:1.25rem;font-weight:700;margin:0}
      #page-monthly-plan .mp-mn{display:flex;align-items:center;gap:8px;font-weight:600}
      #page-monthly-plan .mp-tag{font-size:.72rem;color:var(--text-secondary);background:var(--bg-hover);padding:3px 10px;border-radius:20px}
      #page-monthly-plan .mp-sec{font-size:.8rem;font-weight:700;color:var(--text-secondary);margin:20px 2px 10px;letter-spacing:.3px}
      #page-monthly-plan .mp-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
      @media(max-width:900px){#page-monthly-plan .mp-cards{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:560px){#page-monthly-plan .mp-cards{grid-template-columns:repeat(2,1fr)}}
      #page-monthly-plan .mp-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:12px 13px}
      #page-monthly-plan .mp-card .k{font-size:.72rem;color:var(--text-secondary);margin-bottom:6px;white-space:nowrap}
      #page-monthly-plan .mp-card .v{font-size:1.25rem;font-weight:800;line-height:1}
      #page-monthly-plan .mp-card .v small{font-size:.62em;font-weight:600;color:var(--text-muted)}
      #page-monthly-plan .mp-card.hi .v{color:var(--primary)}
      #page-monthly-plan .mp-card .u{font-size:.64rem;color:var(--text-muted);margin-top:5px}
      #page-monthly-plan .mp-panel{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:13px 15px}
      #page-monthly-plan .mp-h3{font-size:.86rem;margin:0 0 3px;font-weight:700}
      #page-monthly-plan .mp-hint{font-size:.66rem;color:var(--text-muted);margin-bottom:8px}
      #page-monthly-plan .mp-split{display:flex;align-items:stretch;padding:0}
      #page-monthly-plan .mp-split .mp-col{padding:13px 16px;min-width:0}
      #page-monthly-plan .mp-split .mp-divider{width:1px;background:var(--border);flex-shrink:0}
      @media(max-width:760px){#page-monthly-plan .mp-split{flex-direction:column}#page-monthly-plan .mp-split .mp-divider{width:auto;height:1px}}
      #page-monthly-plan .mp-tbl{width:100%;border-collapse:collapse;font-size:.82rem}
      #page-monthly-plan .mp-tbl th{color:var(--text-secondary);font-weight:600;text-align:right;padding:7px 9px;border-bottom:1px solid var(--border);white-space:nowrap}
      #page-monthly-plan .mp-tbl th:first-child,#page-monthly-plan .mp-tbl td:first-child{text-align:left}
      #page-monthly-plan .mp-tbl td{padding:7px 9px;border-bottom:1px solid var(--border);text-align:right}
      #page-monthly-plan .mp-tbl tr.tot td{border-bottom:none;font-weight:700;background:var(--bg-hover)}
      #page-monthly-plan .mp-chip{display:inline-block;font-size:.72rem;padding:2px 9px;border-radius:5px;background:var(--bg-hover);color:var(--text-secondary)}
      #page-monthly-plan .mp-exp{display:flex;align-items:center;gap:8px;justify-content:flex-end}
      #page-monthly-plan .mp-bartrack{width:84px;flex:none;height:7px;border-radius:4px;background:var(--bg-hover);overflow:hidden}
      #page-monthly-plan .mp-expval{display:inline-block;min-width:58px;text-align:right}
      #page-monthly-plan .mp-bar{height:7px;border-radius:4px;background:var(--primary);opacity:.85}
      #page-monthly-plan .mp-dl{list-style:none;margin:0;padding:0;font-size:.78rem}
      #page-monthly-plan .mp-dl li{display:flex;align-items:center;gap:7px;padding:3px 0;color:var(--text-secondary);min-width:120px}
      #page-monthly-plan .mp-dl li b{margin-left:auto;color:var(--text-primary)}
      #page-monthly-plan .mp-dot{width:9px;height:9px;border-radius:2px;display:inline-block;flex-shrink:0}
      #page-monthly-plan .mp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      @media(max-width:760px){#page-monthly-plan .mp-two{grid-template-columns:1fr}}
      #page-monthly-plan .mp-rank{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
      #page-monthly-plan .mp-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid var(--border);font-size:.8rem}
      #page-monthly-plan .mp-row:last-child{border-bottom:none}
      #page-monthly-plan .mp-no{width:18px;height:18px;flex-shrink:0;border-radius:5px;background:var(--bg-hover);color:var(--text-secondary);font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center}
      #page-monthly-plan .mp-no.g1{background:var(--primary);color:#fff}
      #page-monthly-plan .mp-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
      #page-monthly-plan .mp-mt{color:var(--text-secondary);font-variant-numeric:tabular-nums}
      #page-monthly-plan .mp-mt b{color:var(--primary);font-weight:700}
      #page-monthly-plan .mp-review{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:13px 15px}
      #page-monthly-plan .mp-review-box{margin-top:9px;width:100%;box-sizing:border-box;min-height:60px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:.82rem;resize:vertical;outline:none;background:var(--bg-base);color:var(--text-primary)}
      #page-monthly-plan .mp-review-box:focus{border-color:var(--primary)}`;
    document.head.appendChild(s);
  }

  function prevMonth() { if (state.month === 1) { state.year--; state.month = 12; } else state.month--; render(); }
  function nextMonthAction() { if (state.month === 12) { state.year++; state.month = 1; } else state.month++; render(); }
  function goToday() { const d = new Date(); state.year = d.getFullYear(); state.month = d.getMonth() + 1; render(); }
  function setMonth(y, m) { state.year = y; state.month = m; render(); }
  function saveReview(v) {
    const DB = window.DB || (window.DB = {});
    if (!DB.monthly_reviews) DB.monthly_reviews = {};
    const key = `${state.year}-${pad2(state.month)}`;
    const val = String(v || '').trim();
    if (val) DB.monthly_reviews[key] = val; else delete DB.monthly_reviews[key];
    if (window.saveData) window.saveData();
    window.toast && window.toast('已保存本月复盘', 'success', 1500);
  }

  window.MonthlyPlanPage = {
    render, prevMonth, nextMonth: nextMonthAction, goToday, setMonth, saveReview,
    getState() { return { year: state.year, month: state.month }; },
  };
  console.log('[MonthlyPlanPage] 月度总结已就绪');
})();
