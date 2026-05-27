/* =====================================================================
 * 达人营销 · 内容排期模块 · Excel 导出 (Phase 7)
 *
 * 暴露：window.ExportWizard = { open(opts?) }
 *   opts.scope: 'currentMonth' | 'all' | 'range'
 *   opts.range: { start, end }（仅 scope=range 时用）
 *
 * 默认弹一个简单确认框：当前月 / 全部 / 自定义月份；带层级筛选传入。
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  const XL = window.ScheduleExcel;
  if (!SD || !XL) { console.error('[ExportWizard] 依赖未就绪'); return; }

  function open() {
    const ps = window.SchedulePage ? SchedulePage.getState() : { year: new Date().getFullYear(), month: new Date().getMonth()+1, tiers: [] };
    const tiersText = ps.tiers.length ? ps.tiers.join('、') : '全部';
    const scope = prompt(
      `📤 导出 Excel\n\n` +
      `选择导出范围：\n` +
      `  1 — 当前月（${ps.year} 年 ${ps.month} 月）\n` +
      `  2 — 当前月 + 下月（与日历同步）\n` +
      `  3 — 全部排期\n\n` +
      `当前层级筛选：${tiersText}\n\n` +
      `请输入 1 / 2 / 3：`,
      '1'
    );
    if (!scope) return;

    let schedules = [];
    let filename = '排期';
    if (scope === '1') {
      const { start, end } = SD.monthRange(ps.year, ps.month);
      schedules = SD.listSchedulesInRange(start, end, { tiers: ps.tiers });
      filename = `排期-${ps.year}-${pad2(ps.month)}`;
    } else if (scope === '2') {
      const a = SD.monthRange(ps.year, ps.month);
      const next = SD.prevMonth(ps.year, ps.month); // 反向用一下，实际取 next
      const ny = ps.month === 12 ? ps.year + 1 : ps.year;
      const nm = ps.month === 12 ? 1 : ps.month + 1;
      const b = SD.monthRange(ny, nm);
      schedules = SD.listSchedulesInRange(a.start, b.end, { tiers: ps.tiers });
      filename = `排期-${ps.year}-${pad2(ps.month)}_${ny}-${pad2(nm)}`;
    } else if (scope === '3') {
      schedules = window.DB.schedules.slice();
      if (ps.tiers.length) schedules = schedules.filter(s => ps.tiers.includes(s.tier));
      filename = '排期-全部';
    } else {
      window.toast && window.toast('未识别的选项', 'error');
      return;
    }

    if (!schedules.length) {
      window.toast && window.toast('该范围内无排期数据', 'info');
      return;
    }
    schedules.sort((a, b) => (a.schedule_date || '').localeCompare(b.schedule_date || ''));
    const wb = XL.exportToWorkbook(schedules);
    const fname = `${filename}_${stamp()}.xlsx`;
    XLSX.writeFile(wb, fname);
    window.toast && window.toast(`已导出 ${schedules.length} 条到「${fname}」`, 'success');
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
  }

  window.ExportWizard = { open };
  console.log('[ExportWizard] 已就绪');
})();
