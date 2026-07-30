/* =====================================================================
 * 离火品宣 · 月度总结（原「月度规划表」改造）
 *
 * 只统计达人合作内容（listContents，排除占位）。总览口径与「品宣ROI」一致
 * （复用 getBrandRoiMatrix().kpi）。核心是「达人类型 × 平台」交叉热力矩阵，
 * 单元格指标可切换（曝光/发布数/花费/CPM），当月无数据的类型行/平台列自动隐藏。
 *
 * 暴露：window.MonthlyPlanPage = { render, prevMonth, nextMonth, goToday, setMonth, setMetric, saveReview, getState }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[MonthlyPlanPage] ScheduleData 未就绪'); return; }

  const state = { year: 0, month: 0, metric: 'exposure' };

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

  const METRICS = [
    { key: 'exposure', label: '曝光' },
    { key: 'count',    label: '发布数' },
    { key: 'cost',     label: '花费' },
    { key: 'cpm',      label: 'CPM' },
  ];

  /* ------------------------- 数据计算 ------------------------- */
  function computeData() {
    const { year, month } = state;
    const roi = SD.getBrandRoiMatrix ? SD.getBrandRoiMatrix({ year, month }) : { kpi: {} };
    const comm = SD.getCommunicationKPI ? SD.getCommunicationKPI({ year, month }) : {};
    const contents = (SD.listContents ? SD.listContents({ year, month }) : []).filter(hasRealData);

    const platOrder = (SD.listPlatforms ? SD.listPlatforms() : []).map(p => p.name);
    const cellMap = {};                 // `${type}${plat}` -> {exp,count,cost,inter}
    const typeSet = new Set(), platSet = new Set();
    const perContent = [];
    let interactTotal = 0;

    contents.forEach(c => {
      const r = SD.resolveContent(c);
      const type = (r.category || '').trim() || '未标注';
      const pubs = c.publications || [];
      const mainPlat = pubs[0] ? pubs[0].platform : '';
      let cExp = 0, cInter = 0, cPromo = 0;
      pubs.forEach((p, idx) => {
        const plat = p.platform; if (!plat) return;
        const exp = (Number(p.views) || 0) + (Number(p.promo_views) || 0);   // 万
        const inter = (Number(p.likes) || 0) + (Number(p.collects) || 0) + (Number(p.comments) || 0);
        const promoCost = Number(p.promo_cost) || 0;
        const cost = promoCost + ((idx === 0 && plat === mainPlat) ? (Number(r.price) || 0) : 0);
        typeSet.add(type); platSet.add(plat);
        const key = type + '' + plat;
        const cell = cellMap[key] || (cellMap[key] = { exp: 0, count: 0, cost: 0, inter: 0 });
        cell.exp += exp; cell.count += 1; cell.cost += cost; cell.inter += inter;
        cExp += exp; cInter += inter; cPromo += promoCost;
        interactTotal += inter;
      });
      perContent.push({ talent: r.talent, plat: mainPlat, type, exp: cExp, inter: cInter, cost: (Number(r.price) || 0) + cPromo });
    });

    const platforms = platOrder.filter(p => platSet.has(p)).concat([...platSet].filter(p => !platOrder.includes(p)));
    const types = [...typeSet].map(t => {
      let exp = 0; platforms.forEach(p => { const c = cellMap[t + '' + p]; if (c) exp += c.exp; });
      return { name: t, exp };
    }).sort((a, b) => b.exp - a.exp).map(t => t.name);

    const topHot = perContent.filter(x => x.exp > 0).sort((a, b) => b.exp - a.exp).slice(0, 5);
    const topValue = perContent.filter(x => x.cost > 0 && x.exp > 0)
      .map(x => ({ ...x, cpm: x.cost / (x.exp * 10000) * 1000 }))
      .sort((a, b) => a.cpm - b.cpm).slice(0, 5);

    const exposureWan = Number(roi.kpi.totalExposure) || 0;
    const brandSpend = Number(roi.kpi.brandSpend) || 0;
    const coopPromo = Number(comm.totalSpend) || 0;
    const replacement = brandSpend - coopPromo;   // 如实(可能因负置换数据为负)，保证与总品宣费对账一致
    const avgInterRate = exposureWan > 0 ? interactTotal / (exposureWan * 10000) * 100 : 0;

    return {
      contentCount: contents.length,
      pubCount: Number(roi.kpi.contentCount) || 0,
      exposureWan, brandSpend, coopPromo, replacement,
      cpm: Number(roi.kpi.cpm) || 0,
      interactTotal, avgInterRate,
      cellMap, platforms, types, topHot, topValue,
    };
  }

  /* ------------------------- 单元格取值/展示 ------------------------- */
  function cellValue(cell, metric) {
    if (!cell) return null;
    if (metric === 'exposure') return cell.exp;
    if (metric === 'count')    return cell.count;
    if (metric === 'cost')     return cell.cost;
    if (metric === 'cpm')      return (cell.exp > 0 && cell.cost > 0) ? cell.cost / (cell.exp * 10000) * 1000 : null;
    return null;
  }
  function cellText(v, metric) {
    if (v == null) return '<span style="color:var(--text-muted)">·</span>';
    if (metric === 'exposure') return fmtWan(v);
    if (metric === 'count')    return fmtInt(v);
    if (metric === 'cost')     return fmtYuan(v);
    if (metric === 'cpm')      return v.toFixed(2);
    return '';
  }
  function heatBg(v, max, metric) {
    if (v == null || v <= 0 || max <= 0) return '';
    if (metric === 'cpm') return 'background:var(--primary-light)';
    const r = v / max;
    if (r >= 0.66) return 'background:var(--primary);color:#fff;font-weight:700';
    if (r >= 0.33) return 'background:rgba(200,30,17,.28)';
    if (r >= 0.12) return 'background:rgba(200,30,17,.14)';
    return 'background:rgba(200,30,17,.06)';
  }

  function renderMatrix(d) {
    const m = state.metric;
    const metricLabel = (METRICS.find(x => x.key === m) || {}).label;
    let max = 0;
    d.types.forEach(t => d.platforms.forEach(p => { const v = cellValue(d.cellMap[t + '' + p], m); if (v != null && v > max) max = v; }));

    const toggle = METRICS.map(x =>
      `<button onclick="MonthlyPlanPage.setMetric('${x.key}')" style="border:1px solid ${x.key === m ? 'var(--primary)' : 'var(--border)'};background:${x.key === m ? 'var(--primary)' : 'var(--bg-panel)'};color:${x.key === m ? '#fff' : 'var(--text-secondary)'};font-size:.75rem;padding:3px 11px;border-radius:14px;cursor:pointer;font-weight:${x.key === m ? '600' : '400'}">${x.label}</button>`
    ).join('');

    let body;
    if (!d.types.length) {
      body = `<div style="text-align:center;color:var(--text-muted);padding:36px 0">📭 本月暂无达人合作内容</div>`;
    } else {
      const thead = `<tr>
        <th style="text-align:left;min-width:90px">类型＼平台</th>
        ${d.platforms.map(p => `<th>${esc(p)}</th>`).join('')}
        <th style="border-left:2px solid var(--border-lit)">合计</th>
      </tr>`;
      const colTotal = {}; d.platforms.forEach(p => colTotal[p] = { exp: 0, count: 0, cost: 0 });
      let grand = { exp: 0, count: 0, cost: 0 };
      const rows = d.types.map(t => {
        let rExp = 0, rCount = 0, rCost = 0;
        const tds = d.platforms.map(p => {
          const cell = d.cellMap[t + '' + p];
          if (cell) { colTotal[p].exp += cell.exp; colTotal[p].count += cell.count; colTotal[p].cost += cell.cost; rExp += cell.exp; rCount += cell.count; rCost += cell.cost; }
          const v = cellValue(cell, m);
          return `<td style="text-align:right;${heatBg(v, max, m)}">${cellText(v, m)}</td>`;
        }).join('');
        grand.exp += rExp; grand.count += rCount; grand.cost += rCost;
        const rv = cellValue({ exp: rExp, count: rCount, cost: rCost }, m);
        return `<tr>
          <td style="text-align:left"><span class="mp-chip">${esc(t)}</span></td>
          ${tds}
          <td style="text-align:right;font-weight:700;border-left:2px solid var(--border-lit)">${cellText(rv, m)}</td>
        </tr>`;
      }).join('');
      const totalTds = d.platforms.map(p => `<td style="text-align:right;font-weight:700">${cellText(cellValue(colTotal[p], m), m)}</td>`).join('');
      const footRow = `<tr style="background:var(--bg-hover)">
        <td style="text-align:left;font-weight:700">合计</td>
        ${totalTds}
        <td style="text-align:right;font-weight:800;border-left:2px solid var(--border-lit)">${cellText(cellValue(grand, m), m)}</td>
      </tr>`;
      body = `<div style="overflow-x:auto"><table class="mp-table"><thead>${thead}</thead><tbody>${rows}${footRow}</tbody></table></div>`;
    }

    const note = m === 'cost' || m === 'cpm'
      ? `<div class="mp-note">花费=合作费+投流费（合作费记在主平台）；<b>置换 ${fmtYuan(d.replacement)}</b> 难以按类型/平台拆分，未计入格子，已计入上方「总品宣费」。</div>`
      : m === 'count'
        ? `<div class="mp-note">发布数=各平台发布次数，一条内容多平台各计一次。</div>`
        : `<div class="mp-note">单元格＝曝光（万），颜色越深越高；「·」表示该类型未在此平台发布。仅显示当月有数据的类型与平台。</div>`;

    return `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:.78rem;color:var(--text-secondary)">格子看：</span>${toggle}
        <span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">当前：${metricLabel}</span>
      </div>
      ${body}${note}`;
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
        <div class="mp-rank"><h3>🔥 爆款 Top5 <span style="color:var(--text-muted);font-weight:400;font-size:.72rem">按曝光</span></h3>${hot}</div>
        <div class="mp-rank"><h3>💰 性价比 Top5 <span style="color:var(--text-muted);font-weight:400;font-size:.72rem">按CPM最低</span></h3>${val}</div>
      </div>`;
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

  function renderReview(d) {
    const key = `${state.year}-${pad2(state.month)}`;
    const DB = window.DB || {};
    const saved = (DB.monthly_reviews || {})[key] || '';
    const topType = d.types[0] || '—';
    const bestVal = d.topValue[0];
    const auto = d.contentCount
      ? `自动小结：本月发布 ${fmtInt(d.contentCount)} 条达人内容、总曝光 ${fmtWan(d.exposureWan)}，「${esc(topType)}」曝光占比最高${bestVal ? `；性价比最优为「${esc(bestVal.talent)}」（CPM ${bestVal.cpm.toFixed(2)}）` : ''}。`
      : '自动小结：本月暂无达人合作内容。';
    return `
      <div class="mp-review">
        <div style="font-size:.82rem;color:var(--text-secondary);line-height:1.6">${auto}</div>
        <textarea class="mp-review-box" placeholder="✍️ 写点本月复盘心得…（失焦自动保存）"
          onblur="MonthlyPlanPage.saveReview(this.value)">${esc(saved)}</textarea>
      </div>`;
  }

  function render() {
    initState();
    ensureStyle();
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

        <div class="mp-sec">② 达人类型 × 平台</div>
        ${renderMatrix(d)}

        <div class="mp-sec">③ 本月榜单</div>
        ${renderRank(d)}

        <div class="mp-sec">④ 本月复盘</div>
        ${renderReview(d)}
      </div>`;
    if (winY) requestAnimationFrame(() => window.scrollTo(0, winY));
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
      #page-monthly-plan .mp-table{width:100%;border-collapse:collapse;background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:.82rem}
      #page-monthly-plan .mp-table th{background:var(--bg-hover);color:var(--text-secondary);font-weight:600;text-align:right;padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
      #page-monthly-plan .mp-table td{padding:8px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
      #page-monthly-plan .mp-table tbody tr:last-child td{border-bottom:none}
      #page-monthly-plan .mp-chip{display:inline-block;font-size:.72rem;padding:2px 9px;border-radius:5px;background:var(--bg-hover);color:var(--text-secondary)}
      #page-monthly-plan .mp-note{font-size:.68rem;color:var(--text-muted);margin-top:6px}
      #page-monthly-plan .mp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      @media(max-width:760px){#page-monthly-plan .mp-two{grid-template-columns:1fr}}
      #page-monthly-plan .mp-rank{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
      #page-monthly-plan .mp-rank h3{font-size:.86rem;margin:0 0 8px;font-weight:700}
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
  function setMetric(k) { state.metric = k; render(); }
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
    render, prevMonth, nextMonth: nextMonthAction, goToday, setMonth, setMetric, saveReview,
    getState() { return { ...state }; },
  };
  console.log('[MonthlyPlanPage] 月度总结已就绪');
})();
