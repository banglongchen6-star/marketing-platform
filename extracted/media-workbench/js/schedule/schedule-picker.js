/* =====================================================================
 * 联动辅助 · 排期选择器（5 个后置模块共用）
 *
 * 暴露：window.SchedulePicker = {
 *   optionsHTML(selectedId)            → 生成 <option> 列表（全部活跃排期）
 *   publishedOptionsHTML(selectedId)   → 仅已发布排期（日期 < 今天），供内容发布模块用
 *   labelFor(scheduleId)               → 给一个 schedule_id，返回展示字符串
 *   chipHTML(scheduleId)               → 在列表里展示"关联排期"列的 HTML
 *   openSchedule(scheduleId)           → 跳转到排期页并打开该条编辑器
 *   notifyChange(scheduleId)           → 关联操作后触发：刷排期视图 / 状态历史等
 *   advanceStatus(scheduleId, to, reason) → P1a 自动推进状态用
 * }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[SchedulePicker] ScheduleData 未就绪'); return; }

  function _todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function _activeSchedules() {
    return (window.DB.schedules || [])
      .filter(s => !s.deleted_at)
      .sort((a, b) => (b.schedule_date || '').localeCompare(a.schedule_date || ''));
  }

  function _publishedSchedules() {
    const today = _todayStr();
    return (window.DB.schedules || [])
      .filter(s => !s.deleted_at && s.schedule_date && s.schedule_date < today)
      .sort((a, b) => (b.schedule_date || '').localeCompare(a.schedule_date || ''));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function _label(s) {
    if (!s) return '—';
    return `${s.schedule_date} · ${s.kol_name || '未命名'}`
      + (s.category_direction ? ` · ${s.category_direction}` : '')
      + (s.platform ? ` / ${s.platform}` : '');
  }

  function optionsHTML(selectedId) {
    const opts = ['<option value="">— 不关联 —</option>'];
    _activeSchedules().forEach(s => {
      const sel = s.id === selectedId ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(_label(s))}</option>`);
    });
    // 兼容老数据：如果 selectedId 不在活跃列表里（被软删了），仍展示但加标签
    if (selectedId && !_activeSchedules().some(s => s.id === selectedId)) {
      const orphan = (window.DB.schedules || []).find(s => s.id === selectedId);
      if (orphan) {
        opts.push(`<option value="${escapeHtml(orphan.id)}" selected>⚠ ${escapeHtml(_label(orphan))}（已删除）</option>`);
      }
    }
    return opts.join('');
  }

  /** 仅已发布（日期 < 今天）的排期下拉，供内容发布模块用 */
  function publishedOptionsHTML(selectedId) {
    const published = _publishedSchedules();
    const opts = ['<option value="">— 请选择已发布排期 —</option>'];
    published.forEach(s => {
      const sel = s.id === selectedId ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(_label(s))}</option>`);
    });
    // 兼容：selectedId 对应已删除记录
    if (selectedId && !published.some(s => s.id === selectedId)) {
      const orphan = (window.DB.schedules || []).find(s => s.id === selectedId);
      if (orphan) {
        opts.push(`<option value="${escapeHtml(orphan.id)}" selected>⚠ ${escapeHtml(_label(orphan))}（已删除）</option>`);
      }
    }
    return opts.join('');
  }

  function labelFor(id) {
    if (!id) return null;
    const s = (window.DB.schedules || []).find(x => x.id === id);
    return s ? _label(s) : null;
  }

  function chipHTML(id) {
    if (!id) {
      return '<span style="color:var(--text-muted);font-size:.78rem">未关联</span>';
    }
    const s = (window.DB.schedules || []).find(x => x.id === id);
    if (!s) {
      return '<span style="color:var(--text-muted);font-size:.78rem">⚠ 已删除</span>';
    }
    const deleted = s.deleted_at ? '⚠' : '🔗';
    return `<a href="javascript:void(0)" onclick="SchedulePicker.openSchedule('${escapeHtml(id)}')"
              style="color:var(--primary);text-decoration:none;font-size:.78rem"
              title="点击跳转到该排期">${deleted} ${escapeHtml(_label(s))}</a>`;
  }

  function openSchedule(scheduleId) {
    if (typeof window.navigate === 'function') {
      window.navigate('schedule');
      setTimeout(() => {
        if (typeof window.openScheduleEditor === 'function') {
          window.openScheduleEditor(scheduleId);
        }
      }, 120);
    }
  }

  /** 关联操作后通知排期视图刷新（如果当前在排期页可见） */
  function notifyChange(scheduleId) {
    if (window.SchedulePage && typeof window.SchedulePage.render === 'function') {
      window.SchedulePage.render();
    }
  }

  /** P1a：自动推进状态。如果当前状态"在"或"超过"目标状态，则不再回退。 */
  const STATUS_ORDER = ['planned','published'];
  function advanceStatus(scheduleId, to, reason) {
    if (!scheduleId || !to) return;
    const s = (window.DB.schedules || []).find(x => x.id === scheduleId);
    if (!s || s.deleted_at) return;
    if (s.status === to || s.status === 'cancelled') return;
    // 只允许"前进"，不允许回退（cancelled 排除）
    const fromIdx = STATUS_ORDER.indexOf(s.status);
    const toIdx = STATUS_ORDER.indexOf(to);
    if (toIdx <= fromIdx) return;
    try {
      SD.updateSchedule(scheduleId, { status: to, _autoAdvanceReason: reason });
      // 触发副作用：刷新视图
      notifyChange(scheduleId);
      window.toast && window.toast(`已自动推进排期状态：${reason}`, 'info');
    } catch (e) {
      console.warn('advanceStatus failed', e);
    }
  }

  /** 结算专用下拉：未选择(placeholder) + 不关联 + 活跃排期 */
  function settlementOptionsHTML(selectedId) {
    const noneSelected = !selectedId;
    const opts = [
      `<option value="" disabled${noneSelected ? ' selected' : ''}>— 未选择 —</option>`,
      `<option value="none"${selectedId === 'none' ? ' selected' : ''}>— 不关联 —</option>`,
    ];
    _activeSchedules().forEach(s => {
      const sel = s.id === selectedId ? ' selected' : '';
      opts.push(`<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(_label(s))}</option>`);
    });
    if (selectedId && selectedId !== 'none' && !_activeSchedules().some(s => s.id === selectedId)) {
      const orphan = (window.DB.schedules || []).find(s => s.id === selectedId);
      if (orphan) opts.push(`<option value="${escapeHtml(orphan.id)}" selected>⚠ ${escapeHtml(_label(orphan))}（已删除）</option>`);
    }
    return opts.join('');
  }

  window.SchedulePicker = { optionsHTML, publishedOptionsHTML, settlementOptionsHTML, labelFor, chipHTML, openSchedule, notifyChange, advanceStatus };
  console.log('[SchedulePicker] 已就绪');
})();
