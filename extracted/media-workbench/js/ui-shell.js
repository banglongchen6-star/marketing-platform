/* 只管理外观、导航与滚动，不读写业务库。图标随应用本地提供。 */
(function () {
  'use strict';
  // SVG shapes from the approved preview (Lucide / Feather); see assets/LUCIDE-LICENSE.txt.
  const paths = {
    "chart": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"></path><path d=\"M18 17V9\"></path><path d=\"M13 17V5\"></path><path d=\"M8 17v-3\"></path>",
    "trend": "<path d=\"M12 16v5\"></path><path d=\"M16 14.639V21\"></path><path d=\"M20 10.656V21\"></path><path d=\"m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15\"></path><path d=\"M4 18.463V21\"></path><path d=\"M8 14.656V21\"></path>",
    "review": "<path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\"></path><path d=\"M2 6h4\"></path><path d=\"M2 10h4\"></path><path d=\"M2 14h4\"></path><path d=\"M2 18h4\"></path><path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\"></path>",
    "box": "<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\"></path><path d=\"M12 22V12\"></path><polyline points=\"3.29 7 12 12 20.71 7\"></polyline><path d=\"m7.5 4.27 9 5.15\"></path>",
    "calendar": "<path d=\"M8 2v4\"></path><path d=\"M16 2v4\"></path><rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"></rect><path d=\"M3 10h18\"></path><path d=\"M8 14h.01\"></path><path d=\"M12 14h.01\"></path><path d=\"M16 14h.01\"></path><path d=\"M8 18h.01\"></path><path d=\"M12 18h.01\"></path><path d=\"M16 18h.01\"></path>",
    "film": "<path d=\"m12.296 3.464 3.02 3.956\"></path><path d=\"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z\"></path><path d=\"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"></path><path d=\"m6.18 5.276 3.1 3.899\"></path>",
    "wallet": "<path d=\"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1\"></path><path d=\"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4\"></path>",
    "folder": "<path d=\"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2\"></path>",
    "people": "<path d=\"M18 21a8 8 0 0 0-16 0\"></path><circle cx=\"10\" cy=\"8\" r=\"5\"></circle><path d=\"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3\"></path>",
    "controls": "<path d=\"M14 17H5\"></path><path d=\"M19 7h-9\"></path><circle cx=\"17\" cy=\"17\" r=\"3\"></circle><circle cx=\"7\" cy=\"7\" r=\"3\"></circle>",
    "panel": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"></rect><path d=\"M9 3v18\"></path><path d=\"m16 15-3-3 3-3\"></path>",
    "close": "<path d=\"M18 6 6 18\"></path><path d=\"m6 6 12 12\"></path>",
    "logout": "<path d=\"m16 17 5-5-5-5\"></path><path d=\"M21 12H9\"></path><path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"></path>",
    "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
    "download": "<path d=\"M12 15V3\"></path><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path><path d=\"m7 10 5 5 5-5\"></path>",
    "upload": "<path d=\"M12 3v12\"></path><path d=\"m17 8-5-5-5 5\"></path><path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path>",
    "trash": "<path d=\"M10 11v6\"></path><path d=\"M14 11v6\"></path><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"></path><path d=\"M3 6h18\"></path><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"></path>",
    "plus": "<path d=\"M5 12h14\"></path><path d=\"M12 5v14\"></path>",
    "link": "<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"></path><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"></path>",
    "menu": "<path d=\"M4 6h16M4 12h16M4 18h16\"/>"
};

  function icon(name) {
    return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[name] || paths.chart)+'</svg>';
  }
  const app = () => document.getElementById('app');
  const main = () => document.querySelector('#app > .main');
  const sidebar = () => document.getElementById('sidebar');
  const isMobile = () => window.matchMedia('(max-width:720px)').matches;
  let returnFocus = null;

  function closeMobile(restoreFocus = true) {
    const wasOpen = sidebar()?.classList.contains('open');
    sidebar()?.classList.remove('open');
    document.getElementById('sidebar-overlay')?.classList.remove('show');
    app()?.classList.remove('is-mobile-open');
    if (main()) main().inert = false;
    document.getElementById('ui-mobile-menu')?.setAttribute('aria-expanded','false');
    if (wasOpen && restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }
  function toggleMobile() {
    if (!isMobile()) return;
    if (sidebar().classList.contains('open')) return closeMobile();
    returnFocus = document.activeElement;
    sidebar().classList.add('open');
    app().classList.add('is-mobile-open');
    document.getElementById('sidebar-overlay').classList.add('show');
    main().inert = true;
    document.getElementById('ui-mobile-menu').setAttribute('aria-expanded','true');
    sidebar().querySelector('.ui-sidebar-close').focus();
  }
  function toggleDesktop() {
    const collapsed = app().classList.toggle('is-collapsed');
    try { localStorage.setItem('lihuo_sidebar_collapsed', collapsed ? '1':'0'); } catch(e) {}
    syncCollapseButton();
  }
  function syncCollapseButton() {
    const collapsed = app().classList.contains('is-collapsed');
    const b = document.getElementById('ui-sidebar-collapse');
    b.setAttribute('aria-expanded',String(!collapsed));
    b.setAttribute('aria-label',collapsed ? '展开导航':'收起导航');
    b.title = collapsed ? '展开导航':'收起导航';
  }
  function selectPage(page) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
      if (el.dataset.page === page) {
        el.setAttribute('aria-current','page');
        const heading = document.getElementById('ui-mobile-page-title');
        if (heading) heading.textContent = el.querySelector('.nav-label')?.textContent || '离火品宣';
      }
      else el.removeAttribute('aria-current');
    });
    const pane = main();
    if (pane) pane.scrollTop = 0;
  }
  window.BrandUI = { icon, toggleDesktop, toggleMobile, closeMobile, selectPage };
  window.AppScroll = {
    getTop: () => main()?.scrollTop || 0,
    restore: y => { if (main()) main().scrollTop = y; },
  };

  function init() {
    document.querySelectorAll('[data-ui-icon]').forEach(el => { el.innerHTML = icon(el.dataset.uiIcon); });
    try { app().classList.toggle('is-collapsed',localStorage.getItem('lihuo_sidebar_collapsed')==='1'); } catch(e) {}
    syncCollapseButton();
    window.matchMedia('(max-width:720px)').addEventListener('change',() => closeMobile(false));
    document.addEventListener('keydown',ev => {
      if (!isMobile() || !sidebar().classList.contains('open')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); closeMobile(); return; }
      if (ev.key !== 'Tab') return;
      const items = [...sidebar().querySelectorAll('button,a[href],input,select,[tabindex="0"]')].filter(el => el.getClientRects().length && !el.disabled);
      const first = items[0], last = items[items.length-1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); }
    });
    fetch('/api/runtime-info').then(r => r.ok ? r.json():null).then(info => {
      if (!info?.localPreview) return;
      const note = document.createElement('div');
      note.className = 'ui-local-note';
      note.textContent = '本地体验 · 历史数据副本';
      app().appendChild(note);
      document.title = '离火品宣 · 本地体验';
    }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
