/* =====================================================================
 * 离火品宣 · 数据看板（原「月度总结」，支持任意时间区间）
 *
 * 时间维度：本周 / 本月 / 上月 / 近7天 / 近30天 / 自定义区间。
 * 统计只算达人合作内容。曝光/花费/CPM/趋势复用 getBrandRoiMatrix（按月）在区间内逐日汇总，
 * 与「品宣ROI」口径一致；达人类型/平台作品分布/榜单按区间内每条发布统计。
 * 复盘（本月复盘）按“月”写，跟随当前区间所属月份（区间结束日的月份）始终显示。
 *
 * 暴露：window.MonthlyPlanPage = { render, prevMonth, nextMonth, goToday, setMonth, setMode, setCustom, saveReview, _updateCount, getState }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[DataDashboard] ScheduleData 未就绪'); return; }

  const state = {
    mode: 'month',              // month | week | d7 | d30 | custom
    year: 0, month: 0,          // month 模式所看月份
    customStart: '', customEnd: '',
    _trendChart: null, _donutChart: null,
    _anchorKey: '', _gated: false,
  };
  const PLAT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
  const REVIEW_MIN = 100;

  function initState() {
    if (state.year) return;
    const d = new Date();
    state.year = d.getFullYear(); state.month = d.getMonth() + 1;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const fmtYuan = (n) => '¥' + fmtInt(n);
  const fmtWan = (n) => { const v = Number(n) || 0; return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)).replace(/\.?0+$/, '') + '万'; };
  const monthOrd = (y, m) => y * 12 + (m - 1);
  const lastDay = (y, m) => new Date(y, m, 0).getDate();

  /* ------------------------- 当前时间区间 ------------------------- */
  function activeRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const monthRange = (yy, mm) => ({
      start: `${yy}-${pad2(mm)}-01`, end: `${yy}-${pad2(mm)}-${pad2(lastDay(yy, mm))}`,
      anchorY: yy, anchorM: mm, isMonth: true, label: `${yy}-${pad2(mm)}`,
    });
    if (state.mode === 'week') {
      const dow = (now.getDay() + 6) % 7;                 // 周一=0
      const s = new Date(y, m, d - dow), e = new Date(y, m, d - dow + 6);
      return { start: fmtDate(s), end: fmtDate(e), anchorY: e.getFullYear(), anchorM: e.getMonth() + 1, isMonth: false, label: `本周（${fmtDate(s).slice(5)} ~ ${fmtDate(e).slice(5)}）` };
    }
    if (state.mode === 'd7') { const s = new Date(y, m, d - 6); return { start: fmtDate(s), end: fmtDate(now), anchorY: y, anchorM: m + 1, isMonth: false, label: `近7天` }; }
    if (state.mode === 'd30') { const s = new Date(y, m, d - 29); return { start: fmtDate(s), end: fmtDate(now), anchorY: y, anchorM: m + 1, isMonth: false, label: `近30天` }; }
    if (state.mode === 'custom') {
      const s = state.customStart || fmtDate(now), e = state.customEnd || fmtDate(now);
      const lo = s <= e ? s : e, hi = s <= e ? e : s;
      const em = hi.split('-');
      return { start: lo, end: hi, anchorY: Number(em[0]), anchorM: Number(em[1]), isMonth: false, label: `自定义` };
    }
    return monthRange(state.year, state.month);
  }

  /* ------------------------- 区间统计 ------------------------- */
  // 曝光/花费/CPM/趋势：复用 getBrandRoiMatrix（按月）逐日在区间内汇总
  function rangeStats(start, end) {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    const cache = {};
    const getM = (y, m) => { const k = y + '-' + m; return cache[k] || (cache[k] = (SD.getBrandRoiMatrix ? SD.getBrandRoiMatrix({ year: y, month: m }) : { totalsPerDay: {} })); };
    const singleMonth = start.slice(0, 7) === end.slice(0, 7);
    const labels = [], spend = [], views = [];
    let exposureWan = 0, spendTotal = 0;
    let cur = new Date(sy, sm - 1, sd); const endD = new Date(ey, em - 1, ed);
    let guard = 0;
    while (cur <= endD && guard++ < 800) {
      const y = cur.getFullYear(), m = cur.getMonth() + 1, dd = pad2(cur.getDate());
      const t = getM(y, m).totalsPerDay[dd] || { spend: 0, exposure: 0 };
      labels.push(singleMonth ? String(cur.getDate()) : `${m}/${cur.getDate()}`);
      spend.push(Math.round(t.spend || 0));
      views.push(Number((t.exposure || 0).toFixed(2)));
      exposureWan += (t.exposure || 0);
      spendTotal += (t.spend || 0);
      cur.setDate(cur.getDate() + 1);
    }
    const cpm = exposureWan > 0 ? spendTotal / (exposureWan * 10000) * 1000 : 0;
    return { labels, spend, views, exposureWan, brandSpend: spendTotal, cpm: Number(cpm.toFixed(2)) };
  }

  function computeData(range) {
    const { start, end } = range;
    const inRange = (d) => !!d && d >= start && d <= end;
    const platOrder = (SD.listPlatforms ? SD.listPlatforms() : []).map(p => p.name);

    const typeMap = {}, perPlatform = {}, perContent = [];
    const contentSet = new Set();
    let interactTotal = 0;

    ((window.DB && window.DB.contents) || []).forEach(c => {
      const pubs = c.publications || [];
      const monthPubs = pubs.filter(p => inRange(p.date));
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
        t.exp += exp; t.count += 1;
        const plat = p.platform || '其他';
        perPlatform[plat] = (perPlatform[plat] || 0) + 1;
      });
      perContent.push({ talent: r.talent, plat: mainPlat, exp: cExp, inter: cInter, cost: (Number(r.price) || 0) + cPromo });
    });

    const typeAgg = Object.entries(typeMap).map(([name, v]) => ({ name, exp: v.exp, count: v.count })).sort((a, b) => b.exp - a.exp);
    const platDist = Object.entries(perPlatform).map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const ia = platOrder.indexOf(a.name), ib = platOrder.indexOf(b.name);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1; if (ib !== -1) return 1;
        return b.count - a.count;
      });

    const rs = rangeStats(start, end);
    const pubCount = platDist.reduce((s, x) => s + x.count, 0);
    const avgInterRate = rs.exposureWan > 0 ? interactTotal / (rs.exposureWan * 10000) * 100 : 0;
    const topHot = perContent.filter(x => x.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, 5);
    const topValue = perContent.filter(x => x.cost > 0 && x.exp > 0)
      .map(x => ({ ...x, cpm: x.cost / (x.exp * 10000) * 1000 }))
      .sort((a, b) => a.cpm - b.cpm).slice(0, 5);

    return {
      contentCount: contentSet.size, pubCount,
      exposureWan: rs.exposureWan, brandSpend: rs.brandSpend, cpm: rs.cpm,
      interactTotal, avgInterRate,
      typeAgg, platDist, topHot, topValue,
      trend: { labels: rs.labels, spend: rs.spend, views: rs.views },
    };
  }

  /* ------------------------- 渲染 ------------------------- */
  function renderTimeBar(range) {
    const now = new Date();
    const thisY = now.getFullYear(), thisM = now.getMonth() + 1;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const isThisMonth = state.mode === 'month' && state.year === thisY && state.month === thisM;
    const isLastMonth = state.mode === 'month' && state.year === prev.getFullYear() && state.month === (prev.getMonth() + 1);
    const chips = [
      { key: 'week', label: '本周', on: state.mode === 'week' },
      { key: 'thisMonth', label: '本月', on: isThisMonth },
      { key: 'lastMonth', label: '上月', on: isLastMonth },
      { key: 'd7', label: '近7天', on: state.mode === 'd7' },
      { key: 'd30', label: '近30天', on: state.mode === 'd30' },
      { key: 'custom', label: '自定义', on: state.mode === 'custom' },
    ];
    const chipHtml = chips.map(c => `<button class="mp-chip-btn ${c.on ? 'active' : ''}" onclick="MonthlyPlanPage.setMode('${c.key}')">${c.label}</button>`).join('');
    const custom = state.mode === 'custom'
      ? `<span class="mp-custom"><input type="date" value="${esc(state.customStart)}" onchange="MonthlyPlanPage.setCustom('start',this.value)"> ~ <input type="date" value="${esc(state.customEnd)}" onchange="MonthlyPlanPage.setCustom('end',this.value)"></span>`
      : '';
    const nav = range.isMonth
      ? `<div class="mp-mn"><button class="sched-month-btn" onclick="MonthlyPlanPage.prevMonth()" title="上月">‹</button><b>${range.label}</b><button class="sched-month-btn" onclick="MonthlyPlanPage.nextMonth()" title="下月">›</button></div>`
      : `<div class="mp-mn"><b>${esc(range.start)} ~ ${esc(range.end)}</b></div>`;
    return `
      <div class="mp-head">
        <h1 class="mp-title">数据看板</h1>
        ${nav}
        <span class="mp-tag">仅统计达人合作内容</span>
      </div>
      <div class="mp-filter">${chipHtml}${custom}</div>`;
  }

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
    if (!d.trend.labels.length) return '<div class="mp-panel"><div style="text-align:center;color:var(--text-muted);padding:24px 0">本区间暂无数据</div></div>';
    return `<div class="mp-panel">
      <div class="mp-hint">柱＝花费(元) · 折线＝播放(万) · 双轴按 CPM=10 对齐</div>
      <div style="position:relative;height:230px"><canvas id="mp-trend-canvas"></canvas></div>
    </div>`;
  }

  function renderTypePlatform(d) {
    if (!d.typeAgg.length) return '<div class="mp-panel"><div style="text-align:center;color:var(--text-muted);padding:30px 0">📭 本区间暂无达人合作内容</div></div>';
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
          <h3 class="mp-h3">🧩 平台作品分布</h3><div class="mp-hint">各平台作品数占比（每条发布计1，与品宣ROI一致）</div>
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

  function _countHtml(len) {
    const ok = len >= REVIEW_MIN;
    const color = ok ? 'var(--success)' : 'var(--danger)';
    const tail = ok ? ' ✓ 已达标' : (state._gated ? `（还差 ${REVIEW_MIN - len} 字，达标才能进入下月）` : `（建议不少于 ${REVIEW_MIN} 字）`);
    return `本月复盘：已写 <b style="color:${color}">${len}</b> / ${REVIEW_MIN} 字${tail}`;
  }
  const _reviewLen = (v) => [...String(v == null ? '' : v).trim()].length;
  function _updateCount(box) { const el = document.getElementById('mp-review-count'); if (el) el.innerHTML = _countHtml(_reviewLen(box && box.value)); }

  function renderReview(d, range) {
    const key = state._anchorKey;
    const saved = ((window.DB && window.DB.monthly_reviews) || {})[key] || '';
    const topType = (d.typeAgg[0] || {}).name || '—';
    const bestVal = d.topValue[0];
    const auto = d.contentCount
      ? `自动小结：本区间发布 ${fmtInt(d.contentCount)} 条达人内容、总曝光 ${fmtWan(d.exposureWan)}，「${esc(topType)}」曝光最高${bestVal ? `；性价比最优为「${esc(bestVal.talent)}」（CPM ${bestVal.cpm.toFixed(2)}）` : ''}。`
      : '自动小结：本区间暂无达人合作内容。';
    const monthName = `${range.anchorY}年${range.anchorM}月`;
    return `
      <div class="mp-review">
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6">${auto}</div>
        <div style="font-size:.74rem;color:var(--text-muted);margin:8px 0 4px">✍️ ${esc(monthName)} · 本月复盘（按月填写，此处修改会同步到「复盘总结」）</div>
        <textarea class="mp-review-box" placeholder="✍️ 写点本月复盘心得（不少于 ${REVIEW_MIN} 字），达标才能进入下月…"
          oninput="MonthlyPlanPage._updateCount(this)" onblur="MonthlyPlanPage.saveReview(this.value)">${esc(saved)}</textarea>
        <div class="mp-review-count" id="mp-review-count">${_countHtml(_reviewLen(saved))}</div>
      </div>`;
  }

  function render() {
    initState();
    ensureStyle();
    destroyCharts();
    const page = document.getElementById('page-monthly-plan');
    if (!page) return;
    const winY = window.scrollY;
    const range = activeRange();
    state._anchorKey = `${range.anchorY}-${pad2(range.anchorM)}`;
    state._gated = state.mode === 'month' && monthOrd(range.anchorY, range.anchorM) >= monthOrd(new Date().getFullYear(), new Date().getMonth() + 1);
    const d = computeData(range);
    page.innerHTML = `
      <div id="sched-budget-host" class="mp-wrap">
        ${renderTimeBar(range)}
        <div class="mp-sec">① 总览</div>
        ${renderCards(d)}
        <div class="mp-sec">② 每日花费与播放趋势</div>
        ${renderTrend(d)}
        <div class="mp-sec">③ 达人类型 × 平台</div>
        ${renderTypePlatform(d)}
        <div class="mp-sec">④ 榜单</div>
        ${renderRank(d)}
        <div class="mp-sec">⑤ 本月复盘</div>
        ${renderReview(d, range)}
      </div>`;
    requestAnimationFrame(() => { buildCharts(d); if (winY) window.scrollTo(0, winY); });
  }

  /* ------------------------- Chart.js ------------------------- */
  function destroyCharts() {
    if (state._trendChart) { try { state._trendChart.destroy(); } catch (e) {} state._trendChart = null; }
    if (state._donutChart) { try { state._donutChart.destroy(); } catch (e) {} state._donutChart = null; }
  }
  function buildCharts(d) {
    if (!window.Chart) return;
    destroyCharts();
    const tc = document.getElementById('mp-trend-canvas');
    if (tc && d.trend.labels.length) {
      const maxV = Math.max(...d.trend.views, 0), maxC = Math.max(...d.trend.spend, 0);
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
          plugins: { legend: { labels: { font: { size: 11 }, boxWidth: 12 } }, tooltip: { callbacks: { afterBody: () => '— CPM=10 基准：等高时刚好1元/100次' } } },
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

  /* ------------------------- 样式 ------------------------- */
  function ensureStyle() {
    if (document.getElementById('mp-style')) return;
    const s = document.createElement('style');
    s.id = 'mp-style';
    s.textContent = `
      #page-monthly-plan .mp-wrap{padding:2px}
      #page-monthly-plan .mp-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:10px}
      #page-monthly-plan .mp-title{font-size:1.25rem;font-weight:700;margin:0}
      #page-monthly-plan .mp-mn{display:flex;align-items:center;gap:8px;font-weight:600}
      #page-monthly-plan .mp-tag{font-size:.72rem;color:var(--text-secondary);background:var(--bg-hover);padding:3px 10px;border-radius:20px}
      #page-monthly-plan .mp-filter{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px}
      #page-monthly-plan .mp-chip-btn{border:1px solid var(--border);background:var(--bg-panel);color:var(--text-secondary);font-size:.78rem;padding:5px 13px;border-radius:16px;cursor:pointer}
      #page-monthly-plan .mp-chip-btn.active{background:var(--primary);color:#fff;border-color:var(--primary);font-weight:600}
      #page-monthly-plan .mp-custom{display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary);font-size:.8rem}
      #page-monthly-plan .mp-custom input{height:30px;border:1px solid var(--border);border-radius:6px;padding:0 6px;font-size:.8rem;background:var(--bg-panel);color:var(--text-primary)}
      #page-monthly-plan .mp-sec{font-size:.8rem;font-weight:700;color:var(--text-secondary);margin:18px 2px 10px;letter-spacing:.3px}
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
      #page-monthly-plan .mp-bar{height:7px;border-radius:4px;background:var(--primary);opacity:.85}
      #page-monthly-plan .mp-expval{display:inline-block;min-width:58px;text-align:right}
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
      #page-monthly-plan .mp-review-box{margin-top:4px;width:100%;box-sizing:border-box;min-height:60px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:.82rem;resize:vertical;outline:none;background:var(--bg-base);color:var(--text-primary)}
      #page-monthly-plan .mp-review-box:focus{border-color:var(--primary)}
      #page-monthly-plan .mp-review-count{font-size:.72rem;margin-top:6px;color:var(--text-secondary)}`;
    document.head.appendChild(s);
  }

  /* ------------------------- 交互 ------------------------- */
  function setMode(key) {
    const now = new Date();
    if (key === 'thisMonth') { state.mode = 'month'; state.year = now.getFullYear(); state.month = now.getMonth() + 1; }
    else if (key === 'lastMonth') { const p = new Date(now.getFullYear(), now.getMonth() - 1, 1); state.mode = 'month'; state.year = p.getFullYear(); state.month = p.getMonth() + 1; }
    else if (key === 'custom') { state.mode = 'custom'; if (!state.customStart) { const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6); state.customStart = fmtDate(s); state.customEnd = fmtDate(now); } }
    else { state.mode = key; }
    render();
  }
  function setCustom(field, v) {
    if (field === 'start') state.customStart = v; else state.customEnd = v;
    if (state.customStart && state.customEnd) render();
  }
  function prevMonth() { if (state.month === 1) { state.year--; state.month = 12; } else state.month--; render(); }
  function nextMonthAction() {
    if (state._gated) {
      const box = document.querySelector('#page-monthly-plan .mp-review-box');
      const val = box ? String(box.value || '').trim() : String((((window.DB && window.DB.monthly_reviews) || {})[state._anchorKey]) || '').trim();
      const len = _reviewLen(val);
      if (len < REVIEW_MIN) {
        window.toast && window.toast(`请先填写本月复盘（不少于 ${REVIEW_MIN} 字，当前 ${len} 字），才能进入下月`, 'error', 3500);
        if (box) { _updateCount(box); box.focus(); }
        return;
      }
      const DB = window.DB || (window.DB = {});
      if (!DB.monthly_reviews) DB.monthly_reviews = {};
      DB.monthly_reviews[state._anchorKey] = val;
      if (window.saveData) window.saveData();
    }
    if (state.month === 12) { state.year++; state.month = 1; } else state.month++;
    render();
  }
  function goToday() { const d = new Date(); state.mode = 'month'; state.year = d.getFullYear(); state.month = d.getMonth() + 1; render(); }
  function setMonth(y, m) { state.mode = 'month'; state.year = y; state.month = m; render(); }
  function saveReview(v) {
    const DB = window.DB || (window.DB = {});
    if (!DB.monthly_reviews) DB.monthly_reviews = {};
    const key = state._anchorKey;
    const val = String(v || '').trim();
    if (val) DB.monthly_reviews[key] = val; else delete DB.monthly_reviews[key];
    if (window.saveData) window.saveData();
    window.toast && window.toast('已保存本月复盘', 'success', 1500);
  }

  window.MonthlyPlanPage = {
    render, prevMonth, nextMonth: nextMonthAction, goToday, setMonth, setMode, setCustom, saveReview, _updateCount,
    getState() { return { year: state.year, month: state.month, mode: state.mode }; },
  };
  console.log('[DataDashboard] 数据看板已就绪');
})();
