/* =====================================================================
 * 内容发布（传播执行）页面 · 主模块
 *
 * 暴露：window.CommunicationPage = { render, openEditor(id?), ... }
 *
 * 一条内容 = 一次合作（主信息来自 schedule_id 反查）+ N 个 publication
 * 列分组：基本信息 / 发布信息 / 第7天数据 / 看后搜 / 归因数据（仅抖音）
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[CommunicationPage] ScheduleData 未就绪'); return; }

  /* ------------------------- 状态 ------------------------- */
  // 所有可选列（用户可在工具栏「自定义列」里勾选）
  const ALL_COLUMNS = [
    { key: 'price',        label: '价格',     group: '基本' },
    { key: 'fans',         label: '粉丝量',   group: '基本' },
    { key: 'work_type',    label: '作品类型', group: '基本' },
    { key: 'platform',     label: '平台',     group: '发布' },
    { key: 'date',         label: '发布时间', group: '发布' },
    { key: 'link',         label: '发布链接', group: '发布' },
    { key: 'views',        label: '播放量',   group: '第7天' },
    { key: 'likes',        label: '赞',       group: '第7天' },
    { key: 'comments',     label: '评论',     group: '第7天' },
    { key: 'completion',   label: '完播率',   group: '第7天' },
    { key: 'interaction',  label: '互动率',   group: '第7天' },
    { key: 'search_views', label: '看后搜量', group: '看后搜', douyinOnly: true },
    { key: 'search_rate',  label: '看后搜率', group: '看后搜', douyinOnly: true },
    { key: 'attr_direct',  label: '直接归因', group: '归因', douyinOnly: true },
    { key: 'attr_indirect',label: '简介归因', group: '归因', douyinOnly: true },
    { key: 'attr_search',  label: '看后搜归因', group: '归因', douyinOnly: true },
    { key: 'attr_audience',label: '人群获取', group: '归因', douyinOnly: true },
    { key: 'attr_store',   label: '店铺表现', group: '归因', douyinOnly: true },
    { key: 'cpa3',         label: 'CPA3',     group: '归因', douyinOnly: true },
    { key: 'promo_views',  label: '投流播放(万)', group: '投流', douyinOnly: true },
    { key: 'promo_cost',   label: '投流费(元)',   group: '投流', douyinOnly: true },
  ];
  // 默认全部显示
  const DEFAULT_VISIBLE = new Set(ALL_COLUMNS.map(c => c.key));
  const COL_PREF_KEY = 'comm_visible_cols_v2';
  function loadVisible() {
    try {
      const raw = localStorage.getItem(COL_PREF_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch(e) {}
    return new Set(DEFAULT_VISIBLE);
  }
  function saveVisible(s) {
    try { localStorage.setItem(COL_PREF_KEY, JSON.stringify([...s])); } catch(e) {}
  }

  const state = {
    // 列表筛选
    year: 0, month: 0,
    mainPlatform: '全部',
    bd_id: '',
    q: '',
    // 自定义列
    visibleCols: loadVisible(),
    colPopOpen: false,
    // 多选删除
    selectedIds: new Set(),
    // 编辑器
    editor: {
      open: false, mode: 'create', id: null,
      form: defaultForm(),
      errors: {},
    },
  };

  function defaultForm() {
    const defPlat = (SD.listPlatforms()[0] || {}).name || '抖音';
    const user = window.currentUser;
    const autoBd = (user?.identity === 'bd' || user?.identity === 'supervisor') ? (user.bd_id || user.id || '') : '';
    return {
      schedule_id: '',
      kol_name: '',
      category_direction: '',
      work_type: '',
      fans: '',
      bd_id: autoBd,
      price: '',
      main_platform: defPlat,
      sync_platforms: [],
      publications: [defaultPublication(defPlat, '')],
    };
  }

  /** 根据 main_platform + sync_platforms 重建 publications（保留已有数据） */
  function _rebuildPublications(f) {
    const allPlats = [f.main_platform, ...f.sync_platforms].filter(Boolean);
    const existing = f.publications || [];
    f.publications = allPlats.map((plat, i) => {
      const found = existing.find(p => p.platform === plat);
      return found ? { ...found } : defaultPublication(plat, '');
    });
    if (f.publications.length === 0) f.publications = [defaultPublication(f.main_platform || '抖音', '')];
  }
  function defaultPublication(platform = '抖音', date = '') {
    return {
      id: 'pub-' + Math.random().toString(36).slice(2, 8),
      platform, date, link: '',
      views: '', likes: '', comments: '',
      completion: '', interaction: '',
      search_views: '', search_rate: '',
      attr_direct: '', attr_indirect: '', attr_search: '',
      attr_audience: '', attr_store: '', cpa3: '',
      day7_recorded_at: null,
    };
  }

  function initState() {
    if (state.year) return;
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth() + 1;
  }

  /* ------------------------- 渲染：页面主入口 ------------------------- */
  function render() {
    initState();
    const page = document.getElementById('page-contents');
    if (!page) return;
    // 记录滚动位置（重渲染后恢复，避免操作后跳回顶部）
    const _winY = window.scrollY;
    let _scTop = 0;
    page.querySelectorAll('div').forEach(el => { if (el.scrollTop > _scTop) _scTop = el.scrollTop; });
    const kpi = SD.getCommunicationKPI({
      year: state.year, month: state.month,
      mainPlatform: state.mainPlatform,
      bd_id: state.bd_id || undefined,
    });
    page.innerHTML = `
      ${renderToolbar(kpi)}
      ${renderTabs()}
      ${renderList()}
    `;
    bindToolbar();
    // 全选框 indeterminate 状态（HTML 属性无法表达，需 JS 设置）
    setTimeout(() => {
      const allCb = document.getElementById('__comm-sel-all__');
      if (allCb) {
        const allIds = _getAllVisibleContentIds();
        const selCount = allIds.filter(id => state.selectedIds.has(id)).length;
        allCb.indeterminate = selCount > 0 && selCount < allIds.length;
      }
      _alignFrozenCols();
      // 恢复滚动位置
      if (_winY) window.scrollTo(0, _winY);
      if (_scTop) { for (const el of page.querySelectorAll('div')) { if (el.scrollHeight > el.clientHeight + 5) { el.scrollTop = _scTop; break; } } }
    }, 0);
  }

  /* 冻结列对齐：测量选择框列真实宽度，让达人昵称列紧贴其右侧，消除白缝 */
  function _alignFrozenCols() {
    const table = document.querySelector('#page-contents .comm-table');
    if (!table) return;
    const fz1 = table.querySelector('.comm-fz1');
    if (!fz1) return;
    const w = fz1.getBoundingClientRect().width;
    table.querySelectorAll('.comm-fz2').forEach(el => { el.style.left = w + 'px'; });
    // 双行表头：第二行 th 的 top = 第一行实际高度，避免上下滚动时两行表头重叠
    const firstRow = table.querySelector('thead tr:first-child');
    const secondRowThs = table.querySelectorAll('thead tr:nth-child(2) th');
    if (firstRow && secondRowThs.length) {
      const h = firstRow.getBoundingClientRect().height;
      secondRowThs.forEach(th => { th.style.top = h + 'px'; });
    }
  }

  /* 顶部 tab：按主平台切分 */
  function renderTabs() {
    const tabs = [
      { key: '全部', label: '全部平台' },
      { key: '抖音', label: '抖音平台' },
      { key: '小红书', label: '小红书平台' },
      { key: 'B站', label: 'B站平台' },
      { key: '视频号', label: '视频号平台' },
      { key: '快手', label: '快手平台' },
    ];
    const frozen = SD.isMonthFrozen(state.year, state.month);
    const isSupervisor = window.currentUser?.identity === 'supervisor';
    const freezeBtn = isSupervisor
      ? frozen
        ? `<button class="btn btn-sm" style="font-size:.72rem;padding:3px 10px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;border-radius:6px;cursor:pointer"
               onclick="CommunicationPage._toggleFreeze()">🔓 解冻</button>`
        : `<button class="btn btn-sm" style="font-size:.72rem;padding:3px 10px;background:#f1f5f9;border:1px solid #94a3b8;color:#475569;border-radius:6px;cursor:pointer"
               onclick="CommunicationPage._toggleFreeze()">🔒 冻结</button>`
      : frozen
        ? `<span style="font-size:.72rem;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:10px;border:1px solid #f59e0b">🔒 已冻结</span>`
        : '';
    return `
      <div class="sched-tab-bar" style="margin:0 0 14px;background:var(--bg-panel);border-radius:var(--radius);padding:0 8px;box-shadow:var(--shadow);border-bottom:none;display:flex;align-items:center;overflow:hidden">
        ${tabs.map(t => `
          <button class="sched-tab ${state.mainPlatform === t.key ? 'active' : ''}"
                  onclick="CommunicationPage._setMainPlatform('${t.key}')">${escapeHtml(t.label)}</button>
        `).join('')}
        ${freezeBtn ? `<div style="margin-left:auto;padding:0 8px;flex-shrink:0">${freezeBtn}</div>` : ''}
      </div>
    `;
  }

  function renderToolbar(kpi) {
    const bdList = SD.listBds();
    const bdOpts = ['<option value="">全部 BD</option>']
      .concat(bdList.map(b => `<option value="${b.id}" ${state.bd_id === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`));
    const monthLabel = `${state.year}-${String(state.month).padStart(2, '0')}`;
    const frozen = SD.isMonthFrozen(state.year, state.month);
    return `
      <div class="sched-toolbar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="sched-month-btn" onclick="CommunicationPage._prevMonth()">‹</button>
        <div class="sched-month-current" style="min-width:96px">${monthLabel}</div>
        <button class="sched-month-btn" onclick="CommunicationPage._nextMonth()">›</button>
        <input id="__c-search__" class="search-input"
               style="width:90px"
               placeholder="🔍 搜达人昵称..." value="${escapeAttr(state.q)}">
        <select id="__c-bd__" class="filter-select" style="width:90px">${bdOpts.join('')}</select>

        <!-- 4 KPI -->
        <div style="display:flex;gap:14px;margin-left:16px;padding:0 14px;border-left:1px solid var(--border)">
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">月总曝光</div>
            <div style="font-weight:600;color:var(--primary)">${kpi.totalExposureWan.toFixed(2)} 万</div>
            <div style="font-size:.66rem;color:var(--text-muted)">自然 ${kpi.totalViews.toFixed(2)} + 投流 ${kpi.totalPromoViews.toFixed(2)}</div>
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">月总花费</div>
            <div style="font-weight:600">¥${kpi.totalSpend.toLocaleString()}</div>
            <div style="font-size:.66rem;color:var(--text-muted)">合作 ¥${kpi.totalPrice.toLocaleString()} + 投流 ¥${kpi.totalPromoCost.toLocaleString()}</div>
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">CPM</div>
            <div style="font-weight:600;color:var(--purple)">${kpi.cpm}</div>
          </div>
        </div>

        <div style="margin-left:auto;display:flex;gap:6px;position:relative">
          <button id="__bulk-del-btn__" class="btn btn-danger btn-sm"
            onclick="CommunicationPage._deleteSelected()"
            ${state.selectedIds.size === 0 ? 'disabled' : ''}>
            🗑 删除选中${state.selectedIds.size > 0 ? ` (${state.selectedIds.size})` : ''}
          </button>
          <button class="btn btn-secondary btn-sm" onclick="CommunicationPage._toggleColPop(event)">⚙ 自定义列</button>
          <button class="btn btn-secondary btn-sm" onclick="CommunicationIE.openImport()" title="从 Excel 导入">📥 导入</button>
          <button class="btn btn-secondary btn-sm" onclick="CommunicationIE.doExport()" title="导出当前筛选数据到 Excel">📤 导出</button>
          ${frozen ? '' : `<button class="btn btn-primary btn-sm" onclick="CommunicationPage.openEditor()">＋ 新增内容</button>`}
          ${state.colPopOpen ? renderColPop() : ''}
        </div>
      </div>
    `;
  }

  /* 自定义列浮层 */
  function renderColPop() {
    const visible = ALL_COLUMNS; // 所有字段在所有平台视图中均可配置
    // 按 group 分组
    const groups = {};
    visible.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
    return `
      <div class="sched-add-dir-pop" id="__col-pop__" style="right:0;top:38px;width:280px;left:auto;padding:10px;display:flex;flex-direction:column;max-height:min(480px,70vh)">
        <div style="font-size:.82rem;font-weight:500;margin-bottom:8px;color:var(--text-primary);flex-shrink:0">自定义列（${state.visibleCols.size}/${visible.length}）</div>
        <div id="__col-pop-list__" style="overflow-y:auto;flex:1;margin-bottom:8px">
          ${Object.entries(groups).map(([g, cols]) => `
            <div style="margin-bottom:8px">
              <div style="font-size:.7rem;color:var(--text-muted);margin-bottom:4px">${escapeHtml(g)}</div>
              ${cols.map(c => `
                <label style="display:flex;align-items:center;gap:6px;padding:3px 4px;cursor:pointer;font-size:.82rem">
                  <input type="checkbox" ${state.visibleCols.has(c.key)?'checked':''}
                         onchange="CommunicationPage._toggleCol('${c.key}', this.checked)">
                  ${escapeHtml(c.label)}
                </label>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border);padding-top:8px;flex-shrink:0">
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="CommunicationPage._showAllCols()" style="font-size:.75rem;flex:1">全选</button>
            <button class="btn btn-secondary btn-sm" onclick="CommunicationPage._resetCols()" style="font-size:.75rem;flex:1">恢复默认</button>
          </div>
          <button class="btn btn-primary btn-sm" onclick="CommunicationPage._saveColPop()" style="width:100%">保存</button>
        </div>
      </div>
    `;
  }

  function _toggleColPop(ev) {
    ev && ev.stopPropagation();
    state.colPopOpen = !state.colPopOpen;
    render();
    if (state.colPopOpen) {
      setTimeout(() => document.addEventListener('click', _outsideColPopClose), 0);
    }
  }
  function _outsideColPopClose(e) {
    const pop = document.getElementById('__col-pop__');
    if (!pop || !pop.contains(e.target)) {
      state.colPopOpen = false;
      document.removeEventListener('click', _outsideColPopClose);
      render();
    }
  }
  function _toggleCol(key, on) {
    const scrollTop = document.getElementById('__col-pop-list__')?.scrollTop || 0;
    if (on) state.visibleCols.add(key); else state.visibleCols.delete(key);
    saveVisible(state.visibleCols);
    render();
    requestAnimationFrame(() => {
      const el = document.getElementById('__col-pop-list__');
      if (el) el.scrollTop = scrollTop;
    });
  }
  function _showAllCols() {
    const scrollTop = document.getElementById('__col-pop-list__')?.scrollTop || 0;
    ALL_COLUMNS.forEach(c => state.visibleCols.add(c.key));
    saveVisible(state.visibleCols);
    render();
    requestAnimationFrame(() => {
      const el = document.getElementById('__col-pop-list__');
      if (el) el.scrollTop = scrollTop;
    });
  }
  function _resetCols() {
    const scrollTop = document.getElementById('__col-pop-list__')?.scrollTop || 0;
    state.visibleCols = new Set(DEFAULT_VISIBLE);
    saveVisible(state.visibleCols);
    render();
    requestAnimationFrame(() => {
      const el = document.getElementById('__col-pop-list__');
      if (el) el.scrollTop = scrollTop;
    });
  }
  function _saveColPop() {
    state.colPopOpen = false;
    document.removeEventListener('click', _outsideColPopClose);
    render();
    window.toast && window.toast('列配置已保存', 'success');
  }

  function bindToolbar() {
    const s = document.getElementById('__c-search__');
    if (s) {
      let t; s.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { state.q = e.target.value; render(); }, 200);
      });
    }
    const b = document.getElementById('__c-bd__');
    if (b) b.addEventListener('change', e => { state.bd_id = e.target.value; render(); });
  }

  function _setMainPlatform(p) { state.mainPlatform = p; state.selectedIds.clear(); render(); }
  function _prevMonth() {
    if (state.month === 1) { state.year--; state.month = 12; } else state.month--;
    state.selectedIds.clear(); render();
  }
  function _nextMonth() {
    if (state.month === 12) { state.year++; state.month = 1; } else state.month++;
    state.selectedIds.clear(); render();
  }

  /* ------------------------- 多选删除 ------------------------- */
  function _getAllVisibleContentIds() {
    const list = SD.listContents({
      year: state.year, month: state.month,
      bd_id: state.bd_id || undefined,
      q: state.q || undefined,
    });
    return list.filter(c => !c._placeholder && c.id).map(c => String(c.id));
  }

  function _toggleSelect(id) {
    const sid = String(id);
    if (state.selectedIds.has(sid)) state.selectedIds.delete(sid);
    else state.selectedIds.add(sid);
    // 局部刷新：只更新删除按钮和全选框，不重渲染整张表
    const btn = document.getElementById('__bulk-del-btn__');
    if (btn) {
      btn.textContent = state.selectedIds.size > 0 ? `🗑 删除选中 (${state.selectedIds.size})` : '🗑 删除选中';
      btn.disabled = state.selectedIds.size === 0;
    }
    const allCb = document.getElementById('__comm-sel-all__');
    if (allCb) {
      const allIds = _getAllVisibleContentIds();
      const selCount = allIds.filter(id => state.selectedIds.has(id)).length;
      allCb.checked = selCount === allIds.length && allIds.length > 0;
      allCb.indeterminate = selCount > 0 && selCount < allIds.length;
    }
  }

  function _selectAll(checked) {
    const allIds = _getAllVisibleContentIds();
    if (checked) allIds.forEach(id => state.selectedIds.add(id));
    else state.selectedIds.clear();
    render();
  }

  function _deleteSelected() {
    if (state.selectedIds.size === 0) return;
    if (SD.isMonthFrozen(state.year, state.month)) {
      window.toast && window.toast('该月已冻结，请先解冻再删除', 'error');
      return;
    }
    const count = state.selectedIds.size;
    if (!confirm(`确认删除选中的 ${count} 条内容发布记录？操作不可恢复。`)) return;
    let deleted = 0, settlements = 0;
    [...state.selectedIds].forEach(id => {
      try {
        const res = SD.deleteContent(id);
        deleted++;
        settlements += res.deletedSettlements || 0;
      } catch(e) {}
    });
    state.selectedIds.clear();
    const msg = settlements > 0 ? `已删除 ${deleted} 条（含 ${settlements} 条结算记录）` : `已删除 ${deleted} 条`;
    window.toast && window.toast(msg, 'info');
    render();
  }

  /* ------------------------- 列表（主行 + 子行） ------------------------- */
  function getActiveColumns() {
    // 所有字段均可在任意平台视图中启用（douyinOnly 仅作说明，不再过滤）
    return ALL_COLUMNS.filter(c => state.visibleCols.has(c.key));
  }

  /* 可内联编辑的字段（完播率起往后） */
  const INLINE_EDIT_KEYS = new Set([
    'likes', 'comments',
    'completion', 'interaction',
    'search_views', 'search_rate',
    'attr_direct', 'attr_indirect', 'attr_search', 'attr_audience', 'attr_store', 'cpa3',
    'promo_views', 'promo_cost',
  ]);

  /**
   * 通用内联编辑：点击单元格 → input，Enter/失焦保存，Esc 取消
   */
  function _inlineEditField(contentId, pubId, field, tdEl) {
    if (SD.isMonthFrozen(state.year, state.month)) { toast('该月已冻结，请先解冻再编辑', 'error'); return; }
    if (tdEl.querySelector('input')) return;
    const content = (window.DB.contents || []).find(c => c.id === contentId);
    if (!content) return;
    const pub = (content.publications || []).find(p => p.id === pubId);
    if (!pub) return;
    const current = pub[field];

    const input = document.createElement('input');
    input.type = 'text';
    input.value = current != null ? String(current) : '';
    input.placeholder = '输入…';
    input.style.cssText = 'width:100%;min-width:60px;border:1px solid var(--primary);border-radius:4px;padding:3px 6px;font-size:.78rem;outline:none;box-sizing:border-box';

    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      const raw = input.value.trim();
      let newVal = null;
      if (raw !== '') {
        const n = Number(raw);
        newVal = Number.isFinite(n) ? n : raw;
      }
      const unchanged = newVal === current || (newVal == null && (current == null || current === ''));
      if (!unchanged) {
        try {
          const newPubs = (content.publications || []).map(p =>
            p.id === pubId ? { ...p, [field]: newVal } : p
          );
          SD.updateContent(contentId, { publications: newPubs });
          window.toast && window.toast('已保存', 'success');
        } catch (e) {
          window.toast && window.toast('保存失败: ' + e.message, 'error');
        }
      }
      render();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); saved = true; render(); }
    });
    tdEl.innerHTML = '';
    tdEl.appendChild(input);
    input.focus();
    if (input.value) input.select();
  }

  /**
   * 渲染一个完整的 <td>（含内联编辑支持）。
   * 用于所有非 rowspan 列（price/fans/category/date 在外部处理 rowspan）。
   */
  function renderPubTd(p, colKey, content, r, frozen = false) {
    const ctx = { r, content };
    // platform：主平台加（主）标记
    if (colKey === 'platform') {
      const isMain = (content.publications || [])[0]?.id === p.id;
      return `<td><span class="sched-card-chip platform">${escapeHtml(p.platform)}${isMain ? '<span style="font-size:.6rem;color:var(--primary);font-weight:700;margin-left:2px">（主）</span>' : ''}</span></td>`;
    }
    // date：主平台锁定，同步平台内联编辑
    if (colKey === 'date') {
      const isMain = (content.publications || [])[0]?.id === p.id;
      if (frozen || isMain) return `<td style="min-width:110px">${escapeHtml(p.date || '-')}</td>`;
      const display = p.date ? escapeHtml(p.date) : '<span style="color:var(--text-muted);font-size:.78rem">点击填写…</span>';
      return `<td style="cursor:pointer;min-width:110px" onclick="CommunicationPage._inlineEditDate('${content.id}','${p.id}',this)" title="点击修改同步平台发布日期">${display}</td>`;
    }
    // link：内联编辑 URL
    if (colKey === 'link') {
      if (frozen) return `<td style="min-width:110px">${p.link ? renderLink(p.link) : '<span style="color:var(--text-muted);font-size:.78rem">-</span>'}</td>`;
      return `<td style="cursor:pointer;min-width:110px" onclick="CommunicationPage._inlineEditLink('${content.id}','${p.id}',this)" title="点击填写链接">${p.link ? renderLink(p.link) : '<span style="color:var(--text-muted);font-size:.78rem">点击填写…</span>'}</td>`;
    }
    // views：内联编辑（万）
    if (colKey === 'views') {
      if (frozen) return `<td style="min-width:70px">${p.views != null ? fmtNullable(p.views, '-') : '-'}</td>`;
      return `<td style="cursor:pointer;min-width:70px" onclick="CommunicationPage._inlineEditViews('${content.id}','${p.id}',this)" title="点击填写播放量">${p.views != null ? fmtNullable(p.views, '-') : '<span style="color:var(--text-muted);font-size:.78rem">点击填写…</span>'}</td>`;
    }
    // 完播率起往后：通用内联编辑
    if (INLINE_EDIT_KEYS.has(colKey)) {
      const display = renderPubCell(p, colKey, ctx);
      if (frozen) return `<td>${display}</td>`;
      const isEmpty = display === '-';
      return `<td style="cursor:pointer" onclick="CommunicationPage._inlineEditField('${content.id}','${p.id}','${colKey}',this)" title="点击填写">${isEmpty ? '<span style="color:var(--text-muted);font-size:.78rem">点击填写…</span>' : display}</td>`;
    }
    // 其余静态列
    return `<td>${renderPubCell(p, colKey, ctx)}</td>`;
  }

  /* 单平台模式：按「日期 vs 今天」分区渲染（发布区/待发布区/未排期 + 分隔条） */
  function _partitionRows(list, activeCols, isDouyin) {
    const _t = new Date();
    const todayStr = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;
    const colCount = activeCols.length + 5;
    const sectionLabel = {
      0: `📋 发布区　<span style="font-weight:400;color:#64748b">已到发布日（今天 ${todayStr} 在最上）</span>`,
      1: `🕓 待发布区　<span style="font-weight:400;color:#64748b">未到发布日（最近的在最上）</span>`,
      2: `📎 未排期　<span style="font-weight:400;color:#64748b">未填发布日期</span>`,
    };
    const sectionBg = { 0:'#eef6ff', 1:'#fff7ed', 2:'#f3f4f6' };
    const sectionFg = { 0:'#1e40af', 1:'#9a3412', 2:'#475569' };
    const effOf = c => ((c.publications||[])[0]?.date) || (SD.resolveContent(c)?.schedule_date) || '';
    const grpOf = c => { const d = effOf(c); if (!d) return 2; return d <= todayStr ? 0 : 1; };
    const sorted = [...list].sort((a, b) => {
      const ga = grpOf(a), gb = grpOf(b);
      if (ga !== gb) return ga - gb;
      const da = effOf(a), db = effOf(b);
      if (ga === 0) return db.localeCompare(da);          // 发布区：日期倒序
      if (ga === 1) return da.localeCompare(db);          // 待发布区：日期升序
      const ca = a.created_at || a.id || '', cb = b.created_at || b.id || '';
      return String(cb).localeCompare(String(ca));        // 未排期：新增倒序
    });
    let lastGrp = null;
    return sorted.map(c => {
      const g = grpOf(c);
      let divider = '';
      if (g !== lastGrp) {
        lastGrp = g;
        divider = `<tr class="comm-section-row"><td colspan="${colCount}" style="background:${sectionBg[g]};color:${sectionFg[g]};font-weight:700;font-size:.82rem;padding:7px 12px;position:sticky;left:0;border-top:2px solid ${sectionFg[g]}22">${sectionLabel[g]}</td></tr>`;
      }
      const row = c._placeholder ? renderPlaceholderRow(c, activeCols) : renderContentRows(c, isDouyin, activeCols, false);
      return divider + row;
    }).join('');
  }

  function renderList() {
    if (state.mainPlatform === '全部') return renderAllPlatformsList();
    const list = SD.listContents({
      year: state.year, month: state.month,
      mainPlatform: state.mainPlatform,
      bd_id: state.bd_id || undefined,
      q: state.q || undefined,
      withPlaceholders: true,
    });
    if (!list.length) {
      return `<div style="background:var(--bg-panel);border-radius:var(--radius);padding:60px 16px;text-align:center;color:var(--text-muted);box-shadow:var(--shadow)">
        <div style="font-size:2rem;margin-bottom:8px">📭</div>
        <div>${state.mainPlatform} 当月暂无发布数据</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">点击右上「+ 新增」录入；需要先在排期里有对应排期</div>
      </div>`;
    }
    const isDouyin = state.mainPlatform === '抖音';
    const activeCols = getActiveColumns();
    // 分组统计
    const groupCounts = {};
    activeCols.forEach(c => { groupCounts[c.group] = (groupCounts[c.group] || 0) + 1; });
    const groupOrder = ['基本', '发布', '第7天', '投流', '看后搜', '归因'].filter(g => groupCounts[g]);
    const groupBg = { '基本':'#eff6ff', '发布':'#f0fdf4', '第7天':'#fef3c7', '投流':'#fef2f2', '看后搜':'#fce7f3', '归因':'#ede9fe' };
    // 操作列需要 1 列（非冻结），tfoot colspan = activeCols.length + 1（昵称） + 1（操作）
    const realList = list.filter(c => !c._placeholder);
    return `
      <div style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto;max-height:calc(100vh - 240px)">
        <table class="comm-table">
          <thead>
            <tr class="comm-group-header">
              <th rowspan="2" class="comm-fz1" style="width:36px;text-align:center;background:#fafbfd;padding:4px">
                ${(function(){
                  const _ids = _getAllVisibleContentIds();
                  const _sel = _ids.filter(id => state.selectedIds.has(id)).length;
                  const _chk = _ids.length > 0 && _sel === _ids.length ? 'checked' : '';
                  return `<input type="checkbox" id="__comm-sel-all__" title="全选/取消全选"
                    ${_chk} onchange="CommunicationPage._selectAll(this.checked)">`;
                })()}
              </th>
              <th rowspan="2" class="comm-fz2" style="background:#fafbfd;min-width:120px">${state.mainPlatform}昵称</th>
              ${groupOrder.map(g => {
                const gLabel = g === '基本' ? '基本信息'
                  : g === '发布' ? '发布信息'
                  : g === '第7天' ? '第7天数据'
                  : g === '投流' ? '投流（抖音）'
                  : g + '数据';
                return `<th colspan="${groupCounts[g]}" class="comm-group" style="background:${groupBg[g]}">${gLabel}</th>`;
              }).join('')}
              <th rowspan="2" colspan="3" style="text-align:center">操作</th>
            </tr>
            <tr>
              ${activeCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${_partitionRows(list, activeCols, isDouyin)}
          </tbody>
          <tfoot>
            ${renderListFooter(realList, activeCols.length + 1, false)}
          </tfoot>
        </table>
      </div>
    `;
  }

  // 渲染单个 publication 的某一列单元格
  function renderPubCell(p, colKey, ctx) {
    switch (colKey) {
      case 'price': return ctx.r.price != null && ctx.r.price !== '' ? '¥'+Number(ctx.r.price).toLocaleString() : '-';
      case 'fans':  return ctx.content.fans != null ? formatFans(ctx.content.fans) : '-';
      case 'category': return escapeHtml(ctx.r.category || '-');
      case 'work_type': return escapeHtml(ctx.r.work_type || '-');
      case 'platform': return `<span class="sched-card-chip platform">${escapeHtml(p.platform)}</span>`;
      case 'date': {
        const snapMap = { d0:'当天', d3:'3d', d7:'7d', d30:'30d' };
        const chip = p.snapshot_day && snapMap[p.snapshot_day]
          ? `<span style="margin-left:4px;font-size:.62rem;padding:1px 5px;border-radius:3px;background:${p.snapshot_day==='d7'?'#dcfce7':'#fef3c7'};color:${p.snapshot_day==='d7'?'#15803d':'#92400e'};font-weight:500" title="数据采集时点">${snapMap[p.snapshot_day]}</span>`
          : '';
        return escapeHtml(p.date || '-') + chip;
      }
      case 'link':     return renderLink(p.link);
      case 'views':       return fmtNullable(p.views, '-');
      case 'likes':       return renderStatCell(p, 'likes');
      case 'comments':    return renderStatCell(p, 'comments');
      case 'completion':  return fmtPercent(p.completion);
      case 'interaction': return fmtPercent(p.interaction);
      case 'search_views':return fmtNullable(p.search_views, '-');
      case 'search_rate': return fmtPercent(p.search_rate);
      case 'attr_direct': return fmtNullable(p.attr_direct, '-');
      case 'attr_indirect':return fmtNullable(p.attr_indirect, '-');
      case 'attr_search': return fmtNullable(p.attr_search, '-');
      case 'attr_audience':return fmtNullable(p.attr_audience, '-');
      case 'attr_store':  return escapeHtml(p.attr_store || '-');
      case 'cpa3':        return fmtNullable(p.cpa3, '-');
      case 'promo_views': return fmtNullable(p.promo_views, '-');
      case 'promo_cost':  return p.promo_cost != null ? '¥'+Number(p.promo_cost).toLocaleString() : '-';
      default: return '-';
    }
  }
  // 哪些列是"基本信息"(整次合作共享，不随 publication 变化)，主行 rowspan 跨多行
  const MAIN_COLS = new Set(['price','fans','category','work_type']);

  function _payStatusTag(scheduleId, contentId) {
    const list = (window.DB?.settlements || []).filter(s =>
      scheduleId ? s.schedule_id === scheduleId : s.content_id === contentId);
    const unpaidTag = `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:.75rem;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa">未付款</span>`;
    const paidTag   = `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:.75rem;background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;font-weight:600">已付款</span>`;
    const noneTag   = `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:.75rem;background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb">无需付款</span>`;
    if (!list.length) {
      // 没有结算单：明确填了 0 元（置换/免费）→ 无需付款；没填金额 → 未付款
      let amt = null;
      if (scheduleId) { const s = (window.DB?.schedules||[]).find(x => x.id === scheduleId); amt = s ? s.amount : null; }
      else            { const c = (window.DB?.contents ||[]).find(x => x.id === contentId);  amt = c ? c.price  : null; }
      if (amt != null && amt !== '' && Number(amt) === 0) return noneTag;
      return unpaidTag;
    }
    // 已结转到「已结算」区的，视为已付清归档
    const active = list.find(s => !s.settled);
    if (!active) return paidTag;
    // 统一付款状态：已付金额(只算填了付款时间的) vs 应付总额
    const { status } = SD.getSettlementPayStatus(active);
    if (status === 'paid')    return paidTag;
    if (status === 'partial') return `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:.75rem;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe">部分付款</span>`;
    if (status === 'none')    return noneTag;
    // 未付款细分：填了「申请付款时间」但还没实际付款 → 已申请
    if ((active.payments||[]).some(p => p.paid_date))
      return `<span style="display:inline-block;padding:2px 10px;border-radius:10px;font-size:.75rem;background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe">已申请</span>`;
    return unpaidTag;
  }

  // 无内容记录的排期"待填写"占位行
  function renderPlaceholderRow(c, activeCols) {
    const r = SD.resolveContent(c);
    const s = (window.DB?.schedules || []).find(x => x.id === c.schedule_id);
    if (!s) return '';
    const dateStr = s.schedule_date ? `📅 ${s.schedule_date}` : '日期未定';
    const mp = s.platform || (Array.isArray(s.platforms) ? s.platforms[0] : '') || '';
    const platStr = mp || '平台未定';
    const bdChip = r.bd_color
      ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-left:8px"><span style="width:6px;height:6px;border-radius:50%;background:${r.bd_color};flex-shrink:0"></span><span style="font-size:.7rem;color:var(--text-muted)">${escapeHtml(r.bd_name)}</span></span>`
      : '';
    const phStBtn = _payStatusTag(s.id, null);
    return `<tr class="comm-main-row" style="background:#fafbff;opacity:.85">
      <td style="width:36px;background:#f0f4ff;padding:4px"></td>
      <td style="background:#f0f4ff">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <strong>${escapeHtml(r.talent)}</strong>
          ${bdChip}
        </div>
      </td>
      <td colspan="${activeCols.length}" style="color:var(--text-muted);font-size:.82rem;text-align:center">
        ${escapeHtml(dateStr)} &nbsp;·&nbsp; ${escapeHtml(platStr)}
      </td>
      <td class="comm-actions">
        <button class="btn btn-primary btn-sm" onclick="CommunicationPage.openEditor(null,'${s.id}')">填待发布</button>
      </td>
      <td class="comm-actions">${phStBtn}</td>
      <td class="comm-actions"></td>
    </tr>`;
  }

  // 来源标签：不关联排期的手动补录内容，名字旁加「✏️手动」角标
  function _srcTag(scheduleId) {
    return scheduleId ? '' : `<span style="font-size:.6rem;padding:1px 6px;border-radius:8px;background:#fef3c7;color:#92400e;font-weight:500;white-space:nowrap" title="手动补录，未关联内容排期">✏️手动</span>`;
  }

  function renderContentRows(content, isDouyin, activeCols, readOnly = false, frozen = false) {
    const r = SD.resolveContent(content);
    const pubs = content.publications || [];
    if (!pubs.length) return '';
    const total = pubs.length;
    const ctx = { r, content };
    const main = pubs[0];
    const sub = pubs.slice(1);
    const rowStyle = frozen ? 'opacity:.6;' : '';
    const stBtn = _payStatusTag(content.schedule_id || null, content.id);
    const actionCell = readOnly ? '' : frozen
      ? `<td rowspan="${total}" colspan="3" class="comm-actions" style="vertical-align:middle">
          <span style="font-size:.72rem;color:#92400e">🔒 已冻结</span>
        </td>`
      : `<td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
          <button class="btn btn-secondary btn-sm" onclick="CommunicationPage.openEditor('${content.id}')">编辑</button>
        </td>
        <td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
          ${stBtn}
        </td>
        <td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
          <button class="btn btn-danger btn-sm" onclick="CommunicationPage._delete('${content.id}')">删除</button>
        </td>`;
    // 主行
    let html = `
      <tr class="comm-main-row" data-id="${content.id}" style="${rowStyle}">
        <td rowspan="${total}" class="comm-fz1" style="width:36px;text-align:center;background:#fafbfd;vertical-align:middle;padding:4px">
          <input type="checkbox" onchange="CommunicationPage._toggleSelect('${content.id}')"
            ${state.selectedIds.has(String(content.id)) ? 'checked' : ''}>
        </td>
        <td rowspan="${total}" class="comm-fz2" style="font-weight:600;background:#fafbfd;vertical-align:middle">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <strong>${escapeHtml(r.talent)}</strong>
            ${r.bd_color ? `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:${r.bd_color}"></span><span style="font-size:.7rem;color:var(--text-muted)">${escapeHtml(r.bd_name)}</span></span>` : ''}
            ${_srcTag(content.schedule_id)}
          </div>
        </td>
        ${activeCols.map(c => {
          if (MAIN_COLS.has(c.key)) {
            return `<td rowspan="${total}" style="background:#fafbfd">${renderPubCell(main, c.key, ctx)}</td>`;
          }
          return renderPubTd(main, c.key, content, r, frozen);
        }).join('')}
        ${actionCell}
      </tr>
    `;
    // 子行
    sub.forEach(p => {
      html += `<tr class="comm-sub-row">
        ${activeCols.filter(c => !MAIN_COLS.has(c.key)).map(c => renderPubTd(p, c.key, content, r, frozen)).join('')}
      </tr>`;
    });
    return html;
  }

  function renderListFooter(list, colCount, readOnly = false) {
    let totalPrice = 0, totalViews = 0;
    const uniqueKols = new Set();
    list.forEach(c => {
      const r = SD.resolveContent(c);
      if (!uniqueKols.has(c.schedule_id)) {
        uniqueKols.add(c.schedule_id);
        totalPrice += Number(r.price) || 0;
      }
      (c.publications || []).forEach(p => { totalViews += Number(p.views) || 0; });
    });
    return `
      <tr class="comm-footer-row">
        <td colspan="${colCount + (readOnly ? 1 : 4)}">
          <span style="color:var(--text-secondary)">合计 ${uniqueKols.size} 位达人 ·
          价格 <b style="color:var(--primary)">¥${totalPrice.toLocaleString()}</b> ·
          播放量 <b style="color:var(--success)">${totalViews.toFixed(2)} 万</b></span>
        </td>
      </tr>
    `;
  }

  /* ------------------------- 全部平台视图（动态列，与单平台视图共用列系统） ------------------------- */
  function renderAllPlatformsList() {
    const list = SD.listContents({
      year: state.year, month: state.month,
      bd_id: state.bd_id || undefined,
      q: state.q || undefined,
      withPlaceholders: true,
    });
    if (!list.length) {
      return `<div style="background:var(--bg-panel);border-radius:var(--radius);padding:60px 16px;text-align:center;color:var(--text-muted);box-shadow:var(--shadow)">
        <div style="font-size:2rem;margin-bottom:8px">📭</div>
        <div>当月暂无发布数据</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">点击右上「+ 新增」录入</div>
      </div>`;
    }

    // 占位行单独提取，真实内容单独处理
    const placeholders = list.filter(c => c._placeholder);
    const realList = list.filter(c => !c._placeholder);

    // 动态列（全部模式包含抖音字段）
    const activeCols = getActiveColumns();
    const groupCounts = {};
    activeCols.forEach(c => { groupCounts[c.group] = (groupCounts[c.group] || 0) + 1; });
    const groupOrder = ['基本', '发布', '第7天', '投流', '看后搜', '归因'].filter(g => groupCounts[g]);
    const groupBg = { '基本':'#eff6ff', '发布':'#f0fdf4', '第7天':'#fef3c7', '投流':'#fef2f2', '看后搜':'#fce7f3', '归因':'#ede9fe' };
    const groupLabel = { '基本':'基本信息', '发布':'发布信息', '第7天':'第7天数据', '投流':'投流（抖音）', '看后搜':'看后搜数据', '归因':'归因数据' };

    // 以内容记录 ID 为 key 分组，保证同一笔合同的所有平台永远在一个 block
    const kolFans = {};
    const blockMap = new Map();
    realList.forEach(c => {
      const r = SD.resolveContent(c);
      const kolKey = c.kol_id || ('__name__' + r.talent);
      if (c.fans != null && kolFans[kolKey] == null) kolFans[kolKey] = c.fans;
      const items = (c.publications || []).map(p => ({ p, c, r, kolKey }));
      blockMap.set(c.id, { key: c.id, r, c, kolKey, fans: kolFans[kolKey] ?? null, items });
    });

    // 今天（本地日期 YYYY-MM-DD）
    const _t = new Date();
    const todayStr = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;
    // 每条记录的「有效日期」=主平台发布日期，没有则用排期计划日期（两者已同步，通常相等）
    const effOf = bl => (bl.items[0]?.p.date || bl.r.schedule_date || '');
    // 分区：0=发布区(日期≤今天)  1=待发布区(日期>今天)  2=未排期(无日期)
    const grpOf = bl => { const d = effOf(bl); if (!d) return 2; return d <= todayStr ? 0 : 1; };
    const blocks = [...blockMap.values()];

    // 统计（每个 block = 一条内容记录 = 一笔合同，价格只计一次）
    let totalViews = 0, totalPrice = 0, totalPubs = 0;
    const pricedKols = new Set();
    blocks.forEach(bl => {
      totalPrice += Number(bl.r.price) || 0;
      pricedKols.add(bl.kolKey);
      bl.items.forEach(({ p }) => { totalViews += Number(p.views) || 0; totalPubs++; });
    });

    const snapMap = { d0:'当天', d3:'3d', d7:'7d', d30:'30d' };

    // 渲染单个单元格（带内联编辑 & rowspan 控制）
    function renderCell(col, p, c, r, i, total, sameCategory) {
      // price / fans：主行 rowspan，子行跳过
      if (col.key === 'price') {
        if (i > 0) return '';
        return `<td rowspan="${total}" style="background:#fafbfd;vertical-align:middle">${r.price != null && r.price !== '' ? '¥'+Number(r.price).toLocaleString() : '-'}</td>`;
      }
      if (col.key === 'fans') {
        if (i > 0) return '';
        return `<td rowspan="${total}" style="background:#fafbfd;vertical-align:middle">${kolFans[c.kol_id||('__name__'+r.talent)] != null ? formatFans(kolFans[c.kol_id||('__name__'+r.talent)]) : '-'}</td>`;
      }
      // category：同 block 类型相同则 rowspan
      if (col.key === 'category') {
        if (sameCategory) {
          if (i > 0) return '';
          return `<td rowspan="${total}" style="vertical-align:middle">${escapeHtml(r.category || '-')}</td>`;
        }
        return `<td>${escapeHtml(r.category || '-')}</td>`;
      }
      // work_type：作品类型，主平台行 rowspan（一条内容一个作品类型）
      if (col.key === 'work_type') {
        if (i > 0) return '';
        return `<td rowspan="${total}" style="vertical-align:middle">${escapeHtml(r.work_type || '-')}</td>`;
      }
      // date：主平台（i===0）锁定显示，同步平台支持内联编辑
      if (col.key === 'date') {
        const chip = p.snapshot_day && snapMap[p.snapshot_day]
          ? `<span style="margin-left:4px;font-size:.62rem;padding:1px 5px;border-radius:3px;background:${p.snapshot_day==='d7'?'#dcfce7':'#fef3c7'};color:${p.snapshot_day==='d7'?'#15803d':'#92400e'};font-weight:500">${snapMap[p.snapshot_day]}</span>`
          : '';
        if (allFrozen || i === 0) return `<td style="vertical-align:middle">${escapeHtml(p.date || '-')}${chip}</td>`;
        const display = p.date ? escapeHtml(p.date) + chip : '<span style="color:var(--text-muted);font-size:.78rem">点击填写…</span>';
        return `<td style="cursor:pointer;vertical-align:middle" onclick="CommunicationPage._inlineEditDate('${c.id}','${p.id}',this)" title="点击修改同步平台发布日期">${display}</td>`;
      }
      // 其余列（含 platform/link/views/inline-edit）统一走 renderPubTd
      return renderPubTd(p, col.key, c, r, allFrozen);
    }

    const allFrozen = SD.isMonthFrozen(state.year, state.month);
    // 分隔条：发布区 / 待发布区 / 未排期
    const _colCount = activeCols.length + 5; // 选择框 + 昵称 + 数据列 + 操作3列
    const _sectionLabel = {
      0: `📋 发布区　<span style="font-weight:400;color:#64748b">已到发布日（今天 ${todayStr} 在最上）</span>`,
      1: `🕓 待发布区　<span style="font-weight:400;color:#64748b">未到发布日（最近的在最上）</span>`,
      2: `📎 未排期　<span style="font-weight:400;color:#64748b">未填发布日期</span>`,
    };
    const _sectionBg = { 0:'#eef6ff', 1:'#fff7ed', 2:'#f3f4f6' };
    const _sectionFg = { 0:'#1e40af', 1:'#9a3412', 2:'#475569' };
    // 占位行（排期已建、内容未录）包成 block 结构，与真实内容统一分区
    const phBlocks = placeholders.map(ph => ({
      _isPlaceholder: true, ph, c: ph, r: SD.resolveContent(ph), items: [],
    }));
    // 真实内容 + 占位行 统一排序：发布区(日期≤今天,倒序) → 待发布区(日期>今天,升序) → 未排期(无日期)
    const entries = [...blocks, ...phBlocks].sort((a, b) => {
      const ga = grpOf(a), gb = grpOf(b);
      if (ga !== gb) return ga - gb;
      const da = effOf(a), db = effOf(b);
      if (ga === 0) { const d = db.localeCompare(da); return d !== 0 ? d : (a.r.talent || '').localeCompare(b.r.talent || ''); }
      if (ga === 1) { const d = da.localeCompare(db); return d !== 0 ? d : (a.r.talent || '').localeCompare(b.r.talent || ''); }
      const ca = a.c.created_at || a.c.id || '', cb = b.c.created_at || b.c.id || '';
      return String(cb).localeCompare(String(ca));
    });

    let _lastGrp = null;
    const _dividerFor = (g) => {
      if (g === _lastGrp) return '';
      _lastGrp = g;
      return `<tr class="comm-section-row"><td colspan="${_colCount}" style="background:${_sectionBg[g]};color:${_sectionFg[g]};font-weight:700;font-size:.82rem;padding:7px 12px;position:sticky;left:0;border-top:2px solid ${_sectionFg[g]}22">${_sectionLabel[g]}</td></tr>`;
    };

    const bodyRows = entries.map(bl => {
      const _divider = _dividerFor(grpOf(bl));
      // 占位行：单行渲染
      if (bl._isPlaceholder) return _divider + renderPlaceholderRow(bl.ph, activeCols);

      const total = bl.items.length;
      const { r } = bl;
      const sameCategory = bl.items.every(item => item.r.category === bl.items[0].r.category);

      return _divider + bl.items.map(({ p, c }, i) => {
        const cells = activeCols.map(col => renderCell(col, p, c, r, i, total, sameCategory)).join('');
        const cStBtn = _payStatusTag(c.schedule_id || null, c.id);
        const opCell = i === 0
          ? allFrozen
            ? `<td rowspan="${total}" colspan="3" class="comm-actions" style="vertical-align:middle">
                 <span style="font-size:.72rem;color:#92400e">🔒</span>
               </td>`
            : `<td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
                 <button class="btn btn-secondary btn-sm" onclick="CommunicationPage.openEditor('${c.id}')">编辑</button>
               </td>
               <td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
                 ${cStBtn}
               </td>
               <td rowspan="${total}" class="comm-actions" style="vertical-align:middle">
                 <button class="btn btn-danger btn-sm" onclick="CommunicationPage._delete('${c.id}')">删除</button>
               </td>`
          : '';
        if (i === 0) {
          return `<tr class="comm-main-row" data-id="${c.id}" style="${allFrozen ? 'opacity:.6' : ''}">
            <td rowspan="${total}" class="comm-fz1" style="width:36px;text-align:center;background:#fafbfd;vertical-align:middle;padding:4px">
              <input type="checkbox" onchange="CommunicationPage._toggleSelect('${c.id}')"
                ${state.selectedIds.has(String(c.id)) ? 'checked' : ''}>
            </td>
            <td rowspan="${total}" class="comm-fz2" style="font-weight:600;background:#fafbfd;vertical-align:middle">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <strong>${escapeHtml(r.talent)}</strong>
                ${r.bd_color ? `<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:6px;height:6px;border-radius:50%;background:${r.bd_color}"></span><span style="font-size:.7rem;color:var(--text-muted)">${escapeHtml(r.bd_name)}</span></span>` : ''}
                ${_srcTag(c.schedule_id)}
              </div>
            </td>
            ${cells}${opCell}
          </tr>`;
        }
        return `<tr class="comm-sub-row">${cells}</tr>`;
      }).join('');
    }).join('');

    return `
      <div style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto;max-height:calc(100vh - 240px)">
        <table class="comm-table">
          <thead>
            <tr class="comm-group-header">
              <th rowspan="2" class="comm-fz1" style="width:36px;text-align:center;background:#fafbfd;padding:4px">
                ${(function(){
                  const _ids = _getAllVisibleContentIds();
                  const _sel = _ids.filter(id => state.selectedIds.has(id)).length;
                  const _chk = _ids.length > 0 && _sel === _ids.length ? 'checked' : '';
                  return `<input type="checkbox" id="__comm-sel-all__" title="全选/取消全选"
                    ${_chk} onchange="CommunicationPage._selectAll(this.checked)">`;
                })()}
              </th>
              <th rowspan="2" class="comm-fz2" style="background:#fafbfd;min-width:130px">达人昵称</th>
              ${groupOrder.map(g => `<th colspan="${groupCounts[g]}" class="comm-group" style="background:${groupBg[g]}">${groupLabel[g]||g}</th>`).join('')}
              <th rowspan="2" colspan="3" style="text-align:center">操作</th>
            </tr>
            <tr>
              ${activeCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
          <tfoot>
            <tr class="comm-footer-row">
              <td colspan="${activeCols.length + 5}">
                <span style="color:var(--text-secondary)">合计 ${pricedKols.size} 位达人 · ${totalPubs} 条发布 ·
                价格 <b style="color:var(--primary)">¥${totalPrice.toLocaleString()}</b> ·
                播放量 <b style="color:var(--success)">${totalViews.toFixed(2)} 万</b></span>
                ${placeholders.length ? `<span style="margin-left:12px;color:var(--text-muted)">· 待填写 ${placeholders.length} 条</span>` : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  /* ------------------------- 编辑器抽屉 ------------------------- */
  function _toggleFreeze() {
    if (window.currentUser?.identity !== 'supervisor') {
      window.toast && window.toast('仅品宣主管可操作冻结', 'error');
      return;
    }
    const isFrozen = SD.isMonthFrozen(state.year, state.month);
    const label = isFrozen ? `解冻 ${state.year}年${state.month}月` : `冻结 ${state.year}年${state.month}月`;
    window.confirmSupervisorPass(label, () => {
      if (isFrozen) {
        SD.unfreezeMonth(state.year, state.month);
        window.toast && window.toast(`${state.year}年${state.month}月 已解冻`, 'success');
      } else {
        SD.freezeMonth(state.year, state.month);
        window.toast && window.toast(`${state.year}年${state.month}月 已冻结`, 'success');
      }
      render();
    });
  }

  function openEditor(id, preScheduleId) {
    if (id && SD.isMonthFrozen(state.year, state.month)) {
      window.toast && window.toast('该月已冻结，请先解冻再编辑', 'error');
      return;
    }
    ensureEditorNode();
    state.editor.errors = {};
    state.editor.fromPlaceholder = false;
    if (id) {
      const c = window.DB.contents.find(x => x.id === id);
      if (!c) return;
      state.editor.mode = 'edit';
      state.editor.id = id;
      const pubs = c.publications || [];
      const linkedSched = c.schedule_id ? (window.DB?.schedules || []).find(x => x.id === c.schedule_id) : null;
      state.editor.form = {
        schedule_id: c.schedule_id || 'none',
        kol_name: c.kol_name || '',
        category_direction: c.category_direction || '',
        work_type: c.work_type || '',
        fans: c.fans != null ? String(c.fans) : '',
        bd_id: c.bd_id || '',
        price: linkedSched ? (linkedSched.amount != null ? String(linkedSched.amount) : '') : (c.price != null ? String(c.price) : ''),
        main_platform: pubs[0]?.platform || (SD.listPlatforms()[0]?.name || '抖音'),
        sync_platforms: pubs.slice(1).map(p => p.platform).filter(Boolean),
        publications: pubs.map(p => ({ ...p })),
      };
    } else {
      state.editor.mode = 'create';
      state.editor.id = null;
      state.editor.form = defaultForm();
      // 从占位排期预填
      if (preScheduleId) {
        const s = (window.DB?.schedules || []).find(x => x.id === preScheduleId);
        if (s) {
          const mp = s.platform || (Array.isArray(s.platforms) ? s.platforms[0] : '') || '';
          const sp = Array.isArray(s.sync_platforms) && s.sync_platforms.length
            ? s.sync_platforms
            : (Array.isArray(s.platforms) ? s.platforms.slice(1) : []);
          state.editor.form.schedule_id   = preScheduleId;
          state.editor.form.main_platform = mp;
          state.editor.form.sync_platforms = sp;
          state.editor.form.price = String(s.amount || '');
          const schedDate = s.schedule_date || '';
          state.editor.form.publications  = [mp, ...sp].filter(Boolean)
            .map((p, i) => ({ platform: p, date: i === 0 ? schedDate : '', link: '', views: '', likes: '', comments: '' }));
          state.editor.fromPlaceholder = true;
        }
      }
    }
    state.editor.open = true;
    paintEditor();
    requestAnimationFrame(() => {
      document.getElementById('comm-drawer').classList.add('open');
      document.getElementById('comm-drawer-overlay').classList.add('open');
      document.getElementById('cf-schedule')?.focus();
    });
  }

  function closeEditor() {
    state.editor.open = false;
    const d = document.getElementById('comm-drawer');
    const o = document.getElementById('comm-drawer-overlay');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
  }

  function ensureEditorNode() {
    if (document.getElementById('comm-drawer')) return;
    const ov = document.createElement('div');
    ov.id = 'comm-drawer-overlay';
    ov.className = 'sched-drawer-overlay';
    ov.addEventListener('click', closeEditor);
    document.body.appendChild(ov);
    const d = document.createElement('div');
    d.id = 'comm-drawer';
    d.className = 'sched-drawer';
    d.style.width = '720px';
    d.innerHTML = `
      <div class="sched-drawer-header">
        <div class="sched-drawer-title" id="comm-drawer-title">新增内容</div>
        <button class="sched-drawer-close" onclick="CommunicationPage._closeEditor()">×</button>
      </div>
      <div class="sched-drawer-body" id="comm-drawer-body"></div>
      <div class="sched-drawer-footer" id="comm-drawer-footer"></div>
    `;
    document.body.appendChild(d);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.editor.open) closeEditor();
    });
  }

  function paintEditor() {
    document.getElementById('comm-drawer-title').textContent =
      state.editor.mode === 'edit' ? '编辑内容' : '新增内容';
    document.getElementById('comm-drawer-body').innerHTML = renderEditorForm();
    document.getElementById('comm-drawer-footer').innerHTML = renderEditorFooter();
    bindEditorForm();
  }

  function renderEditorForm() {
    const f = state.editor.form;
    const err = state.editor.errors;
    const realSchedId = (f.schedule_id && f.schedule_id !== 'none') ? f.schedule_id : null;
    const sched = realSchedId ? window.DB.schedules.find(x => x.id === realSchedId) : null;
    const r = sched ? SD.resolveContent({ schedule_id: realSchedId }) : null;
    // 排期选择器：未选择 / 不关联排期 / 已发布排期
    const schedOptions = window.SchedulePicker ? window.SchedulePicker.contentOptionsHTML(f.schedule_id) : '';

    // 检测：新建模式下，选中的排期是否已有自动生成的内容记录
    let autoCreatedWarning = '';
    if (state.editor.mode === 'create' && realSchedId) {
      const existingAuto = (window.DB.contents || []).find(c => c.schedule_id === realSchedId && c.auto_created);
      if (existingAuto) {
        autoCreatedWarning = `
          <div style="margin-top:8px;padding:10px 12px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;font-size:.82rem;display:flex;align-items:flex-start;gap:8px">
            <span style="font-size:1rem;flex-shrink:0">⚠️</span>
            <div>
              <b style="color:#92400e">该排期已有系统自动生成的内容记录</b>
              <div style="margin-top:4px;color:#78350f">建议直接编辑已有记录填写发布链接和数据，避免重复。
                <a href="javascript:void(0)" style="color:var(--primary);font-weight:500"
                   onclick="CommunicationPage._closeEditor();CommunicationPage.openEditor('${existingAuto.id}')">点击去编辑该记录 →</a>
              </div>
            </div>
          </div>
        `;
      }
    }

    // 主信息（从排期带）
    const realSchedIdForPrice = (f.schedule_id && f.schedule_id !== 'none') ? f.schedule_id : null;
    const hasSettlement = realSchedIdForPrice
      ? (window.DB?.settlements || []).some(s => s.schedule_id === realSchedIdForPrice)
      : false;
    const priceBlock = (() => {
      if (realSchedIdForPrice && hasSettlement) {
        return `
          <label class="sched-form-label">合作价格</label>
          <div class="sched-form-control" style="background:var(--bg-secondary);display:flex;align-items:center;gap:6px;cursor:default">
            <span style="font-weight:500">¥${Number(f.price || 0).toLocaleString()}</span>
            <span style="font-size:.65rem;color:var(--text-muted);margin-left:auto">🔒 已有结算</span>
          </div>`;
      }
      const hint = realSchedIdForPrice ? '保存后同步排期' : '';
      return `
        <label class="sched-form-label">合作价格</label>
        <input id="cf-price" class="sched-form-control" type="number" min="0" step="1"
               placeholder="请输入金额"
               value="${escapeAttr(f.price)}">
        ${hint ? `<div class="sched-form-hint">${hint}</div>` : ''}`;
    })();
    const mainInfo = r ? `
      <div style="background:var(--primary-light);padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:.85rem">
        <strong style="color:var(--primary)">主信息（来自关联排期）</strong>
        <div style="margin-top:6px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:.82rem">
          <div><span style="color:var(--text-muted)">达人：</span><b>${escapeHtml(r.talent)}</b></div>
          <div><span style="color:var(--text-muted)">类型：</span><b>${escapeHtml(r.category || '-')}</b></div>
          <div><span style="color:var(--text-muted)">BD：</span><b style="color:${r.bd_color || 'inherit'}">${escapeHtml(r.bd_name || '-')}</b></div>
        </div>
      </div>
    ` : '';
    const kolNameBlock = f.schedule_id === 'none' ? `
      <div class="sched-form-group">
        <label class="sched-form-label">达人昵称<span class="req">*</span></label>
        <input id="cf-kol-name" class="sched-form-control ${err.kol_name?'error':''}" type="text"
               placeholder="请输入达人昵称（必填）"
               value="${escapeAttr(f.kol_name)}">
      </div>
      <div class="sched-form-group">
        <div style="display:flex;gap:10px">
          <div style="flex:1">
            <label class="sched-form-label">达人类型<span class="req">*</span></label>
            <select id="cf-direction" class="sched-form-control ${err.category_direction?'error':''}">
              ${['<option value="">— 请选择 —</option>'].concat((SD.listDirections?SD.listDirections():[]).map(d=>`<option value="${escapeAttr(d.name)}" ${f.category_direction===d.name?'selected':''}>${escapeHtml(d.name)}</option>`)).join('')}
            </select>
          </div>
          <div style="flex:1">
            <label class="sched-form-label">作品类型<span class="req">*</span></label>
            <select id="cf-worktype" class="sched-form-control ${err.work_type?'error':''}">
              ${['<option value="">— 请选择 —</option>'].concat((SD.listWorkTypes?SD.listWorkTypes():[]).map(d=>`<option value="${escapeAttr(d.name)}" ${f.work_type===d.name?'selected':''}>${escapeHtml(d.name)}</option>`)).join('')}
            </select>
          </div>
        </div>
      </div>
    ` : '';
    const schedBlock = state.editor.fromPlaceholder ? '' : `
      <div class="sched-form-group">
        <label class="sched-form-label">关联排期<span class="req">*</span></label>
        <select id="cf-schedule" class="sched-form-control ${err.schedule_id?'error':''}">${schedOptions}</select>
        <div class="sched-form-hint">选「不关联排期」需填写达人昵称；或关联一条已发布排期</div>
        ${autoCreatedWarning}
      </div>
      ${kolNameBlock}`;
    return `
      ${schedBlock}
      ${mainInfo}
      <div class="sched-form-group">
        <div style="display:flex;gap:10px;align-items:flex-start">
          ${priceBlock ? `<div style="flex:1">${priceBlock}</div>` : ''}
          <div style="flex:1">
            <label class="sched-form-label">粉丝量</label>
            <input id="cf-fans" class="sched-form-control" type="text"
                   placeholder="如 50000 或 5万"
                   value="${escapeAttr(f.fans)}">
            <div class="sched-form-hint">${formatFansHint(f.fans)}</div>
          </div>
          <div style="flex:1">
            <label class="sched-form-label">商务BD</label>
            ${_renderContentBdSelector(f.bd_id)}
          </div>
        </div>
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">发布平台</label>
        <div style="margin-top:4px">
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:500;margin-bottom:5px">主平台（单选）</div>
          <div id="cf-main-platform-wrap" class="platform-tags">
            ${SD.listPlatforms().map(p => `
              <label class="platform-tag ${f.main_platform===p.name?'active':''}">
                <input type="radio" name="cf-main-platform" value="${escapeAttr(p.name)}" ${f.main_platform===p.name?'checked':''}
                       onchange="CommunicationPage._setEditorMainPlatform(this.value)">
                <span>${escapeHtml(p.name)}</span>
              </label>`).join('')}
          </div>
          <div style="font-size:.75rem;color:var(--text-muted);font-weight:500;margin-top:10px;margin-bottom:5px">同步平台（可多选）</div>
          <div id="cf-sync-platforms-wrap" class="platform-tags">
            ${SD.listPlatforms().filter(p => p.name !== f.main_platform).map(p => `
              <label class="platform-tag ${f.sync_platforms.includes(p.name)?'active':''}">
                <input type="checkbox" value="${escapeAttr(p.name)}" ${f.sync_platforms.includes(p.name)?'checked':''}
                       onchange="CommunicationPage._toggleSyncPlatform(this.value,this.checked)">
                <span>${escapeHtml(p.name)}</span>
              </label>`).join('')}
          </div>
        </div>
      </div>

      <div style="margin:18px 0 8px">
        <strong class="comm-pubs-header" style="font-size:.92rem">📡 发布渠道（${f.publications.length}）</strong>
      </div>
      <div id="cf-pubs">
        ${f.publications.map((p, i) => renderPubBlock(p, i)).join('')}
      </div>
    `;
  }

  function renderPubBlock(p, idx) {
    const err = state.editor.errors;
    const isMain = idx === 0;
    const isDouyin = p.platform === '抖音';
    const blockLabel = isMain
      ? `<sup style="font-size:.6rem;font-weight:600;color:var(--primary);margin-right:2px;vertical-align:super">主</sup>${escapeHtml(p.platform)}`
      : `${escapeHtml(p.platform)} <span style="font-size:.68rem;color:var(--text-muted)">同步</span>`;
    return `
      <div class="comm-pub-block" data-idx="${idx}">
        <div class="comm-pub-head">
          <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
            <span class="sched-card-chip platform" style="align-self:center">${blockLabel}</span>
            <div style="display:flex;flex-direction:column;gap:3px">
              <label style="font-size:.7rem;color:var(--text-muted);font-weight:500">发布日期</label>
              <input type="date" class="form-control" style="width:145px;height:32px" value="${escapeAttr(p.date)}"
                     onchange="CommunicationPage._updatePub(${idx},'date',this.value)">
            </div>
          </div>
        </div>
        <div class="sched-form-group" style="margin-top:8px">
          <input class="sched-form-control${err[`pub_link_${idx}`] ? ' error' : ''}" placeholder="发布链接 https://..." value="${escapeAttr(p.link)}"
                 onchange="CommunicationPage._updatePub(${idx},'link',this.value)">
          ${(function() {
            if (!p.link || !p.date) return '';
            const today = new Date().toISOString().slice(0, 10);
            const endDate = SD.addDays ? SD.addDays(p.date, 6) : '';
            if (!endDate) return '';
            if (p.date > today) return '';
            if (today > endDate) {
              return `<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">✅ 7天追踪已结束（${p.date} → ${endDate}）</div>`;
            }
            return `<div style="font-size:.72rem;color:var(--info);margin-top:4px;padding:4px 8px;background:rgba(2,132,199,.08);border-radius:4px">📊 自动追踪中 · 点赞/评论将自动更新（截至 ${endDate}）</div>`;
          })()}
        </div>
        <div class="comm-pub-grid">
          <div><label>播放量(万)</label><input type="text" value="${escapeAttr(p.views)}" onchange="CommunicationPage._updatePub(${idx},'views',this.value)"></div>
          <div><label>赞</label><input type="number" min="0" value="${escapeAttr(p.likes)}" onchange="CommunicationPage._updatePub(${idx},'likes',this.value)"></div>
          <div><label>评论</label><input type="number" min="0" value="${escapeAttr(p.comments)}" onchange="CommunicationPage._updatePub(${idx},'comments',this.value)"></div>
          <div><label>完播率(%)</label><input type="text" value="${escapeAttr(p.completion)}" onchange="CommunicationPage._updatePub(${idx},'completion',this.value)"></div>
          <div><label>互动率(%)</label><input type="text" value="${escapeAttr(p.interaction)}" onchange="CommunicationPage._updatePub(${idx},'interaction',this.value)"></div>
        </div>
        ${isDouyin ? `
          <button type="button" onclick="CommunicationPage._toggleDouyinExtra(this)"
            style="display:flex;align-items:center;gap:6px;width:100%;padding:7px 12px;margin-bottom:0;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;cursor:pointer;font-size:.82rem;font-weight:500;color:#6d28d9;text-align:left">
            <span class="dy-arrow">▶</span>
            抖音专属数据（看后搜 / 投流 / 归因）
            <span style="margin-left:auto;font-size:.72rem;color:#a78bfa">点击展开</span>
          </button>
          <div class="dy-extra" style="display:none">
            <div style="display:flex;gap:12px;align-items:flex-start;margin-top:8px">
              <div class="comm-pub-subgroup" style="flex:1">
                <div class="comm-pub-subgroup-title">🔍 看后搜（抖音）</div>
                <div class="comm-pub-grid">
                  <div><label>看后搜量</label><input type="number" min="0" value="${escapeAttr(p.search_views)}" onchange="CommunicationPage._updatePub(${idx},'search_views',this.value)"></div>
                  <div><label>看后搜率(%)</label><input type="text" value="${escapeAttr(p.search_rate)}" onchange="CommunicationPage._updatePub(${idx},'search_rate',this.value)"></div>
                </div>
              </div>
              <div class="comm-pub-subgroup" style="flex:1">
                <div class="comm-pub-subgroup-title">🚀 投流数据（抖音）</div>
                <div class="comm-pub-grid">
                  <div><label>投流播放量(万)</label><input type="text" value="${escapeAttr(p.promo_views)}" onchange="CommunicationPage._updatePub(${idx},'promo_views',this.value)"></div>
                  <div><label>投流费(元)</label><input type="text" value="${escapeAttr(p.promo_cost)}" onchange="CommunicationPage._updatePub(${idx},'promo_cost',this.value)"></div>
                </div>
              </div>
            </div>
            <div class="comm-pub-subgroup">
              <div class="comm-pub-subgroup-title">🎯 归因数据（抖音）</div>
              <div class="comm-pub-grid" style="grid-template-columns:repeat(3,1fr)">
                <div><label>直接归因</label><input type="number" min="0" value="${escapeAttr(p.attr_direct)}" onchange="CommunicationPage._updatePub(${idx},'attr_direct',this.value)"></div>
                <div><label>简介归因</label><input type="number" min="0" value="${escapeAttr(p.attr_indirect)}" onchange="CommunicationPage._updatePub(${idx},'attr_indirect',this.value)"></div>
                <div><label>看后搜归因</label><input type="number" min="0" value="${escapeAttr(p.attr_search)}" onchange="CommunicationPage._updatePub(${idx},'attr_search',this.value)"></div>
                <div><label>人群获取</label><input type="number" min="0" value="${escapeAttr(p.attr_audience)}" onchange="CommunicationPage._updatePub(${idx},'attr_audience',this.value)"></div>
                <div><label>店铺表现</label><input type="text" value="${escapeAttr(p.attr_store)}" onchange="CommunicationPage._updatePub(${idx},'attr_store',this.value)"></div>
                <div><label>CPA3</label><input type="text" value="${escapeAttr(p.cpa3)}" onchange="CommunicationPage._updatePub(${idx},'cpa3',this.value)"></div>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function _toggleDouyinExtra(btn) {
    const extra = btn.nextElementSibling;
    if (!extra) return;
    const isOpen = extra.style.display !== 'none';
    extra.style.display = isOpen ? 'none' : '';
    btn.querySelector('.dy-arrow').textContent = isOpen ? '▶' : '▼';
    const hint = btn.querySelector('span:last-child');
    if (hint) hint.textContent = isOpen ? '点击展开' : '点击收起';
  }

  function bindEditorForm() {
    const sel = document.getElementById('cf-schedule');
    if (sel) sel.addEventListener('change', e => {
      const f = state.editor.form;
      f.schedule_id = e.target.value;
      if (e.target.value !== 'none') f.kol_name = '';
      // 关联排期时，从排期自动带入主/同步平台
      if (e.target.value && e.target.value !== 'none') {
        const sched = (window.DB.schedules || []).find(s => s.id === e.target.value);
        if (sched && sched.platform) {
          f.main_platform = sched.platform;
          f.sync_platforms = Array.isArray(sched.sync_platforms) ? [...sched.sync_platforms] : [];
          f.price = sched.amount != null ? String(sched.amount) : '';
          _rebuildPublications(f);
          // 主平台带入排期日期，同步平台保持空
          if (sched.schedule_date && f.publications.length > 0) {
            f.publications[0].date = sched.schedule_date;
          }
        }
      }
      paintEditor();
    });
    const kolName = document.getElementById('cf-kol-name');
    if (kolName) kolName.addEventListener('input', e => {
      state.editor.form.kol_name = e.target.value;
    });
    const cfDir = document.getElementById('cf-direction');
    if (cfDir) cfDir.addEventListener('change', e => { state.editor.form.category_direction = e.target.value; });
    const cfWt = document.getElementById('cf-worktype');
    if (cfWt) cfWt.addEventListener('change', e => { state.editor.form.work_type = e.target.value; });
    const fans = document.getElementById('cf-fans');
    if (fans) fans.addEventListener('input', e => {
      state.editor.form.fans = e.target.value;
      const hint = document.querySelector('#cf-fans + .sched-form-hint');
      if (hint) hint.innerHTML = formatFansHint(e.target.value);
    });
    const bdSel = document.getElementById('cf-bd-id');
    if (bdSel) bdSel.addEventListener('change', e => { state.editor.form.bd_id = e.target.value; });
    const priceInput = document.getElementById('cf-price');
    if (priceInput) priceInput.addEventListener('input', e => { state.editor.form.price = e.target.value; });
  }

  function _renderContentBdSelector(currentId) {
    const personnel = SD.listBdPersonnel();
    const user = window.currentUser;
    if (user?.identity === 'bd' || user?.identity === 'supervisor') {
      const cur = personnel.find(b => String(b.id) === String(currentId));
      return `<div class="sched-form-control" style="background:var(--bg-secondary);display:flex;align-items:center;gap:6px;cursor:default">
        ${cur?.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cur.color};flex-shrink:0"></span>` : ''}
        <span style="font-weight:500">${escapeHtml(cur?.name || '-')}</span>
        <span style="font-size:.72rem;color:var(--text-muted);margin-left:auto">当前账号</span>
      </div>`;
    }
    return `<select id="cf-bd-id" class="sched-form-control">
      <option value="">全部BD</option>
      ${personnel.map(b => `<option value="${b.id}" ${String(currentId) === String(b.id) ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
    </select>`;
  }

  function renderEditorFooter() {
    const isEdit = state.editor.mode === 'edit';
    return `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="CommunicationPage._delete('${state.editor.id}')">删除</button>` : ''}
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-secondary btn-sm" onclick="CommunicationPage._closeEditor()">取消</button>
      <button class="btn btn-primary btn-sm" onclick="CommunicationPage._save()">保存</button>
    `;
  }

  /* 转结算 —— 跳转到达人结算·待结算 tab */
  function _schedToSettlement(schedId) {
    if (typeof window.navigate === 'function') {
      window.navigate('settlement');
      if (typeof window.setStTab === 'function') window.setStTab('pending');
    } else {
      window.toast && window.toast('结算模块未就绪', 'error');
    }
  }

  function _toSettlement(contentId) {
    if (typeof window.navigate === 'function') {
      window.navigate('settlement');
      if (typeof window.setStTab === 'function') window.setStTab('pending');
    } else {
      window.toast && window.toast('结算模块未就绪', 'error');
    }
  }

  /* 平台选择器操作（编辑器内，避免与 tab 切换的 _setMainPlatform 冲突） */
  function _setEditorMainPlatform(name) {
    const f = state.editor.form;
    // 从同步平台移除（若已勾选）
    const idx = f.sync_platforms.indexOf(name);
    if (idx >= 0) f.sync_platforms.splice(idx, 1);
    f.main_platform = name;
    _rebuildPublications(f);
    // 更新主平台 radio 样式
    const mainWrap = document.getElementById('cf-main-platform-wrap');
    if (mainWrap) mainWrap.querySelectorAll('.platform-tag').forEach(label => {
      const rb = label.querySelector('input[type=radio]');
      if (rb) label.classList.toggle('active', rb.checked);
    });
    // 重建同步平台 wrap（排除刚选的主平台）
    _rebuildSyncWrap();
    // 只重绘渠道区域
    const pubsEl = document.getElementById('cf-pubs');
    if (pubsEl) pubsEl.innerHTML = f.publications.map((p, i) => renderPubBlock(p, i)).join('');
    const hdr = document.querySelector('.comm-pubs-header');
    if (hdr) hdr.textContent = `📡 发布渠道（${f.publications.length}）`;
  }

  function _toggleSyncPlatform(name, checked) {
    const f = state.editor.form;
    if (checked) {
      if (!f.sync_platforms.includes(name)) f.sync_platforms.push(name);
    } else {
      const idx = f.sync_platforms.indexOf(name);
      if (idx >= 0) f.sync_platforms.splice(idx, 1);
    }
    _rebuildPublications(f);
    // 更新复选框样式
    const syncWrap = document.getElementById('cf-sync-platforms-wrap');
    if (syncWrap) syncWrap.querySelectorAll('.platform-tag').forEach(label => {
      const cb = label.querySelector('input[type=checkbox]');
      if (cb) label.classList.toggle('active', cb.checked);
    });
    // 重绘渠道区域
    const pubsEl = document.getElementById('cf-pubs');
    if (pubsEl) pubsEl.innerHTML = f.publications.map((p, i) => renderPubBlock(p, i)).join('');
    const header = document.querySelector('.comm-pubs-header');
    if (header) header.textContent = `📡 发布渠道（${f.publications.length}）`;
  }

  function _rebuildSyncWrap() {
    const wrap = document.getElementById('cf-sync-platforms-wrap');
    if (!wrap) return;
    const f = state.editor.form;
    wrap.innerHTML = SD.listPlatforms()
      .filter(p => p.name !== f.main_platform)
      .map(p => `
        <label class="platform-tag ${f.sync_platforms.includes(p.name)?'active':''}">
          <input type="checkbox" value="${escapeAttr(p.name)}" ${f.sync_platforms.includes(p.name)?'checked':''}
                 onchange="CommunicationPage._toggleSyncPlatform(this.value,this.checked)">
          <span>${escapeHtml(p.name)}</span>
        </label>`).join('');
  }

  /* publication 操作 */
  function _addPub() {
    state.editor.form.publications.push(defaultPublication(state.mainPlatform, ''));
    paintEditor();
  }
  function _removePub(idx) {
    if (state.editor.form.publications.length <= 1) {
      window.toast && window.toast('至少保留一个发布渠道', 'error');
      return;
    }
    state.editor.form.publications.splice(idx, 1);
    paintEditor();
  }
  function _updatePub(idx, field, value) {
    const p = state.editor.form.publications[idx];
    if (!p) return;
    p[field] = value;
    // 任何指标变化都刷新 snapshot_at
    if (['views','likes','comments','completion','interaction','search_views','search_rate',
         'attr_direct','attr_indirect','attr_search','attr_audience','attr_store','cpa3',
         'promo_views','promo_cost'].includes(field)) {
      p.snapshot_at = new Date().toISOString();
    }
    // 仅在切换 platform 时需要重渲染（显示/隐藏抖音独有字段）
    if (field === 'platform') paintEditor();
  }
  function _updateSnapshot(idx, v) {
    const p = state.editor.form.publications[idx];
    if (!p) return;
    p.snapshot_day = v;
    p.snapshot_at = new Date().toISOString();
  }

  /* 保存 */
  function _save() {
    const f = state.editor.form;
    const errs = {};
    if (!f.schedule_id) errs.schedule_id = '请选择关联排期，或选择「不关联排期」';
    if (f.schedule_id === 'none') {
      if (!f.kol_name.trim())      errs.kol_name = '选择不关联排期时，达人昵称为必填';
      if (!f.category_direction)   errs.category_direction = '请选择达人类型';
      if (!f.work_type)            errs.work_type = '请选择作品类型';
    }
    f.publications.forEach((p, idx) => {
      // 链接非必填，无需校验
    });
    state.editor.errors = errs;
    if (Object.keys(errs).length) {
      paintEditor();
      window.toast && window.toast(Object.values(errs)[0], 'error');
      return;
    }
    try {
      // 粉丝量解析
      let fans = null;
      if (f.fans !== '') {
        const s = String(f.fans).replace(/[,，\s]/g, '');
        const w = s.match(/^([\d.]+)\s*万$/);
        if (w) fans = Math.round(Number(w[1]) * 10000);
        else {
          const n = Number(s);
          if (Number.isFinite(n) && n >= 0) fans = n;
        }
      }
      const data = {
        schedule_id: f.schedule_id === 'none' ? null : f.schedule_id,
        kol_name: f.schedule_id === 'none' ? f.kol_name.trim() : null,
        category_direction: f.schedule_id === 'none' ? f.category_direction : undefined,
        work_type: f.schedule_id === 'none' ? f.work_type : undefined,
        fans,
        // 不关联排期：BD 按当前登录账号自动带入（无需手填）；关联排期：BD 跟随排期
        bd_id: f.schedule_id === 'none'
          ? (window.currentUser?.bd_id || window.currentUser?.id || f.bd_id || null)
          : (f.bd_id || null),
        price: f.price !== '' ? (Number(f.price) || 0) : null,
        publications: f.publications,
      };
      // 不关联排期时，把达人综合信息写入达人库（达人类型/粉丝/BD/平台），并回写 kol_id 以便统计合作次数/金额
      if (f.schedule_id === 'none' && f.kol_name.trim()) {
        try {
          const kol = SD.quickCreateKol({
            name: f.kol_name.trim(),
            platform: f.main_platform || '',
            // 主页 = 达人个人主页，与作品发布链接不同，手动新增时无此信息，留空
            category: f.category_direction || '',
            followers: fans,
            bd_id: data.bd_id || null,
          });
          if (kol && kol.id) data.kol_id = kol.id;
        } catch (e) {
          console.warn('[CommunicationPage] quickCreateKol failed', e);
        }
      }
      // 同步排期金额（有关联排期 + 无结算记录 + 价格有变）
      const schedIdForPrice = data.schedule_id;
      if (schedIdForPrice && f.price !== '') {
        const noSettlement = !(window.DB?.settlements || []).some(s => s.schedule_id === schedIdForPrice);
        if (noSettlement) {
          const sched = (window.DB?.schedules || []).find(x => x.id === schedIdForPrice);
          const newAmt = Number(f.price) || 0;
          if (sched && sched.amount !== newAmt) {
            SD.updateSchedule(schedIdForPrice, { ...sched, amount: newAmt });
          }
        }
      }
      if (state.editor.mode === 'edit') {
        SD.updateContent(state.editor.id, data);
        window.toast && window.toast('已更新', 'success');
      } else {
        SD.createContent(data);
        window.toast && window.toast('已新增', 'success');
      }
      // 同步发布日期回排期：关联排期时，主平台发布日期 → 排期日期统一（全系统只用一个日期）
      const schedIdForDate = data.schedule_id;
      const mainPubDate = (f.publications[0] && f.publications[0].date) || '';
      if (schedIdForDate && mainPubDate) {
        const sched = (window.DB?.schedules || []).find(x => x.id === schedIdForDate);
        if (sched && sched.schedule_date !== mainPubDate) {
          SD.updateSchedule(schedIdForDate, { schedule_date: mainPubDate, _fromContent: true });
        }
      }
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  function _delete(id) {
    if (SD.isMonthFrozen(state.year, state.month)) {
      window.toast && window.toast('该月已冻结，请先解冻再删除', 'error');
      return;
    }
    if (!confirm('删除这条内容？关联的达人结算记录也会一并删除，不可恢复。')) return;
    try {
      const res = SD.deleteContent(id);
      const msg = res.deletedSettlements > 0 ? `已删除（含 ${res.deletedSettlements} 条结算记录）` : '已删除';
      window.toast && window.toast(msg, 'info');
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  /* ------------------------- 工具 ------------------------- */
  /* ------------------------- 内联编辑链接 ------------------------- */
  /**
   * 点击发布链接单元格 → 直接在表格里编辑，Enter/失焦保存，Esc 取消
   * @param {string} contentId 内容记录 id
   * @param {string} pubId     publication id
   * @param {HTMLElement} tdEl 被点击的 <td>
   */
  function _inlineEditLink(contentId, pubId, tdEl) {
    if (SD.isMonthFrozen(state.year, state.month)) { toast('该月已冻结，请先解冻再编辑', 'error'); return; }
    if (tdEl.querySelector('input')) return; // 已在编辑中

    const content = (window.DB.contents || []).find(c => c.id === contentId);
    if (!content) return;
    const pub = (content.publications || []).find(p => p.id === pubId);
    const currentLink = pub ? (pub.link || '') : '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentLink;
    input.placeholder = 'https://...';
    input.style.cssText = 'width:100%;border:1px solid var(--primary);border-radius:4px;padding:4px 6px;font-size:.78rem;outline:none;box-sizing:border-box';

    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      const newLink = input.value.trim();
      if (newLink === currentLink) { render(); return; }
      try {
        const newPubs = (content.publications || []).map(p =>
          p.id === pubId ? { ...p, link: newLink } : p
        );
        // 填了真实链接 → 清除 auto_created 标记，变为真实记录
        const patch = { publications: newPubs };
        if (content.auto_created && newLink) patch.auto_created = false;
        SD.updateContent(contentId, patch);
        window.toast && window.toast('链接已保存', 'success');
        window.updateReminderBadge && updateReminderBadge();
      } catch(e) {
        window.toast && window.toast('保存失败: ' + e.message, 'error');
      }
      render();
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); saved = true; render(); }
    });

    tdEl.innerHTML = '';
    tdEl.appendChild(input);
    input.focus();
    if (currentLink) input.select();
  }

  /**
   * 点击播放量单元格 → 内联编辑（万，支持小数）
   */
  function _inlineEditViews(contentId, pubId, tdEl) {
    if (SD.isMonthFrozen(state.year, state.month)) { toast('该月已冻结，请先解冻再编辑', 'error'); return; }
    if (tdEl.querySelector('input')) return;

    const content = (window.DB.contents || []).find(c => c.id === contentId);
    if (!content) return;
    const pub = (content.publications || []).find(p => p.id === pubId);
    const current = pub && pub.views != null ? pub.views : '';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.value = current;
    input.placeholder = '万';
    input.style.cssText = 'width:100%;border:1px solid var(--primary);border-radius:4px;padding:4px 6px;font-size:.78rem;outline:none;box-sizing:border-box';

    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      const raw = input.value.trim();
      const newVal = raw === '' ? null : Number(raw);
      if (newVal === current || (newVal == null && current === '')) { render(); return; }
      try {
        const newPubs = (content.publications || []).map(p =>
          p.id === pubId ? { ...p, views: newVal } : p
        );
        SD.updateContent(contentId, { publications: newPubs });
        window.toast && window.toast('播放量已保存', 'success');
      } catch(e) {
        window.toast && window.toast('保存失败: ' + e.message, 'error');
      }
      render();
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); saved = true; render(); }
    });

    tdEl.innerHTML = '';
    tdEl.appendChild(input);
    input.focus();
    if (current !== '') input.select();
  }

  function _inlineEditDate(contentId, pubId, tdEl) {
    if (SD.isMonthFrozen(state.year, state.month)) { toast('该月已冻结，请先解冻再编辑', 'error'); return; }
    if (tdEl.querySelector('input')) return;
    const content = (window.DB.contents || []).find(c => c.id === contentId);
    if (!content) return;
    const pub = (content.publications || []).find(p => p.id === pubId);
    const current = pub ? (pub.date || '') : '';
    const input = document.createElement('input');
    input.type = 'date';
    input.value = current;
    input.style.cssText = 'width:130px;border:1px solid var(--primary);border-radius:4px;padding:4px 6px;font-size:.78rem;outline:none;box-sizing:border-box';
    let saved = false;
    const save = () => {
      if (saved) return;
      saved = true;
      const newVal = input.value.trim();
      if (newVal === current) { render(); return; }
      try {
        const newPubs = (content.publications || []).map(p =>
          p.id === pubId ? { ...p, date: newVal } : p
        );
        SD.updateContent(contentId, { publications: newPubs });
        window.toast && window.toast('发布日期已保存', 'success');
      } catch(e) {
        window.toast && window.toast('保存失败: ' + e.message, 'error');
      }
      render();
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); saved = true; render(); }
    });
    tdEl.innerHTML = '';
    tdEl.appendChild(input);
    input.focus();
  }

  /** 取 publication 的最新一天快照（daily_stats 按日期倒序取第一条） */
  function getLatestStats(p) {
    const stats = p.daily_stats || [];
    if (!stats.length) return null;
    return stats.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  }

  /** 渲染点赞/评论单元格：优先展示 daily_stats 最新快照，fallback 到手动值 */
  function renderStatCell(p, field) {
    const s = getLatestStats(p);
    const autoVal = s && s[field] != null ? s[field] : null;
    const manualVal = p[field];
    const val = autoVal != null ? autoVal : manualVal;
    if (val == null || val === '') return '-';
    const dateTag = autoVal != null
      ? `<span style="font-size:.62rem;color:var(--text-muted);margin-left:3px" title="数据截至 ${s.date}">${s.date.slice(5)}</span>`
      : '';
    return `<span style="color:var(--success);font-weight:500">${Number(val).toLocaleString()}</span>${dateTag}`;
  }

  function fmtNullable(v, fallback = '-') {
    if (v == null || v === '') return fallback;
    return Number(v).toLocaleString();
  }
  function fmtPercent(v) {
    if (v == null || v === '') return '-';
    return Number(v).toFixed(1) + '%';
  }
  function formatFans(n) {
    if (n == null) return '-';
    if (n >= 10000) return (n / 10000).toFixed(1) + 'W';
    return n.toLocaleString();
  }
  function formatFansHint(raw) {
    if (raw === '' || raw == null) return '';
    const s = String(raw).replace(/[,，\s]/g, '');
    const w = s.match(/^([\d.]+)\s*万$/);
    let n;
    if (w) n = Math.round(Number(w[1]) * 10000);
    else { n = Number(s); if (!Number.isFinite(n)) return `<span style="color:var(--danger)">「${raw}」格式不识别</span>`; }
    return `≈ ${n.toLocaleString()} 人`;
  }
  function renderLink(url) {
    if (!url) return '-';
    const short = url.length > 24 ? url.slice(0, 24) + '...' : url;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
              style="color:var(--primary);text-decoration:none;font-size:.78rem">${escapeHtml(short)}</a>`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ------------------------- 暴露 ------------------------- */
  window.CommunicationPage = {
    render, openEditor,
    _setMainPlatform, _prevMonth, _nextMonth,
    _save, _delete, _closeEditor: closeEditor, _toSettlement, _schedToSettlement,
    _setEditorMainPlatform, _toggleSyncPlatform, _rebuildSyncWrap,
    _addPub, _removePub, _updatePub, _updateSnapshot,
    _toggleColPop, _toggleCol, _showAllCols, _resetCols, _saveColPop,
    _inlineEditLink, _inlineEditViews, _inlineEditField, _inlineEditDate,
    _toggleFreeze,
    _toggleSelect, _selectAll, _deleteSelected,
    _toggleDouyinExtra,
    _getState: () => ({ year: state.year, month: state.month, mainPlatform: state.mainPlatform, bd_id: state.bd_id }),
  };
  console.log('[CommunicationPage] 已就绪');
})();
