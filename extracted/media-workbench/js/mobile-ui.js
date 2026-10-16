/* 增强动态表格与旧弹窗的手机容器，不复制记录、不改事件或保存流程。 */
(function () {
  'use strict';
  const regions = new Map();
  let frame = 0;
  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const wrap = entry.target.matches('.ui-table-scroll') ? entry.target : entry.target.parentElement;
      if (!wrap?.classList.contains('ui-table-scroll')) continue;
      const overflow = wrap.clientWidth > 0 && wrap.scrollWidth > wrap.clientWidth + 2;
      wrap.classList.toggle('ui-table-overflow', overflow);
    }
  });
  function scan() {
    frame = 0;
    observer.disconnect();
    try {
      const heading = document.getElementById('ui-mobile-page-title');
      const activeLabel = document.querySelector('.sidebar-nav .nav-item.active .nav-label')?.textContent;
      if (heading && activeLabel && heading.textContent !== activeLabel) heading.textContent = activeLabel;
      // 旧实现有无类名弹窗，统一标记外壳，不覆盖现有ID和处理器。
      for (const el of document.body.children) {
        if (el.tagName === 'DIV' && el.style.position === 'fixed' && el.style.inset === '0px' && el.children.length === 1 && el.firstElementChild?.tagName === 'DIV' && (!el.className || el.classList.contains('ui-dialog-overlay'))) {
          el.classList.add('ui-dialog-overlay');
          el.firstElementChild.classList.add('ui-dialog-panel');
        }
      }
      document.querySelectorAll('.page table,.modal table,.detail-modal table,.sched-drawer table,.sched-dict-panel table,.sched-import-panel table,.ui-dialog-panel table').forEach(table => {
        if (table.parentElement.closest('table')) return;
        let wrap = table.parentElement;
        if (!wrap.classList.contains('ui-table-scroll')) {
          if (wrap.children.length !== 1 || !['DIV','SECTION'].includes(wrap.tagName)) {
            wrap = document.createElement('div');
            table.before(wrap);
            wrap.appendChild(table);
          }
          wrap.classList.add('ui-table-scroll');
          wrap.setAttribute('tabindex','0');
          wrap.setAttribute('role','region');
          wrap.setAttribute('aria-label','数据表，可左右滑动查看完整数据');
        }
        if (!regions.has(wrap)) {
          regions.set(wrap, table);
          sizes.observe(wrap);
          sizes.observe(table);
        }
      });
      for (const [wrap, table] of regions) {
        if (!wrap.isConnected || !table.isConnected) {
          sizes.unobserve(wrap); sizes.unobserve(table); regions.delete(wrap);
        }
      }
    } finally { observer.observe(document.body,{childList:true,subtree:true}); }
  }
  const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(scan); });
  // iOS软键盘不一定改变布局视口；用可见区域高度约束弹窗保存区。
  let viewportFrame = 0;
  function fitKeyboard() {
    viewportFrame = 0;
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (window.matchMedia('(max-width:720px)').matches && vv && Math.abs(vv.scale - 1) < .05) {
      root.style.setProperty('--ui-viewport-height', vv.height + 'px');
      root.style.setProperty('--ui-viewport-top', vv.offsetTop + 'px');
    } else {
      root.style.removeProperty('--ui-viewport-height');
      root.style.removeProperty('--ui-viewport-top');
    }
  }
  const queueViewport = () => { if (!viewportFrame) viewportFrame = requestAnimationFrame(fitKeyboard); };
  window.visualViewport?.addEventListener('resize',queueViewport);
  window.visualViewport?.addEventListener('scroll',queueViewport);
  window.addEventListener('resize',queueViewport);
  fitKeyboard();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',scan);
  else scan();
})();
