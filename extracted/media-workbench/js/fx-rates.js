/* 汇率记录（系统设置）：央行中间价 USD/CNY
 * 列出所选月份每一天实际使用的汇率（周末/节假日沿用此前最近公布日），
 * 总管理员可立即更新、手动录入或撤销手动值；可导出 Excel 与官网逐日核对。
 */
(function () {
  'use strict';
  const pad2 = n => String(n).padStart(2, '0');
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { month: '', rates: {} };
  const isSuper = () => !!(window.OrgApp && OrgApp.user && OrgApp.user.isSuperAdmin);

  async function api(url, opts) {
    const r = await fetch(url, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
    return body;
  }
  async function load() {
    const data = await api('/api/exchange-rates');
    state.rates = data.rates || {};
    // 当前为海外组织时同步给统计用的汇率表，改动后各页面折算立即生效
    if (window.ScheduleData && ScheduleData.usesUsd()) window.DB._fx_rates = state.rates;
  }
  // 某月每一天的适用汇率（与统计折算 ScheduleData.fxRateOn 同一规则）
  function rowsOf(month) {
    const [y, m] = month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const dates = Object.keys(state.rates).sort();
    const rows = [];
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${pad2(d)}`;
      let hit = null;
      for (const k of dates) { if (k <= date) hit = k; else break; }
      const own = state.rates[date];
      rows.push({ date, rate: hit ? state.rates[hit].rate : null, from: hit, own });
    }
    return rows;
  }
  function render() {
    const host = document.getElementById('fx-rate-body');
    if (!host) return;
    const rows = rowsOf(state.month);
    const today = new Date(); const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    host.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border)">
        <input type="month" value="${esc(state.month)}" onchange="FxRates.setMonth(this.value)" style="border:1px solid var(--border);border-radius:6px;padding:4px 8px">
        <button class="btn btn-secondary btn-sm" onclick="FxRates.exportExcel()">📥 导出 Excel</button>
        ${isSuper() ? `<button class="btn btn-secondary btn-sm" onclick="FxRates.refresh(this)">🔄 立即更新</button>
        <button class="btn btn-secondary btn-sm" onclick="FxRates.manual()">✏️ 手动录入</button>` : ''}
        <span style="font-size:.75rem;color:var(--text-muted)">来源：中国外汇交易中心受权公布的人民币汇率中间价，每个工作日 9:15 公布；系统 9:30、11:00 自动获取</span>
      </div>
      <table style="width:100%;font-size:.85rem;border-collapse:collapse">
        <thead style="position:sticky;top:0;background:var(--bg-secondary);text-align:left"><tr><th style="padding:8px 18px">日期</th><th>USD/CNY</th><th>来源</th><th>备注</th>${isSuper() ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.map(r => {
          const future = r.date > todayStr;
          let source = '—', note = '';
          if (r.own && r.own.source === 'manual') { source = '手动录入'; note = (r.own.by ? r.own.by + ' 录入' : '') + (r.own.cfets != null ? ` · 央行值 ${r.own.cfets}` : ''); }
          else if (r.own) source = '央行中间价（自动获取）';
          else if (r.from) { source = '沿用 ' + r.from.slice(5); note = future ? '尚未公布' : '非公布日（周末/节假日）'; }
          else note = '无数据';
          const action = isSuper() && r.own && r.own.source === 'manual'
            ? `<button class="btn btn-secondary btn-sm" onclick="FxRates.clearManual('${r.date}')">撤销手动值</button>` : '';
          return `<tr style="border-bottom:1px solid var(--border);${r.own ? '' : 'color:var(--text-muted)'}"><td style="padding:6px 18px">${r.date}</td><td style="font-weight:${r.own ? 600 : 400}">${r.rate != null ? Number(r.rate).toFixed(4) : '-'}</td><td>${esc(source)}</td><td>${esc(note)}</td>${isSuper() ? `<td>${action}</td>` : ''}</tr>`;
        }).join('')}</tbody>
      </table>`;
  }
  async function open() {
    let modal = document.getElementById('fx-rate-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'fx-rate-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center';
      modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<div style="background:var(--bg-panel);border-radius:10px;width:min(820px,94vw);height:min(720px,88vh);display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.2)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;font-size:.95rem">💱 汇率记录（央行中间价 USD/CNY）</span>
        <button onclick="document.getElementById('fx-rate-modal').remove()" style="border:none;background:none;cursor:pointer;font-size:1.2rem;color:var(--text-muted)">×</button>
      </div>
      <div id="fx-rate-body" style="flex:1;overflow:auto"><div style="padding:40px;text-align:center;color:var(--text-muted)">加载中…</div></div>
    </div>`;
    if (!state.month) { const d = new Date(); state.month = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
    try { await load(); render(); }
    catch (e) { document.getElementById('fx-rate-body').innerHTML = `<div style="padding:40px;text-align:center;color:var(--danger)">${esc(e.message)}</div>`; }
  }
  async function refresh(btn) {
    btn.disabled = true; btn.textContent = '更新中…';
    try { const r = await api('/api/exchange-rates/refresh', { method: 'POST' }); await load(); render(); toast(r.changed ? `已更新 ${r.changed} 条汇率` : '汇率已是最新', 'success'); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = '🔄 立即更新'; }
  }
  function manual() {
    const date = prompt('录入日期（YYYY-MM-DD）', `${state.month}-01`);
    if (!date) return;
    const rate = prompt(`${date} 的 USD/CNY 汇率（如 7.1234）`);
    if (!rate) return;
    api('/api/exchange-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: date.trim(), rate: rate.trim() }) })
      .then(async () => { await load(); render(); toast('已录入汇率', 'success'); })
      .catch(e => toast(e.message, 'error'));
  }
  function clearManual(date) {
    appConfirm(`撤销 ${date} 的手动汇率？有央行值时恢复央行值。`, () => {
      api('/api/exchange-rates/' + encodeURIComponent(date), { method: 'DELETE' })
        .then(async () => { await load(); render(); toast('已撤销', 'success'); })
        .catch(e => toast(e.message, 'error'));
    });
  }
  function exportExcel() {
    if (!window.XLSX) { toast('Excel 组件未加载', 'error'); return; }
    const rows = rowsOf(state.month).map(r => ({
      '日期': r.date, 'USD/CNY': r.rate != null ? Number(r.rate) : '',
      '来源': r.own ? (r.own.source === 'manual' ? '手动录入' : '央行中间价') : (r.from ? '沿用 ' + r.from : '无数据'),
      '央行原值': r.own && r.own.source === 'manual' ? (r.own.cfets ?? '') : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '汇率');
    XLSX.writeFile(wb, `汇率记录_${state.month}.xlsx`);
  }
  function setMonth(v) { if (v) { state.month = v; render(); } }
  window.FxRates = { open, refresh, manual, clearManual, exportExcel, setMonth };
})();
