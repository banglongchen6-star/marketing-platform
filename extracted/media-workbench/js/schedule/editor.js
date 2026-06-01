/* =====================================================================
 * 达人营销 · 内容排期模块 · 排期编辑抽屉 (Phase 3)
 *
 * 暴露：
 *   window.ScheduleEditor = { open(id, prefillDate), close() }
 *   window.openScheduleEditor(id, prefillDate)   ← 覆盖 Phase 2 stub
 *
 * 抽屉内含子组件 KolSelector：达人名搜索框 + 已有匹配列表 + 一键创建新达人。
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[ScheduleEditor] ScheduleData 未就绪'); return; }

  // status >= published 才显示发布链接/日期
  const PUBLISH_VISIBLE = new Set(['published']);

  const STATUS_LABELS = { planned:'计划中', published:'已发布' };
  const STATUS_COLORS = { planned:'#3b82f6', published:'#10b981' };

  // 按日期自动计算状态
  function computeStatus(date) {
    if (!date) return 'planned';
    return date < todayStr() ? 'published' : 'planned';
  }

  // 编辑器内部状态（每次 open 重置）
  const state = {
    mode: 'create',         // 'create' | 'edit'
    id: null,
    form: defaultForm(),
    saveAndContinue: false,
    kolItems: [],           // KolSelector 当前搜索结果
    kolOpen: false,
    kolSearchTimer: null,
    errors: {},
    activeTab: 'basic',     // 'basic' | 'samples' | 'materials' | 'contents' | 'settlements'
  };

  const TABS = [
    { key: 'basic',       label: '基本信息', icon: '📝' },
    { key: 'samples',     label: '样品',     icon: '📦', source: 'samples',     openModal: 'openSampleModal',     fieldId: 'sp-schedule-id' },
    { key: 'settlements', label: '结算',     icon: '💰', source: 'settlements', openModal: 'openSettlementModal', fieldId: 'se-schedule-id' },
  ];

  function defaultForm(prefillDate, prefillKolName) {
    return {
      schedule_date: prefillDate || '',
      kol_name: prefillKolName || '',
      kol_id: null,
      kol_homepage: '',
      bd_id: window.currentUser?.bd_id || null,
      category_direction: '',
      tier: '',
      platform: '',
      sync_platforms: [],
      amount: '',
      status: 'planned',
      publish_url: '',
      publish_date: '',
      notes: '',
    };
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  /* ------------------------- 1. 抽屉骨架（懒创建） ------------------------- */
  function ensureDrawerNode() {
    if (document.getElementById('sched-drawer')) return;
    const overlay = document.createElement('div');
    overlay.className = 'sched-drawer-overlay';
    overlay.id = 'sched-drawer-overlay';
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);

    const drawer = document.createElement('div');
    drawer.className = 'sched-drawer';
    drawer.id = 'sched-drawer';
    drawer.innerHTML = `
      <div class="sched-drawer-header">
        <div class="sched-drawer-title" id="sched-drawer-title">新增排期</div>
        <button class="sched-drawer-close" onclick="ScheduleEditor.close()" title="关闭">×</button>
      </div>
      <div class="sched-drawer-body" id="sched-drawer-body"></div>
      <div class="sched-drawer-footer" id="sched-drawer-footer"></div>
    `;
    document.body.appendChild(drawer);

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  }

  /* ------------------------- 2. 打开 / 关闭 ------------------------- */
  function open(id, prefillDate, prefillKolName) {
    ensureDrawerNode();
    state.errors = {};
    if (id) {
      const s = window.DB.schedules.find(x => x.id === id);
      if (!s) { window.toast && window.toast('排期不存在', 'error'); return; }
      state.mode = 'edit';
      state.id = id;
      state.form = {
        schedule_date: s.schedule_date || todayStr(),
        kol_name: s.kol_name || '',
        kol_id: s.kol_id || null,
        kol_homepage: s.kol_homepage || '',
        bd_id: s.bd_id || null,
        category_direction: s.category_direction || '',
        tier: s.tier || '',
        platform: s.platform || (Array.isArray(s.platforms) ? s.platforms[0] : '') || '',
        sync_platforms: Array.isArray(s.sync_platforms) ? [...s.sync_platforms] : (Array.isArray(s.platforms) ? s.platforms.slice(1) : []),
        amount: s.amount != null ? String(s.amount) : '',
        status: s.status || 'planned',
        publish_url: s.publish_url || '',
        publish_date: s.publish_date || '',
        notes: s.notes || '',
      };
    } else {
      state.mode = 'create';
      state.id = null;
      state.form = defaultForm(prefillDate, prefillKolName);
    }
    state.saveAndContinue = false;
    state.kolItems = [];
    state.kolOpen = false;
    renderAll();
    requestAnimationFrame(() => {
      document.getElementById('sched-drawer').classList.add('open');
      document.getElementById('sched-drawer-overlay').classList.add('open');
      // 自动聚焦第一个空必填字段
      setTimeout(() => {
        if (!state.form.kol_name) document.getElementById('f-kol-input')?.focus();
        else document.getElementById('f-amount')?.focus();
      }, 250);
    });
  }

  function close() {
    const d = document.getElementById('sched-drawer');
    const o = document.getElementById('sched-drawer-overlay');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
  }

  /* ------------------------- 3. 渲染 ------------------------- */
  function renderAll() {
    document.getElementById('sched-drawer-title').textContent =
      state.mode === 'edit' ? '编辑排期' : '新增排期';
    const isEdit = state.mode === 'edit';
    // 新增模式只显示"基本信息"（还没保存就没法关联其他模块）
    if (!isEdit) state.activeTab = 'basic';
    const tabsHTML = isEdit ? renderTabBar() : '';
    let bodyHTML = '';
    if (state.activeTab === 'basic') bodyHTML = renderForm();
    else bodyHTML = renderLinkedTab(state.activeTab);
    document.getElementById('sched-drawer-body').innerHTML = tabsHTML + bodyHTML;
    document.getElementById('sched-drawer-footer').innerHTML = renderFooter();
    if (state.activeTab === 'basic') bindFormHandlers();
  }

  function renderTabBar() {
    return `
      <div class="sched-tab-bar">
        ${TABS.map(t => {
          const count = t.key === 'basic' ? '' : countLinked(t.source);
          const badge = count ? `<span class="sched-tab-badge">${count}</span>` : '';
          const active = state.activeTab === t.key ? ' active' : '';
          return `<button class="sched-tab${active}" onclick="ScheduleEditor._switchTab('${t.key}')">
            ${t.icon} ${t.label}${badge}
          </button>`;
        }).join('')}
      </div>
    `;
  }

  function countLinked(source) {
    if (!state.id || !window.DB || !window.DB[source]) return 0;
    return window.DB[source].filter(x => x.schedule_id === state.id).length;
  }

  function _switchTab(key) {
    if (!TABS.find(t => t.key === key)) return;
    state.activeTab = key;
    renderAll();
  }

  /* 关联 tab 内容渲染 */
  function renderLinkedTab(tabKey) {
    if (tabKey === 'samples')     return renderSamplesReadOnly();
    if (tabKey === 'settlements') return renderSettlementsReadOnly();
    return '';
  }

  const SAMPLE_STATUS = {
    sent:        { label: '已寄出',  color: '#3b82f6' },
    transferred: { label: '已流转',  color: '#8b5cf6' },
    signed:      { label: '已签收',  color: '#10b981' },
    returned:    { label: '已归还',  color: '#6b7280' },
    gifted:      { label: '已赠送',  color: '#ec4899' },
  };

  function renderSamplesReadOnly() {
    const items = (window.DB.samples || []).filter(x => x.schedule_id === state.id);
    if (items.length === 0) {
      return `
        <div class="sched-linked-tab">
          <div style="text-align:center;padding:36px 16px;color:var(--text-muted)">
            <div style="font-size:2rem">📦</div>
            <div style="margin-top:8px">暂无关联样品</div>
          </div>
          <div style="text-align:center;padding-bottom:16px">
            <button class="btn btn-secondary btn-sm" onclick="ScheduleEditor.close();navigate('samples')">→ 去样品管理添加</button>
          </div>
        </div>`;
    }
    const rows = items.map(s => {
      const st = SAMPLE_STATUS[s.status] || { label: s.status || '—', color: '#6b7280' };
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:.88rem">${escapeHtml(s.product || '—')}</div>
            ${s.tracking ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">快递：${escapeHtml(s.tracking)}</div>` : ''}
            ${s.date ? `<div style="font-size:.75rem;color:var(--text-muted)">寄出：${escapeHtml(s.date)}</div>` : ''}
          </div>
          <span style="font-size:.72rem;padding:2px 8px;border-radius:10px;background:${st.color}18;color:${st.color};border:1px solid ${st.color}40;white-space:nowrap">${st.label}</span>
        </div>`;
    }).join('');
    return `
      <div class="sched-linked-tab">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:4px">共 ${items.length} 件样品</div>
        <div>${rows}</div>
        <div style="text-align:right;margin-top:14px">
          <button class="btn btn-secondary btn-sm" onclick="ScheduleEditor.close();navigate('samples')">→ 去样品管理查看详情</button>
        </div>
      </div>`;
  }

  function renderSettlementsReadOnly() {
    const items = (window.DB.settlements || []).filter(x => x.schedule_id === state.id);
    if (items.length === 0) {
      return `
        <div class="sched-linked-tab">
          <div style="text-align:center;padding:36px 16px;color:var(--text-muted)">
            <div style="font-size:2rem">💰</div>
            <div style="margin-top:8px">暂无结算记录</div>
          </div>
          <div style="text-align:center;padding-bottom:16px">
            <button class="btn btn-secondary btn-sm" onclick="ScheduleEditor.close();navigate('settlement')">→ 去结算管理添加</button>
          </div>
        </div>`;
    }
    const rows = items.map(s => {
      const total = Number(s.amount) || 0;
      const paid = (s.payments || []).filter(p => !!p.paid_date).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const unpaid = total - paid;
      const statusColor = s.status === '已付款' ? '#10b981' : s.status === '部分已付' ? '#f59e0b' : '#6b7280';
      return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-weight:600;font-size:.95rem">¥${total.toLocaleString()}</span>
            <span style="font-size:.72rem;padding:2px 8px;border-radius:10px;background:${statusColor}18;color:${statusColor};border:1px solid ${statusColor}40">${escapeHtml(s.status || '—')}</span>
          </div>
          <div style="display:flex;gap:16px;margin-top:6px;font-size:.78rem;color:var(--text-muted)">
            <span>已付 <b style="color:var(--success)">¥${paid.toLocaleString()}</b></span>
            <span>未付 <b style="color:${unpaid > 0 ? 'var(--warning)' : 'var(--text-muted)'}">¥${unpaid.toLocaleString()}</b></span>
            ${s.account ? `<span>账户：${escapeHtml(s.account)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="sched-linked-tab">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:4px">共 ${items.length} 条结算记录</div>
        <div>${rows}</div>
        <div style="text-align:right;margin-top:14px">
          <button class="btn btn-secondary btn-sm" onclick="ScheduleEditor.close();navigate('settlement')">→ 去结算管理查看详情</button>
        </div>
      </div>`;
  }

  function _newLinked(tabKey) {
    const cfg = TABS.find(t => t.key === tabKey);
    if (!cfg || !state.id) return;
    // 设置全局 pending：modal open 时预填 schedule_id
    window.__pendingScheduleLink = { fieldId: cfg.fieldId, scheduleId: state.id };
    const openFn = window[cfg.openModal];
    if (typeof openFn === 'function') openFn();
    // 监听 modal 关闭刷新 tab（简单粗暴：3 秒后或下次切换时自然刷新）
  }

  function _editLinked(tabKey, itemId) {
    const cfg = TABS.find(t => t.key === tabKey);
    if (!cfg) return;
    const openFn = window[cfg.openModal];
    if (typeof openFn === 'function') openFn(itemId);
  }

  function renderForm() {
    const f = state.form;
    const err = state.errors;
    const dirs = SD.listDirections();
    const dirOptions = ['<option value="">— 请选择 —</option>']
      .concat(dirs.map(d => `<option value="${escapeHtml(d.name)}" ${f.category_direction===d.name?'selected':''}>${escapeHtml(d.name)}</option>`));
    const tiers = SD.listTiers();
    const tierOptions = ['<option value="">— 请选择 —</option>']
      .concat(tiers.map(t => `<option value="${escapeHtml(t.name)}" ${f.tier===t.name?'selected':''}>${escapeHtml(t.name)}</option>`));
    // 如果当前值不在字典里（老数据），保留作为额外选项
    if (f.tier && !tiers.some(t => t.name === f.tier)) {
      tierOptions.push(`<option value="${escapeAttr(f.tier)}" selected>${escapeHtml(f.tier)}（自由值）</option>`);
    }
    const computedStatus = computeStatus(f.schedule_date);
    const statusColor = STATUS_COLORS[computedStatus] || '#6b7280';
    const statusLabel = STATUS_LABELS[computedStatus] || computedStatus;

    return `
      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">日期<span class="req">*</span></label>
          <input type="date" id="f-date" class="sched-form-control ${err.schedule_date?'error':''}"
                 value="${escapeAttr(f.schedule_date)}">
          <div class="sched-form-hint" style="margin-top:4px">
            状态：<span style="padding:1px 8px;border-radius:8px;font-size:.75rem;font-weight:600;background:${statusColor}22;color:${statusColor}">${statusLabel}</span>
          </div>
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">合同基础金额（元）<span class="req">*</span></label>
          <input type="number" min="0" step="0.01" id="f-amount"
                 class="sched-form-control ${err.amount?'error':''}"
                 placeholder="0" value="${escapeAttr(f.amount)}">
        </div>
      </div>
      ${state.mode === 'edit' ? (() => {
        const st = (window.DB?.settlements || []).find(s => s.schedule_id === state.id);
        const baseAmt  = st ? (parseFloat(st.contract_amount) || 0) : (parseFloat(f.amount) || 0);
        const bonusAmt = st?.bonus_enabled ? (parseFloat(st.bonus_amount) || 0) : 0;
        const totalAmt = baseAmt + bonusAmt;

        let bonusHtml;
        if (!st) {
          bonusHtml = '<span style="color:var(--text-muted)">—</span>';
        } else if (st.bonus_enabled && st.bonus_amount) {
          bonusHtml = `<span style="color:#92400e;font-weight:600">+¥${bonusAmt.toLocaleString()}</span>`;
          if (st.bonus_reason) bonusHtml += `<span style="color:var(--text-muted);font-size:.75rem;margin-left:4px">${escapeHtml(st.bonus_reason)}</span>`;
        } else {
          bonusHtml = '<span style="color:var(--text-muted)">无奖金</span>';
        }

        const totalColor = bonusAmt > 0 ? 'var(--primary)' : 'var(--text-secondary)';
        return `<div style="display:flex;align-items:center;gap:16px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px;margin-bottom:10px;font-size:.88rem;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text-muted)">奖金：</span>${bonusHtml}
          </div>
          <div style="width:1px;height:14px;background:var(--border)"></div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text-muted)">总结算金额：</span>
            <span style="font-weight:700;color:${totalColor};font-size:.95rem">¥${totalAmt.toLocaleString()}</span>
            ${!st ? '<span style="color:var(--text-muted);font-size:.72rem">（估算）</span>' : ''}
          </div>
          <span style="color:var(--text-muted);font-size:.72rem;margin-left:auto">由结算模块自动同步</span>
        </div>`;
      })() : ''}

      <div class="sched-form-group">
        <label class="sched-form-label">达人<span class="req">*</span></label>
        ${renderKolSelector()}
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">达人主页链接<span class="req">*</span></label>
        <div style="display:flex;gap:6px;align-items:stretch">
          <input type="url" id="f-kol-homepage"
                 class="sched-form-control ${err.kol_homepage?'error':''}"
                 style="flex:1"
                 placeholder="https://www.douyin.com/user/... 或 https://www.xiaohongshu.com/user/..."
                 value="${escapeAttr(f.kol_homepage)}">
          <button type="button" class="btn btn-secondary btn-sm"
                  style="white-space:nowrap;padding:0 12px"
                  onclick="ScheduleEditor._copyHomepage()"
                  title="复制链接到剪贴板">📋 复制</button>
        </div>
        <div class="sched-form-hint">绑定到达人库后，下次选同一达人会自动带出主页链接</div>
      </div>

      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label" style="display:flex;align-items:center;justify-content:space-between">
            <span>达人类型<span class="req">*</span></span>
            <button type="button" onclick="openKolTypeDict()" style="border:none;background:none;font-size:.78rem;color:var(--primary);cursor:pointer;padding:0">⚙ 管理类型</button>
          </label>
          <select id="f-direction" class="sched-form-control ${err.category_direction?'error':''}">
            ${dirOptions.join('')}
          </select>
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">层级<span class="req">*</span></label>
          <select id="f-tier" class="sched-form-control ${err.tier?'error':''}">
            ${tierOptions.join('')}
          </select>
        </div>
      </div>

      <div class="sched-form-row">
        <div class="sched-form-group" style="flex:1">
          <label class="sched-form-label">发布平台<span class="req">*</span></label>
          <div style="margin-top:4px">
            <div style="font-size:.75rem;color:var(--text-muted);font-weight:500;margin-bottom:5px">主平台（单选）</div>
            <div id="f-main-platform-wrap" class="platform-tags">
              ${SD.listPlatforms().map(p => `
                <label class="platform-tag ${f.platform===p.name?'active':''}">
                  <input type="radio" name="f-main-platform" value="${escapeAttr(p.name)}" ${f.platform===p.name?'checked':''}
                         onchange="ScheduleEditor._setMainPlatform(this.value)">
                  <span>${escapeHtml(p.name)}</span>
                </label>`).join('')}
            </div>
            <div style="font-size:.75rem;color:var(--text-muted);font-weight:500;margin-top:10px;margin-bottom:5px">同步平台（可多选）</div>
            <div id="f-sync-platforms-wrap" class="platform-tags">
              ${SD.listPlatforms().filter(p => p.name !== f.platform).map(p => `
                <label class="platform-tag ${f.sync_platforms.includes(p.name)?'active':''}">
                  <input type="checkbox" value="${escapeAttr(p.name)}" ${f.sync_platforms.includes(p.name)?'checked':''}
                         onchange="ScheduleEditor._toggleSyncPlatform(this.value,this.checked)">
                  <span>${escapeHtml(p.name)}</span>
                </label>`).join('')}
            </div>
          </div>
          ${err.platforms ? `<div style="color:var(--danger);font-size:.8rem;margin-top:4px">${err.platforms}</div>` : ''}
          <div class="sched-form-hint">在「字典管理 → 平台」里增减选项</div>
        </div>
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">商务 BD（负责人）<span class="req">*</span></label>
        ${renderBdSelector(f.bd_id)}
        <div class="sched-form-hint">归属 BD 会在月历卡片显示为左边框色块。在「字典管理 → 商务BD」管理列表与颜色。</div>
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">备注</label>
        <textarea id="f-notes" class="sched-form-control" rows="3"
                  placeholder="内容主题、合作要点等">${escapeHtml(f.notes)}</textarea>
      </div>

      ${renderStatusTimeline()}
    `;
  }

  /* P0b：状态历史时间线（仅编辑模式显示） */
  function renderStatusTimeline() {
    if (state.mode !== 'edit' || !state.id) return '';
    const s = window.DB.schedules.find(x => x.id === state.id);
    const history = (s && s.status_history) || [];
    if (!history.length) return '';
    const STATUS_LABEL = {
      planned: '计划中', contacted: '已联系', confirmed: '已确认',
      published: '已发布', cancelled: '已取消', // legacy labels kept for history display
    };
    const items = history.slice().reverse().map(h => {
      const tsHuman = humanTime(h.at);
      const transition = h.from
        ? `<span style="color:var(--text-muted)">${STATUS_LABEL[h.from]||h.from}</span> → <strong>${STATUS_LABEL[h.to]||h.to}</strong>`
        : `<strong>${STATUS_LABEL[h.to]||h.to}</strong>`;
      return `
        <div class="sched-history-item">
          <div class="sched-history-dot" data-status="${h.to}"></div>
          <div class="sched-history-content">
            <div>${transition}</div>
            <div style="font-size:.72rem;color:var(--text-muted);margin-top:2px">
              ${escapeHtml(h.reason || '—')} · ${escapeHtml(h.by || 'system')} · ${tsHuman}
            </div>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:.85rem;font-weight:500;color:var(--text-secondary);margin-bottom:10px">
          📜 状态历史（${history.length} 条）
        </div>
        <div class="sched-history">${items}</div>
      </div>
    `;
  }

  function humanTime(iso) {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const diff = Date.now() - t;
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    if (sec < 3600) return Math.floor(sec/60) + ' 分钟前';
    if (sec < 86400) return Math.floor(sec/3600) + ' 小时前';
    if (sec < 7*86400) return Math.floor(sec/86400) + ' 天前';
    return iso.slice(0, 16).replace('T', ' ');
  }

  function renderBdSelector(currentId) {
    const bds = SD.listBds();
    const user = window.currentUser;
    // 新增模式下，BD 或主管登录 → 只读显示，不可更改
    if (state.mode === 'create') {
      if (user?.identity === 'bd') {
        const cur = bds.find(b => b.id === currentId);
        return `<div class="sched-form-control" style="background:var(--bg-secondary);display:flex;align-items:center;gap:8px">
          ${cur ? `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${cur.color};flex-shrink:0"></span>` : ''}
          <span style="font-weight:500">${escapeHtml(cur?.name || '-')}</span>
          <span style="margin-left:auto;font-size:.72rem;color:var(--text-muted)">当前账号</span>
        </div>`;
      }
      if (user?.identity === 'supervisor') {
        return `<div class="sched-form-control" style="background:var(--bg-secondary);display:flex;align-items:center;gap:8px">
          <span style="font-weight:500">${escapeHtml(user.name || '主管')}</span>
          <span style="margin-left:auto;font-size:.72rem;color:var(--text-muted)">主管</span>
        </div>`;
      }
    }
    if (!bds.length) {
      return `<div class="sched-form-control" style="background:var(--bg-base);color:var(--text-muted);font-size:.85rem;padding:9px 12px">
        暂无 BD，可在 <a href="javascript:void(0);DictManager.open('bd')" onclick="DictManager.open('bd')" style="color:var(--primary)">字典管理</a> 里添加
      </div>`;
    }
    const opts = ['<option value="">— 未指定 —</option>']
      .concat(bds.map(b => `<option value="${escapeAttr(b.id)}" ${currentId===b.id?'selected':''}>${escapeHtml(b.name)}</option>`));
    const cur = bds.find(b => b.id === currentId);
    const colorPreview = cur
      ? `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${cur.color};vertical-align:middle;margin-right:6px;border:1px solid rgba(0,0,0,.1)"></span>${escapeHtml(cur.name)}`
      : '';
    return `
      <div style="display:flex;gap:8px;align-items:center">
        <select id="f-bd" class="sched-form-control" style="flex:1">${opts.join('')}</select>
        ${cur ? `<span style="display:flex;align-items:center;font-size:.82rem;white-space:nowrap">${colorPreview}</span>` : ''}
      </div>
    `;
  }

  function renderKolSelector() {
    const f = state.form;
    const linkedTag = f.kol_id
      ? `<span class="kol-selector-tag" title="已绑定到达人库">
           🔗 已绑定 <span class="unlink" onclick="ScheduleEditor._unlinkKol()" title="取消绑定">×</span>
         </span>`
      : '';
    return `
      <div class="kol-selector" id="kol-selector">
        <input id="f-kol-input" class="sched-form-control ${state.errors.kol_name?'error':''}"
               placeholder="输入达人名称，自动搜索；找不到可一键新建"
               value="${escapeAttr(f.kol_name)}"
               autocomplete="off">
        ${linkedTag}
      </div>
    `;
  }

  function renderKolItems() {
    const f = state.form;
    const q = f.kol_name.trim();
    if (!q) return '';
    const items = state.kolItems;
    let html = items.map(it => `
      <div class="kol-selector-item" onclick="ScheduleEditor._pickKol('${it.id}')">
        <span class="name">${escapeHtml(it.name)}</span>
        ${it.platform ? `<span class="meta">${escapeHtml(it.platform)}</span>` : ''}
      </div>
    `).join('');
    // 样品管理里的达人昵称候选
    const sampleItems = state.sampleKolItems || [];
    if (sampleItems.length) {
      html += sampleItems.map(name => `
        <div class="kol-selector-item" onclick="ScheduleEditor._pickSampleKol('${escapeAttr(name)}')"
          style="opacity:.85">
          <span class="name">${escapeHtml(name)}</span>
          <span class="meta" style="color:#10b981">样品</span>
        </div>
      `).join('');
    }
    // 若键入名与现有完全相同 → 不显示"新建"
    const allNames = new Set([...items.map(i => i.name), ...sampleItems]);
    if (!allNames.has(q)) {
      html += `<div class="kol-selector-create" onclick="ScheduleEditor._createKol()">
        ＋ 新建「${escapeHtml(q)}」到达人库
      </div>`;
    }
    return html;
  }

  function _pickSampleKol(name) {
    state.form.kol_name = name;
    state.kolOpen = false;
    renderAll();
    setTimeout(() => document.getElementById('f-amount')?.focus(), 0);
  }

  function renderFooter() {
    const isEdit = state.mode === 'edit';
    return `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="ScheduleEditor._deleteThis()">删除</button>` : ''}
      ${isEdit ? `<button class="btn btn-secondary btn-sm" onclick="ScheduleEditor._cloneToNew()" title="保留当前所有字段值，转为新建（日期会改为今天）">📋 复制为新建</button>` : ''}
      <div class="spacer"></div>
      ${!isEdit ? `
        <label class="sched-form-checkbox" title="保存后保留抽屉，清空表单继续添加下一条">
          <input type="checkbox" id="f-continue" ${state.saveAndContinue?'checked':''}> 保存后继续添加
        </label>` : ''}
      <button class="btn btn-secondary btn-sm" onclick="ScheduleEditor.close()">取消</button>
      <button class="btn btn-primary btn-sm" onclick="ScheduleEditor._save()">${isEdit?'保存':'保存'}</button>
    `;
  }

  /* 复制当前编辑中的排期为新建草稿（保留全部字段，仅改日期 + 重置 id） */
  function _cloneToNew() {
    if (state.mode !== 'edit') return;
    state.mode = 'create';
    state.id = null;
    state.errors = {};
    state.saveAndContinue = false;
    // 日期改成今天，避免与原条同 (日期+达人+类型) 触发去重冲突
    state.form = { ...state.form, schedule_date: todayStr() };
    renderAll();
    window.toast && window.toast('已转为新建草稿，可调整后保存', 'info');
    setTimeout(() => document.getElementById('f-date')?.focus(), 0);
  }

  /* ------------------------- 4. 表单 → state 同步 ------------------------- */
  function bindFormHandlers() {
    const f = state.form;
    onInput('f-date', v => f.schedule_date = v);
    onInput('f-amount', v => f.amount = v);
    // platforms 由 _setMainPlatform / _toggleSyncPlatform 处理，无需 onChange
    onInput('f-kol-homepage', v => f.kol_homepage = v);
    if (document.getElementById('f-bd')) onChange('f-bd', v => { f.bd_id = v || null; renderAll(); });
    onChange('f-tier', v => f.tier = v);
    onChange('f-direction', v => f.category_direction = v);
    // 日期变化时重渲染以更新状态徽章
    onInput('f-date', v => { f.schedule_date = v; renderAll(); });
    onInput('f-notes', v => f.notes = v);
    const cont = document.getElementById('f-continue');
    if (cont) cont.addEventListener('change', e => state.saveAndContinue = e.target.checked);

    // KolSelector 特殊处理
    const kolInput = document.getElementById('f-kol-input');
    if (kolInput) {
      kolInput.addEventListener('input', onKolInput);
      kolInput.addEventListener('focus', () => { state.kolOpen = true; refreshKolItems(); });
      kolInput.addEventListener('blur', () => {
        // 延迟 150ms 让点击事件先生效
        setTimeout(() => { state.kolOpen = false; updateKolDropdown(); }, 150);
      });
    }
  }
  function onInput(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', e => fn(e.target.value));
  }
  function onChange(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', e => fn(e.target.value));
  }

  /* ------------------------- 5. KolSelector 交互 ------------------------- */
  function onKolInput(e) {
    const v = e.target.value;
    state.form.kol_name = v;
    // 输入即解除已绑定
    if (state.form.kol_id) {
      state.form.kol_id = null;
      // 重新渲染以移除 "已绑定" 徽章 —— 但避免输入框失焦：只更新 tag DOM
      const tag = document.querySelector('.kol-selector-tag');
      if (tag) tag.remove();
    }
    state.kolOpen = true;
    refreshKolItems();
  }

  function refreshKolItems() {
    clearTimeout(state.kolSearchTimer);
    state.kolSearchTimer = setTimeout(() => {
      const q = state.form.kol_name.trim();
      state.kolItems = q ? SD.searchKols(q, 8) : [];
      // 追加样品管理里的达人昵称（去重、去掉已在 KOL 库里的）
      if (q && window.DB && window.DB.samples) {
        const kolNames = new Set(state.kolItems.map(k => k.name));
        const matched = new Set();
        window.DB.samples.forEach(s => {
          const name = (s.talent || '').trim();
          if (name && name.includes(q) && !kolNames.has(name)) matched.add(name);
        });
        state.sampleKolItems = Array.from(matched).slice(0, 5);
      } else {
        state.sampleKolItems = [];
      }
      updateKolDropdown();
    }, 200);
  }

  function updateKolDropdown() {
    const existing = document.getElementById('kol-dropdown');
    if (existing) existing.remove();
    if (!state.kolOpen) return;
    const container = document.getElementById('kol-selector');
    if (!container) return;
    const html = renderKolItems();
    if (!html) return;
    const d = document.createElement('div');
    d.className = 'kol-selector-dropdown';
    d.id = 'kol-dropdown';
    d.style.cssText = 'position:absolute;top:100%;left:0;width:100%;z-index:9999';
    d.innerHTML = html;
    container.style.position = 'relative';
    container.appendChild(d);
  }

  function _pickKol(id) {
    const k = window.DB.kols.find(x => x.id === id);
    if (!k) return;
    state.form.kol_name = k.name;
    state.form.kol_id = k.id;
    if (k.platform && state.form.platforms.length === 0) {
      state.form.platforms = k.platform.split(',').map(x => x.trim()).filter(Boolean);
    }
    if (k.homepage && !state.form.kol_homepage) state.form.kol_homepage = k.homepage;
    state.kolOpen = false;
    renderAll();
    // 焦点跳到主页链接（若已带出则跳到费用）
    setTimeout(() => {
      const next = state.form.kol_homepage ? 'f-amount' : 'f-kol-homepage';
      document.getElementById(next)?.focus();
    }, 0);
  }

  function _createKol() {
    const q = state.form.kol_name.trim();
    if (!q) return;
    const k = SD.quickCreateKol({
      name: q,
      platform: state.form.platforms[0] || '',
      homepage: state.form.kol_homepage,
    });
    state.form.kol_id = k.id;
    state.form.kol_name = k.name;
    state.kolOpen = false;
    window.toast && window.toast(`已新建「${k.name}」到达人库`, 'success');
    renderAll();
    setTimeout(() => {
      const next = state.form.kol_homepage ? 'f-amount' : 'f-kol-homepage';
      document.getElementById(next)?.focus();
    }, 0);
  }

  function _unlinkKol() {
    state.form.kol_id = null;
    renderAll();
  }

  function _setMainPlatform(name) {
    // 从同步平台移除（避免重复）
    const syncIdx = state.form.sync_platforms.indexOf(name);
    if (syncIdx >= 0) state.form.sync_platforms.splice(syncIdx, 1);
    state.form.platform = name;
    // 主平台样式：直接更新 radio
    const mainWrap = document.getElementById('f-main-platform-wrap');
    if (mainWrap) {
      mainWrap.querySelectorAll('.platform-tag').forEach(label => {
        const rb = label.querySelector('input[type=radio]');
        if (rb) label.classList.toggle('active', rb.checked);
      });
    }
    // 同步平台 wrap 重建（排除刚选的主平台）
    _rebuildSyncWrap();
  }

  function _toggleSyncPlatform(name, checked) {
    const syncs = state.form.sync_platforms;
    if (checked) {
      if (!syncs.includes(name)) syncs.push(name);
    } else {
      const idx = syncs.indexOf(name);
      if (idx >= 0) syncs.splice(idx, 1);
    }
    const wrap = document.getElementById('f-sync-platforms-wrap');
    if (wrap) {
      wrap.querySelectorAll('.platform-tag').forEach(label => {
        const cb = label.querySelector('input[type=checkbox]');
        if (cb) label.classList.toggle('active', cb.checked);
      });
    }
  }

  function _rebuildSyncWrap() {
    const wrap = document.getElementById('f-sync-platforms-wrap');
    if (!wrap) return;
    const f = state.form;
    wrap.innerHTML = SD.listPlatforms()
      .filter(p => p.name !== f.platform)
      .map(p => `
        <label class="platform-tag ${f.sync_platforms.includes(p.name)?'active':''}">
          <input type="checkbox" value="${escapeAttr(p.name)}" ${f.sync_platforms.includes(p.name)?'checked':''}
                 onchange="ScheduleEditor._toggleSyncPlatform(this.value,this.checked)">
          <span>${escapeHtml(p.name)}</span>
        </label>`).join('');
  }

  async function _copyHomepage() {
    const inp = document.getElementById('f-kol-homepage');
    const text = (inp?.value || '').trim();
    if (!text) {
      window.toast && window.toast('主页链接为空，无可复制内容', 'info');
      return;
    }
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        // 降级方案：selection + execCommand
        inp.focus();
        inp.select();
        ok = document.execCommand('copy');
        window.getSelection()?.removeAllRanges();
      }
    } catch (e) {
      ok = false;
    }
    if (ok) window.toast && window.toast('已复制到剪贴板', 'success');
    else window.toast && window.toast('复制失败，请手动选中链接复制', 'error');
  }

  /* ------------------------- 6. 保存 / 删除 ------------------------- */
  function validate() {
    const f = state.form;
    const errs = {};
    if (!f.schedule_date) errs.schedule_date = '日期不能为空';
    if (!f.kol_name || !f.kol_name.trim()) errs.kol_name = '达人名不能为空';
    if (!f.kol_homepage || !f.kol_homepage.trim()) errs.kol_homepage = '达人主页链接不能为空';
    else if (!/^https?:\/\//i.test(f.kol_homepage.trim())) errs.kol_homepage = '主页链接需以 http:// 或 https:// 开头';
    if (!f.category_direction) errs.category_direction = '请选择达人类型';
    if (!f.tier) errs.tier = '请选择层级';
    if (!f.platform) errs.platforms = '请选择主平台';
    if (!f.bd_id) errs.bd_id = '请选择商务 BD';
    if (f.amount === '' || f.amount === null || isNaN(Number(f.amount))) errs.amount = '费用必须为数字';
    else if (Number(f.amount) < 0) errs.amount = '费用不能为负';
    state.errors = errs;
    return Object.keys(errs).length === 0;
  }

  function _syncBdToKol(data) {
    if (!data.kol_id) return;
    const kol = (window.DB.kols || []).find(k => k.id === data.kol_id);
    if (!kol) return;
    const patch = {};
    // BD：空则补齐
    if (data.bd_id && !kol.bd_id) patch.bd_id = data.bd_id;
    // 主要平台：空则取排期第一个平台
    if (!kol.platform) {
      const mainPlat = data.platform || (Array.isArray(data.platforms) && data.platforms[0]) || '';
      if (mainPlat) patch.platform = mainPlat;
    }
    // 达人类型：空则补齐
    if (!kol.category && data.category_direction) patch.category = data.category_direction;
    if (Object.keys(patch).length) SD.updateKol(kol.id, patch);
  }

  function _save(_skipImpact) {
    if (!validate()) {
      renderAll();
      const firstErr = Object.keys(state.errors)[0];
      const msg = state.errors[firstErr];
      window.toast && window.toast(msg, 'error');
      return;
    }
    // 编辑模式 + 日期有变化 → 先弹影响预警
    if (!_skipImpact && state.mode === 'edit') {
      const oldSched = (window.DB.schedules||[]).find(x => x.id === state.id);
      if (oldSched && oldSched.schedule_date !== state.form.schedule_date) {
        if (typeof window._schedImpactWarning === 'function') {
          window._schedImpactWarning(state.id, 'move', {
            title: '确认修改发布日期',
            subtitle: `${oldSched.kol_name || '—'} · ${oldSched.schedule_date} → ${state.form.schedule_date}`,
            newDate: state.form.schedule_date,
          }, () => _save(true));
          return;
        }
      }
    }
    const f = state.form;
    // 自动入达人库：用户填了达人名但没点过「新建」（kol_id 仍为空）
    // 调 quickCreateKol（upsert 语义：同名同平台返回已有，不重复建）
    let autoCreatedKol = null;
    if (!f.kol_id && f.kol_name && f.kol_name.trim()) {
      try {
        const k = SD.quickCreateKol({
          name: f.kol_name.trim(),
          platform: f.platform || '',
          homepage: (f.kol_homepage || '').trim(),
        });
        f.kol_id = k.id;
        // 标记是否本次"真创建"了（同名同平台已存在则只返回 existing）
        const isExisting = (window.DB.kols || []).filter(x => x.id === k.id).length > 0
          && k.created_at && (Date.now() - new Date(k.created_at).getTime() > 5000);
        autoCreatedKol = isExisting ? null : k;
      } catch (e) {
        // 创建失败不阻塞排期保存（如名字为空等极端情况）
        console.warn('auto createKol failed', e);
      }
    }
    const data = {
      schedule_date: f.schedule_date,
      kol_name: f.kol_name.trim(),
      kol_id: f.kol_id,
      kol_homepage: f.kol_homepage.trim(),
      bd_id: f.bd_id || null,
      category_direction: f.category_direction || '',
      tier: f.tier || '',
      platform: f.platform || '',
      sync_platforms: f.sync_platforms || [],
      platforms: f.platform ? [f.platform, ...(f.sync_platforms || [])] : [],
      amount: Number(f.amount),
      status: computeStatus(f.schedule_date),
      publish_url: f.publish_url || '',
      publish_date: f.publish_date || null,
      notes: f.notes || '',
    };
    try {
      if (state.mode === 'edit') {
        const todayLocal = todayStr();
        const oldSched = (window.DB.schedules || []).find(x => x.id === state.id);
        const oldDate = oldSched ? oldSched.schedule_date : null;
        const dateChanged = oldDate && oldDate !== data.schedule_date;
        let toastMsg = '已更新';

        // 日期变化时：同步处理关联内容发布记录
        if (dateChanged) {
          // status 已由 computeStatus 按新日期自动算好，这里只处理关联内容记录
          const relatedAutoContents = (window.DB.contents || []).filter(
            c => c.schedule_id === state.id && c.auto_created
          );
          if (data.schedule_date >= todayLocal) {
            // 新日期是今天或以后：删除自动生成的占位记录
            toastMsg = '已改期，状态已重置为「计划中」';
            relatedAutoContents.forEach(c => {
              try { SD.deleteContent(c.id); } catch(e) {}
            });
          } else {
            // 新日期是过去：同步内容记录的发布日期
            toastMsg = '已改期，内容发布日期已同步更新';
            relatedAutoContents.forEach(c => {
              const newPubs = (c.publications || []).map(p =>
                p.date === oldDate ? { ...p, date: data.schedule_date } : p
              );
              try { SD.updateContent(c.id, { publications: newPubs }); } catch(e) {}
            });
          }
        }

        SD.updateSchedule(state.id, data);

        // 新日期是过去但没有任何内容记录 → 补建一条空记录
        if (dateChanged && data.schedule_date < todayLocal) {
          const hasContent = (window.DB.contents || []).some(c => c.schedule_id === state.id);
          if (!hasContent) {
            try {
              const sched = (window.DB.schedules || []).find(x => x.id === state.id);
              const plats = sched && Array.isArray(sched.platforms) && sched.platforms.length
                ? sched.platforms : (sched && sched.platform ? [sched.platform] : ['']);
              SD.createContent({
                schedule_id: state.id, fans: null,
                publications: plats.map(p => ({ platform: p, date: data.schedule_date, link: '' })),
              });
            } catch(e) { console.warn('[Editor] 补建内容记录失败', e); }
          }
        }

        _syncBdToKol(data);
        window.toast && window.toast(toastMsg, 'success');
        afterSave();
      } else {
        SD.createSchedule(data);
        _syncBdToKol(data);
        const msg = autoCreatedKol
          ? `已新增（顺手把「${autoCreatedKol.name}」存到了达人库）`
          : '已新增';
        window.toast && window.toast(msg, 'success');
        if (state.saveAndContinue) {
          // 保留抽屉，清空 form，但保留 schedule_date / status 等高频字段
          const keepDate = f.schedule_date;
          state.form = defaultForm(keepDate);
          state.errors = {};
          state.kolItems = [];
          state.kolOpen = false;
          renderAll();
          refreshExternalViews();
          setTimeout(() => document.getElementById('f-kol-input')?.focus(), 50);
          return;
        }
        afterSave();
      }
    } catch (e) {
      window.toast && window.toast('保存失败：' + e.message, 'error');
    }
  }

  function _deleteThis() {
    if (!state.id) return;
    const doDelete = () => {
      try {
        SD.deleteSchedule(state.id);
        window.toast && window.toast('已删除', 'success');
        afterSave();
      } catch (e) {
        window.toast && window.toast('删除失败：' + e.message, 'error');
      }
    };
    if (typeof window._schedImpactWarning === 'function') {
      window._schedImpactWarning(state.id, 'delete', { title: '确认删除排期' }, doDelete);
    } else {
      if (!confirm('确认删除此条排期？此操作不可撤销。')) return;
      doDelete();
    }
  }

  function afterSave() {
    close();
    refreshExternalViews();
  }

  function refreshExternalViews() {
    if (window.SchedulePage && typeof window.SchedulePage.render === 'function') {
      window.SchedulePage.render();
    }
    // 若月度规划页已挂载过则同步刷新（实际花费 / 数量随之更新）
    if (window.MonthlyPlanPage && document.getElementById('sched-budget-host')) {
      window.MonthlyPlanPage.render();
    }
  }

  /* ------------------------- 7. 转义 ------------------------- */
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  /* ------------------------- 8. 暴露 ------------------------- */
  window.ScheduleEditor = {
    open, close,
    _save, _deleteThis, _cloneToNew,
    _pickKol, _pickSampleKol, _createKol, _unlinkKol, _copyHomepage,
    _setMainPlatform, _toggleSyncPlatform, _rebuildSyncWrap,
    _switchTab, _newLinked, _editLinked,
    refreshActiveTab() { if (state.id && state.activeTab !== 'basic') renderAll(); },
    refreshForm() { if (state.open) renderAll(); },
  };
  // 覆盖 calendar.js 里的 stub
  window.openScheduleEditor = (id, prefillDate) => open(id, prefillDate);

  console.log('[ScheduleEditor] 已就绪');
})();
