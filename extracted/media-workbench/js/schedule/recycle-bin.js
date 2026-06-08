/* =====================================================================
 * 达人营销 · 内容排期模块 · 回收站面板
 *
 * 暴露：window.RecycleBin = { open, close, countActive }
 *
 * 展示软删除（deleted_at 已打）的排期，可单条还原 / 永久删 / 一键清空。
 * 7 天前的会被启动时自动清理（见 data.js autoCleanup）。
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[RecycleBin] ScheduleData 未就绪'); return; }

  const state = { open: false };
  const STATUS_LABEL = {
    planned: '计划中', published: '已发布', cancelled: '已取消',
  };

  function ensureNode() {
    if (document.getElementById('sched-recycle-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'sched-recycle-overlay';
    overlay.className = 'sched-dict-overlay'; // 复用 dict overlay 样式
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.innerHTML = `
      <div class="sched-dict-panel" style="width:760px">
        <div class="sched-dict-header">
          <div class="sched-dict-title">🗑 排期回收站</div>
          <button class="sched-drawer-close" onclick="RecycleBin.close()">×</button>
        </div>
        <div class="sched-dict-body" id="__rb-body__"></div>
        <div class="sched-dict-footer" id="__rb-footer__"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.open) close();
    });
  }

  function countActive() {
    return SD.listDeletedSchedules().length;
  }

  function open() {
    ensureNode();
    state.open = true;
    paint();
    requestAnimationFrame(() => document.getElementById('sched-recycle-overlay').classList.add('open'));
  }
  function close() {
    state.open = false;
    const o = document.getElementById('sched-recycle-overlay');
    if (o) o.classList.remove('open');
    if (window.SchedulePage) SchedulePage.render();
    if (window.MonthlyPlanPage && document.getElementById('sched-budget-host')) {
      window.MonthlyPlanPage.render();
    }
  }

  function paint() {
    const items = SD.listDeletedSchedules();
    const body = document.getElementById('__rb-body__');
    const footer = document.getElementById('__rb-footer__');
    if (!items.length) {
      body.innerHTML = `
        <div class="sched-empty">
          <div style="font-size:2rem;margin-bottom:8px">🌱</div>
          <div>回收站空空如也</div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">
            通过编辑器删除的排期会留在这里 7 天，之后自动清除。
          </div>
        </div>
      `;
      footer.innerHTML = `<div class="spacer"></div><button class="btn btn-secondary btn-sm" onclick="RecycleBin.close()">关闭</button>`;
      return;
    }
    body.innerHTML = `
      <div style="font-size:.82rem;color:var(--text-secondary);margin-bottom:10px">
        共 <b style="color:var(--primary)">${items.length}</b> 条已删除排期 · 删除后 7 天内可还原
      </div>
      <table class="sched-dict-table">
        <thead>
          <tr>
            <th>排期日期</th>
            <th>达人</th>
            <th>达人类型</th>
            <th style="text-align:right">费用</th>
            <th>状态</th>
            <th>删除于</th>
            <th class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>${items.map(renderRow).join('')}</tbody>
      </table>
    `;
    footer.innerHTML = `
      <span style="font-size:.78rem;color:var(--text-muted)">
        💡 永久删除不可恢复；超过 7 天的会自动清空。
      </span>
      <div class="spacer"></div>
      <button class="btn btn-danger btn-sm" onclick="RecycleBin._emptyAll()">清空回收站</button>
      <button class="btn btn-secondary btn-sm" onclick="RecycleBin.close()">关闭</button>
    `;
  }

  function renderRow(s) {
    const status = STATUS_LABEL[s.status] || s.status || '';
    const deletedAgo = humanAgo(s.deleted_at);
    return `
      <tr>
        <td>${escapeHtml(s.schedule_date || '—')}</td>
        <td><strong>${escapeHtml(s.kol_name || '未命名')}</strong></td>
        <td>
          <span style="font-size:.76rem;color:var(--text-secondary)">${escapeHtml(s.category_direction || '—')}</span>
        </td>
        <td style="text-align:right">¥${Number(s.amount||0).toLocaleString()}</td>
        <td><span style="font-size:.76rem;color:var(--text-muted)">${escapeHtml(status)}</span></td>
        <td><span style="font-size:.76rem;color:var(--text-muted)" title="${escapeHtml(s.deleted_at)}">${deletedAgo}</span></td>
        <td class="col-actions">
          <button class="sched-dict-row-action primary" onclick="RecycleBin._restore('${s.id}')">还原</button>
          <button class="sched-dict-row-action danger" onclick="RecycleBin._purge('${s.id}')">永久删</button>
        </td>
      </tr>
    `;
  }

  function _restore(id) {
    try {
      const s = window.DB.schedules.find(x => x.id === id);
      SD.restoreSchedule(id);
      window.toast && window.toast(`已还原「${s?.kol_name || '排期'}」`, 'success');
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }
  function _purge(id) {
    const s = window.DB.schedules.find(x => x.id === id);
    if (!confirm(`永久删除「${s?.kol_name || '此条排期'}」？\n该操作不可恢复。`)) return;
    try {
      SD.permanentlyDeleteSchedule(id);
      window.toast && window.toast('已永久删除', 'info');
      paint();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }
  function _emptyAll() {
    const n = SD.listDeletedSchedules().length;
    if (n === 0) return;
    if (!confirm(`清空回收站？\n${n} 条排期将被永久删除，不可恢复。`)) return;
    const r = SD.emptyRecycleBin();
    window.toast && window.toast(`已清空回收站（${r.removed} 条）`, 'success');
    paint();
  }

  function humanAgo(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const diff = Date.now() - t;
    const s = Math.floor(diff / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s/60) + ' 分钟前';
    if (s < 86400) return Math.floor(s/3600) + ' 小时前';
    return Math.floor(s/86400) + ' 天前';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  window.RecycleBin = { open, close, countActive, _restore, _purge, _emptyAll };
  console.log('[RecycleBin] 已就绪');
})();
