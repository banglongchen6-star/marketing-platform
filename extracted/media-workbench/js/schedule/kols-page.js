/* =====================================================================
 * 达人营销 · 达人库页面
 *
 * 暴露：window.KolsPage = { render, openEditor(id?) }
 *
 * 列表 + 搜索 + 平台筛选 + 新增/编辑/删除抽屉 + 合作统计
 * 关联数据：每个达人的合作次数、累计金额、最近合作日期（来自 schedules）
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[KolsPage] ScheduleData 未就绪'); return; }

  const state = {
    tab: 'candidates', // 'candidates' | 'collaborated'
    q: '',
    platform: '',
    bd_id: '',
    sort: 'created_desc',
    editor: { open: false, mode: 'create', id: null, form: defaultForm(), errors: {} },
    editingCell: null,
  };

  function defaultForm() {
    const u = window.currentUser;
    const autoBdId = (u?.identity === 'bd' || u?.identity === 'supervisor') ? (u.bd_id || '') : '';
    return { name: '', platform: '', homepage: '', followers: '', category: '', notes: '', bd_id: autoBdId };
  }

  /* ------------------------- 已合作达人数据（来自已结算） ------------------------- */
  function getCollaboratedKols() {
    const settled = (window.DB.settlements || []).filter(s => s.settled);
    const kolMap = {};
    settled.forEach(st => {
      const sched = (window.DB.schedules || []).find(s => s.id === st.schedule_id && !s.deleted_at);
      if (!sched) return;
      const key = sched.kol_id || ('n:' + (sched.kol_name || ''));
      if (!kolMap[key]) {
        kolMap[key] = {
          kol_id: sched.kol_id || null,
          name: sched.kol_name || '—',
          platforms: [],
          bd_id: sched.bd_id || null,
          totalAmount: 0,
          count: 0,
          lastDate: '',
        };
      }
      const entry = kolMap[key];
      entry.totalAmount += Number(st.amount) || 0;
      entry.count++;
      const plats = Array.isArray(sched.platforms) ? sched.platforms : (sched.platform ? [sched.platform] : []);
      plats.forEach(p => { if (!entry.platforms.includes(p)) entry.platforms.push(p); });
      if (!entry.lastDate || (sched.schedule_date && sched.schedule_date > entry.lastDate)) {
        entry.lastDate = sched.schedule_date || '';
      }
    });
    return Object.values(kolMap);
  }

  /* ------------------------- 渲染 ------------------------- */
  function render() {
    const page = document.getElementById('page-kols');
    if (!page) return;
    page.innerHTML = `
      ${renderTabBar()}
      ${renderToolbar()}
      ${renderList()}
    `;
    bindToolbar();
  }

  function renderTabBar() {
    const collaboratedCount = getCollaboratedKols().length;
    const candidateCount = SD.listKols().filter(k => {
      const col = getCollaboratedKols();
      const colIds = new Set(col.map(c => c.kol_id).filter(Boolean));
      const colNames = new Set(col.map(c => c.name));
      return !(k.id && colIds.has(k.id)) && !colNames.has(k.name);
    }).length;
    return `
      <div class="sched-tab-bar" style="margin:0 0 14px;background:var(--bg-panel);border-radius:var(--radius);padding:0 8px;box-shadow:var(--shadow);border-bottom:none">
        <button class="sched-tab ${state.tab==='candidates'?'active':''}" onclick="KolsPage._switchTab('candidates')">
          候选达人 <span class="sched-tab-badge">${candidateCount}</span>
        </button>
        <button class="sched-tab ${state.tab==='collaborated'?'active':''}" onclick="KolsPage._switchTab('collaborated')">
          已合作达人库 <span class="sched-tab-badge">${collaboratedCount}</span>
        </button>
      </div>
    `;
  }

  function _switchTab(tab) {
    state.tab = tab;
    render();
  }

  function renderToolbar() {
    const platforms = SD.listPlatforms();
    const platOpts = ['<option value="">全部平台</option>']
      .concat(platforms.map(p => `<option value="${escapeAttr(p.name)}" ${state.platform===p.name?'selected':''}>${escapeHtml(p.name)}</option>`));
    // 工具栏分两段，按钮组用 flex-shrink:0 + nowrap 保证不分散
    return `
      <div class="filter-bar">
        <input id="__kols-search__" class="search-input"
               placeholder="🔍 搜达人名 / 主页 / 备注 / 达人类型" value="${escapeAttr(state.q)}">
        <select id="__kols-platform__" class="filter-select">
          ${platOpts.join('')}
        </select>
        <select id="__kols-bd__" class="filter-select">
          <option value="">全部 BD</option>
          ${SD.listBds().map(b => `<option value="${escapeAttr(b.id)}" ${state.bd_id===b.id?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}
        </select>
        <select id="__kols-sort__" class="filter-select">
          <option value="created_desc" ${state.sort==='created_desc'?'selected':''}>最近添加</option>
          <option value="created_asc"  ${state.sort==='created_asc' ?'selected':''}>最早添加</option>
          <option value="name"          ${state.sort==='name'         ?'selected':''}>按名称排序</option>
        </select>
        <span style="color:var(--text-muted);font-size:.82rem;white-space:nowrap">
          共 <b>${SD.listKols().length}</b> 位达人
        </span>
        <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0;flex-wrap:nowrap">
          ${state.tab === 'candidates' ? `
            <button id="__kols-refresh-btn__" class="btn btn-secondary btn-sm" onclick="KolsPage.refreshAllFollowers()">🔄 刷新粉丝量</button>
            <button class="btn btn-secondary btn-sm" onclick="KolsImportExport.openImport()">📥 导入</button>
            <button class="btn btn-secondary btn-sm" onclick="KolsImportExport.doExport()">📤 导出</button>
            <button class="btn btn-primary btn-sm" onclick="KolsPage.openEditor()">＋ 新增达人</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function bindToolbar() {
    const s = document.getElementById('__kols-search__');
    if (s) {
      let t;
      s.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { state.q = e.target.value; paintList(); }, 200);
      });
    }
    const p = document.getElementById('__kols-platform__');
    if (p) p.addEventListener('change', e => { state.platform = e.target.value; paintList(); });
    const bd = document.getElementById('__kols-bd__');
    if (bd) bd.addEventListener('change', e => { state.bd_id = e.target.value; paintList(); });
    const so = document.getElementById('__kols-sort__');
    if (so) so.addEventListener('change', e => { state.sort = e.target.value; paintList(); });
  }

  function paintList() {
    const host = document.getElementById('__kols-list-host__');
    if (host) host.outerHTML = renderList();
  }

  function renderList() {
    if (state.tab === 'collaborated') return renderCollaboratedList();

    // 候选达人：DB.kols 中排除已合作的
    const collaborated = getCollaboratedKols();
    const colIds = new Set(collaborated.map(c => c.kol_id).filter(Boolean));
    const colNames = new Set(collaborated.map(c => c.name));
    let items = SD.listKols({ q: state.q, platform: state.platform, bd_id: state.bd_id || undefined, sort: state.sort });
    items = items.filter(k => !(k.id && colIds.has(k.id)) && !colNames.has(k.name));

    if (!items.length) {
      return `<div id="__kols-list-host__" class="sched-empty" style="background:var(--bg-panel);border-radius:var(--radius);padding:60px 16px">
        <div style="font-size:2rem;margin-bottom:8px">📚</div>
        <div>候选达人库还是空的</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:8px">点击「＋ 新增达人」添加，或在排期编辑器里搜索时一键创建。</div>
      </div>`;
    }
    const rows = items.map(renderRow).join('');
    return `
      <div id="__kols-list-host__" style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto;max-height:calc(100vh - 185px)">
        <table class="sched-budget-table">
          <thead>
            <tr>
              <th style="width:14%">达人昵称</th>
              <th style="width:10%">达人类型</th>
              <th style="width:9%">BD</th>
              <th style="width:9%">平台</th>
              <th style="width:12%">主页</th>
              <th style="width:8%">粉丝量</th>
              <th style="width:9%">合作次数</th>
              <th style="width:10%">累计金额</th>
              <th style="width:10%">最近合作</th>
              <th style="width:13%">备注</th>
              <th style="width:4%"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderCollaboratedList() {
    let items = getCollaboratedKols();
    // 搜索过滤
    if (state.q) {
      const lo = state.q.toLowerCase();
      items = items.filter(k => (k.name || '').toLowerCase().includes(lo) || (k.category || '').toLowerCase().includes(lo));
    }
    if (!items.length) {
      return `<div id="__kols-list-host__" class="sched-empty" style="background:var(--bg-panel);border-radius:var(--radius);padding:60px 16px">
        <div style="font-size:2rem;margin-bottom:8px">🤝</div>
        <div>暂无已合作达人</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:8px">完成结算后达人会自动出现在这里。</div>
      </div>`;
    }
    // 按最近合作日期降序
    items.sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    const rows = items.map(k => {
      const bd = k.bd_id ? SD.findBdPersonById(k.bd_id) : null;
      const bdCell = bd
        ? `<span class="sched-card-chip" style="background:${bd.color}20;color:${bd.color};font-weight:500">${escapeHtml(bd.name)}</span>`
        : '<span style="color:var(--text-muted)">—</span>';
      const platCell = k.platforms.length
        ? k.platforms.map(p => `<span class="sched-card-chip platform">${escapeHtml(p)}</span>`).join(' ')
        : '—';
      // 查 KOL 库里有无对应记录（用于显示粉丝量/备注）
      const kolRecord = k.kol_id ? (window.DB.kols || []).find(r => r.id === k.kol_id) : null;
      const rowBorder = bd ? bd.color : '#e5e7eb';
      return `
        <tr style="border-left:3px solid ${rowBorder}">
          <td style="padding:10px 12px"><strong>${escapeHtml(k.name)}</strong></td>
          <td style="padding:10px 12px">${bdCell}</td>
          <td style="padding:10px 12px">${platCell}</td>
          <td style="padding:10px 12px">${kolRecord?.followers != null ? formatFollowers(kolRecord.followers) : '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="padding:10px 12px"><b style="color:var(--primary)">${k.count}</b> 次</td>
          <td style="padding:10px 12px">¥${k.totalAmount.toLocaleString()}</td>
          <td style="padding:10px 12px"><span style="font-size:.78rem">${k.lastDate || '—'}</span></td>
          <td style="padding:10px 12px"><span style="font-size:.78rem;color:var(--text-secondary)">${escapeHtml((kolRecord?.notes||'').slice(0,30))}</span></td>
        </tr>`;
    }).join('');
    return `
      <div id="__kols-list-host__" style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto;max-height:calc(100vh - 185px)">
        <table class="sched-budget-table">
          <thead>
            <tr>
              <th style="width:16%">达人昵称</th>
              <th style="width:10%">BD</th>
              <th style="width:14%">平台</th>
              <th style="width:8%">粉丝量</th>
              <th style="width:9%">合作次数</th>
              <th style="width:12%">累计结算金额</th>
              <th style="width:10%">最近合作</th>
              <th style="width:21%">备注</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderRow(k) {
    const stats = SD.getKolStats(k.id);
    const homepage = k.homepage
      ? `<a href="${escapeAttr(k.homepage)}" target="_blank" rel="noopener noreferrer"
            style="color:var(--primary);text-decoration:none;font-size:.78rem"
            onclick="event.stopPropagation()">🔗 打开</a>`
      : '<span style="color:var(--text-muted);font-size:.78rem">—</span>';
    const lastDate = stats.lastDate || '<span style="color:var(--text-muted)">—</span>';
    const bd = k.bd_id ? SD.findBdPersonById(k.bd_id) : null;
    const bdCell = bd
      ? `<span class="sched-card-chip" style="background:${bd.color}20;color:${bd.color};font-weight:500" title="BD：${escapeHtml(bd.name)}">${escapeHtml(bd.name)}</span>`
      : '<span style="color:var(--text-muted)">—</span>';
    const borderColor = bd ? bd.color : '#e5e7eb';
    return `
      <tr style="cursor:pointer;border-left:3px solid ${borderColor}" onclick="KolsPage.openEditor('${k.id}')">
        <td style="padding-left:12px"><strong>${escapeHtml(k.name)}</strong></td>
        <td>${k.category ? `<span style="font-size:.78rem;padding:2px 8px;border-radius:10px;background:var(--primary-light);color:var(--primary)">${escapeHtml(k.category)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td>${bdCell}</td>
        <td>${k.platform ? `<span class="sched-card-chip platform">${escapeHtml(k.platform)}</span>` : '—'}</td>
        <td>${homepage}</td>
        <td onclick="event.stopPropagation()" style="padding:0">${renderFollowersCell(k)}</td>
        <td>${stats.count > 0 ? `<b style="color:var(--primary)">${stats.count}</b> 次` : '<span style="color:var(--text-muted)">0</span>'}</td>
        <td>${stats.totalAmount > 0 ? `¥${stats.totalAmount.toLocaleString()}` : '<span style="color:var(--text-muted)">¥0</span>'}</td>
        <td><span style="font-size:.78rem">${lastDate}</span></td>
        <td><span style="font-size:.78rem;color:var(--text-secondary)">${escapeHtml((k.notes||'').slice(0,30))}</span></td>
        <td><button class="sched-budget-del" title="删除" onclick="event.stopPropagation();KolsPage._delete('${k.id}')">🗑</button></td>
      </tr>
    `;
  }

  /** 粉丝量内联编辑单元格 */
  function renderFollowersCell(k) {
    const isEditing = state.editingCell && state.editingCell.id === k.id && state.editingCell.field === 'followers';
    if (isEditing) {
      // 编辑态：input，支持 "38万" / "380000" / "38.0万"
      const raw = k.followers != null
        ? (k.followers >= 10000 ? (k.followers/10000) + '万' : String(k.followers))
        : '';
      return `<input class="sched-budget-cell-input" type="text"
                value="${escapeAttr(raw)}"
                placeholder="如 38万 / 380000"
                onclick="event.stopPropagation()"
                onblur="KolsPage._saveFollowers(this, '${k.id}')"
                onkeydown="KolsPage._followersKey(event, this, '${k.id}')"
                autofocus>`;
    }
    const display = k.followers != null ? formatFollowers(k.followers) : '—';
    const cls = k.followers != null ? 'sched-budget-cell editable' : 'sched-budget-cell editable muted';
    return `<button class="${cls}"
              onclick="event.stopPropagation();KolsPage._editFollowers('${k.id}')"
              title="点击编辑粉丝量">${escapeHtml(display)}</button>`;
  }

  function _editFollowers(id) {
    state.editingCell = { id, field: 'followers' };
    paintList();
    requestAnimationFrame(() => {
      const inp = document.querySelector('.sched-budget-cell-input');
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  function _followersKey(ev, el, id) {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Escape') { state.editingCell = null; paintList(); }
  }

  function _saveFollowers(input, id) {
    if (!state.editingCell || state.editingCell.id !== id) return;
    state.editingCell = null;
    const raw = String(input.value || '').trim();
    let newVal;
    if (raw === '') {
      newVal = null;
    } else {
      // 支持 "38万" / "38.0万" / "380000" / "380,000" / "38,000"
      const s = raw.replace(/[,，\s]/g, '');
      const wanMatch = s.match(/^([\d.]+)\s*万$/);
      if (wanMatch) {
        newVal = Math.round(Number(wanMatch[1]) * 10000);
      } else {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) {
          window.toast && window.toast(`粉丝量「${raw}」格式不识别`, 'error');
          paintList();
          return;
        }
        newVal = n;
      }
    }
    try {
      SD.updateKol(id, { followers: newVal });
      window.toast && window.toast('已更新', 'success');
      paintList();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
      paintList();
    }
  }

  /** 解析粉丝量输入：返回 {ok, value} */
  function parseFollowersInput(raw) {
    if (raw === '' || raw == null) return { ok: true, value: null };
    const s = String(raw).replace(/[,，\s]/g, '').trim();
    if (!s) return { ok: true, value: null };
    const wanMatch = s.match(/^([\d.]+)\s*万$/);
    if (wanMatch) {
      const n = Math.round(Number(wanMatch[1]) * 10000);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `「${raw}」无效` };
      return { ok: true, value: n };
    }
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `「${raw}」格式不识别` };
    return { ok: true, value: n };
  }

  /** 实时回显：键入 "38万" 时下方提示"≈ 380,000" */
  function formatFollowersHint(raw) {
    const r = parseFollowersInput(raw);
    if (!r.ok) return `<span style="color:var(--danger)">${r.error}</span>`;
    if (r.value == null) return '';
    if (r.value >= 10000) return `≈ ${r.value.toLocaleString()}（${(r.value/10000).toFixed(1)} 万）`;
    return `${r.value.toLocaleString()}`;
  }

  function formatFollowers(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    if (n >= 10000) return (n/10000).toFixed(1) + '万';
    return n.toLocaleString();
  }

  /* ------------------------- 编辑器抽屉 ------------------------- */
  function openEditor(id) {
    ensureEditorNode();
    state.editor.errors = {};
    if (id) {
      const k = window.DB.kols.find(x => x.id === id);
      if (!k) { window.toast && window.toast('达人不存在', 'error'); return; }
      state.editor.mode = 'edit';
      state.editor.id = id;
      state.editor.form = {
        name: k.name || '',
        platform: k.platform || '',
        homepage: k.homepage || '',
        followers: k.followers != null ? String(k.followers) : '',
        category: k.category || '',
        notes: k.notes || '',
        bd_id: k.bd_id || '',
      };
    } else {
      state.editor.mode = 'create';
      state.editor.id = null;
      state.editor.form = defaultForm();
    }
    state.editor.open = true;
    paintEditor();
    requestAnimationFrame(() => {
      document.getElementById('kols-drawer').classList.add('open');
      document.getElementById('kols-drawer-overlay').classList.add('open');
      document.getElementById('kf-name')?.focus();
    });
  }

  function closeEditor() {
    state.editor.open = false;
    const d = document.getElementById('kols-drawer');
    const o = document.getElementById('kols-drawer-overlay');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
  }

  function ensureEditorNode() {
    if (document.getElementById('kols-drawer')) return;
    const overlay = document.createElement('div');
    overlay.id = 'kols-drawer-overlay';
    overlay.className = 'sched-drawer-overlay';
    overlay.addEventListener('click', closeEditor);
    document.body.appendChild(overlay);
    const drawer = document.createElement('div');
    drawer.id = 'kols-drawer';
    drawer.className = 'sched-drawer';
    drawer.innerHTML = `
      <div class="sched-drawer-header">
        <div class="sched-drawer-title" id="kols-drawer-title">新增达人</div>
        <button class="sched-drawer-close" onclick="KolsPage._closeEditor()">×</button>
      </div>
      <div class="sched-drawer-body" id="kols-drawer-body"></div>
      <div class="sched-drawer-footer" id="kols-drawer-footer"></div>
    `;
    document.body.appendChild(drawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.editor.open) closeEditor();
    });
  }

  function paintEditor() {
    document.getElementById('kols-drawer-title').textContent =
      state.editor.mode === 'edit' ? '编辑达人' : '新增达人';
    document.getElementById('kols-drawer-body').innerHTML = renderEditorForm();
    document.getElementById('kols-drawer-footer').innerHTML = renderEditorFooter();
    bindEditorForm();
  }

  function renderEditorForm() {
    const f = state.editor.form;
    const err = state.editor.errors;
    const platforms = SD.listPlatforms();
    const platOpts = ['<option value="">— 不选 —</option>']
      .concat(platforms.map(p => `<option value="${escapeAttr(p.name)}" ${f.platform===p.name?'selected':''}>${escapeHtml(p.name)}</option>`));
    if (f.platform && !platforms.some(p => p.name === f.platform)) {
      platOpts.push(`<option value="${escapeAttr(f.platform)}" selected>${escapeHtml(f.platform)}（自由值）</option>`);
    }
    const dirs = SD.listDirections();
    const dirOpts = ['<option value="">— 不选 —</option>']
      .concat(dirs.map(d => `<option value="${escapeAttr(d.name)}" ${f.category===d.name?'selected':''}>${escapeHtml(d.name)}</option>`));
    const id = state.editor.id;
    const stats = id ? SD.getKolStats(id) : null;
    const linkedScheduleCount = id
      ? window.DB.schedules.filter(s => !s.deleted_at && s.kol_id === id).length
      : 0;

    return `
      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">达人名<span class="req">*</span></label>
          <input id="kf-name" class="sched-form-control ${err.name?'error':''}"
                 placeholder="如：万万也没想到" value="${escapeAttr(f.name)}">
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">主要平台</label>
          <select id="kf-platform" class="sched-form-control">
            ${platOpts.join('')}
          </select>
        </div>
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">主页链接</label>
        <div style="display:flex;gap:6px">
          <input type="url" id="kf-homepage" class="sched-form-control" style="flex:1"
                 placeholder="https://..." value="${escapeAttr(f.homepage)}">
          ${f.homepage ? `<button type="button" class="btn btn-secondary btn-sm" style="white-space:nowrap;padding:0 12px" onclick="window.open('${escapeAttr(f.homepage)}','_blank','noopener noreferrer')">🔗 访问</button>` : ''}
        </div>
      </div>

      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">粉丝量</label>
          <input type="text" id="kf-followers" class="sched-form-control"
                 placeholder="如 38万 / 380000 / 38.5万"
                 value="${escapeAttr(f.followers)}">
          <div class="sched-form-hint">${formatFollowersHint(f.followers)}</div>
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label" style="display:flex;align-items:center;justify-content:space-between">
            <span>达人类型</span>
            <button type="button" onclick="openKolTypeDict()" style="border:none;background:none;font-size:.78rem;color:var(--primary);cursor:pointer;padding:0">⚙ 管理类型</button>
          </label>
          <select id="kf-category" class="sched-form-control">
            ${dirOpts.join('')}
          </select>
        </div>
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">商务 BD（负责人）</label>
        ${(() => {
          const u = window.currentUser;
          const personnel = SD.listBdPersonnel();
          const opts = `<option value="">— 未指定 —</option>` +
            personnel.map(b => `<option value="${escapeAttr(b.id)}" ${f.bd_id===b.id?'selected':''}>${escapeHtml(b.name)}${b._kind==='supervisor'?' (主管)':''}</option>`).join('');
          if ((u?.identity === 'bd' || u?.identity === 'supervisor') && f.bd_id) {
            const cur = personnel.find(b => b.id === f.bd_id);
            return `<div class="sched-form-control" style="background:var(--bg-secondary);display:flex;align-items:center;gap:8px">
              ${cur?.color ? `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${cur.color};flex-shrink:0"></span>` : ''}
              <span style="font-weight:500">${escapeHtml(cur?.name||'-')}</span>
              <span style="margin-left:auto;font-size:.72rem;color:var(--text-muted)">当前账号</span>
            </div>`;
          }
          return `<select id="kf-bd" class="sched-form-control">${opts}</select>`;
        })()}
      </div>

      <div class="sched-form-group">
        <label class="sched-form-label">备注</label>
        <textarea id="kf-notes" class="sched-form-control" rows="3"
                  placeholder="联系人 / 报价 / 合作历史等">${escapeHtml(f.notes)}</textarea>
      </div>

      ${stats && (stats.count || linkedScheduleCount) ? `
        <div style="background:var(--primary-light);padding:10px 14px;border-radius:var(--radius-sm);font-size:.82rem;margin-top:14px">
          <strong style="color:var(--primary)">📊 合作记录</strong>
          <div style="margin-top:4px;color:var(--text-secondary)">
            非取消合作：<b>${stats.count}</b> 次 · 累计 <b>¥${stats.totalAmount.toLocaleString()}</b>
            ${stats.firstDate ? ` · 首次 ${stats.firstDate}` : ''}
            ${stats.lastDate && stats.lastDate !== stats.firstDate ? ` · 最近 ${stats.lastDate}` : ''}
          </div>
        </div>
      ` : ''}
    `;
  }

  function bindEditorForm() {
    const f = state.editor.form;
    on('kf-name', 'input', v => f.name = v);
    on('kf-platform', 'change', v => f.platform = v);
    on('kf-homepage', 'input', v => f.homepage = v);
    on('kf-followers', 'input', v => {
      f.followers = v;
      // 不重渲染整个抽屉（保持光标），只更新下方 hint
      const hint = document.querySelector('#kf-followers + .sched-form-hint');
      if (hint) hint.innerHTML = formatFollowersHint(v);
    });
    on('kf-category', 'change', v => f.category = v);
    on('kf-bd', 'change', v => f.bd_id = v);
    on('kf-notes', 'input', v => f.notes = v);
  }
  function on(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, e => fn(e.target.value));
  }

  function renderEditorFooter() {
    const isEdit = state.editor.mode === 'edit';
    return `
      ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="KolsPage._delete('${state.editor.id}')">删除</button>` : ''}
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-secondary btn-sm" onclick="KolsPage._closeEditor()">取消</button>
      <button class="btn btn-primary btn-sm" onclick="KolsPage._save()">保存</button>
    `;
  }

  function _save() {
    const f = state.editor.form;
    const errs = {};
    if (!f.name || !f.name.trim()) errs.name = '达人名不能为空';
    if (f.homepage && !/^https?:\/\//i.test(f.homepage.trim())) errs.homepage = '主页链接需以 http(s):// 开头';
    const followersResult = parseFollowersInput(f.followers);
    if (!followersResult.ok) errs.followers = '粉丝量' + followersResult.error;
    state.editor.errors = errs;
    if (Object.keys(errs).length) {
      paintEditor();
      window.toast && window.toast(Object.values(errs)[0], 'error');
      return;
    }
    try {
      const followersValue = followersResult.value;
      const bd_id = f.bd_id || null;
      if (state.editor.mode === 'edit') {
        SD.updateKol(state.editor.id, {
          name: f.name.trim(),
          platform: f.platform,
          homepage: f.homepage.trim(),
          followers: followersValue,
          category: f.category,
          notes: f.notes,
          bd_id,
        });
        window.toast && window.toast('已更新', 'success');
      } else {
        SD.createKol({
          name: f.name.trim(),
          platform: f.platform,
          homepage: f.homepage.trim(),
          followers: followersValue,
          category: f.category,
          notes: f.notes,
          bd_id,
        });
        window.toast && window.toast('已新增', 'success');
      }
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  function _delete(id) {
    const k = window.DB.kols.find(x => x.id === id);
    if (!k) return;
    const stats = SD.getKolStats(id);
    const linked = window.DB.schedules.filter(s => !s.deleted_at && s.kol_id === id).length;
    let msg = `删除达人「${k.name}」？\n`;
    if (linked) msg += `\n该达人当前关联 ${linked} 条排期；删除后排期会保留但解绑（kol_id 设为空）。`;
    if (!confirm(msg)) return;
    try {
      const r = SD.deleteKol(id);
      window.toast && window.toast(`已删除${r.unlinked?`（${r.unlinked} 条排期解绑）`:''}`, 'success');
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  /* ------------------------- 粉丝量自动抓取 ------------------------- */

  /**
   * 根据主页链接和平台抓取粉丝量（当前为 stub，部署服务器后替换为真实 API）
   * @param {string} homepage  达人主页链接
   * @param {string} platform  平台名
   * @returns {Promise<number|null>}
   */
  async function fetchKolFollowers(homepage, platform) {
    // TODO: 上线后按平台接入真实 API
    // B站   → 从 URL 提取 UID，调用 https://api.bilibili.com/x/space/acc/info?mid=UID
    // 抖音  → 服务器端 Puppeteer 无头浏览器抓取 or 第三方数据服务
    // 小红书 → 同上
    // 快手  → 同上
    // 视频号 → 暂不支持
    console.log(`[KolsPage] fetchKolFollowers stub: ${platform} ${homepage}`);
    return null; // stub
  }

  /**
   * 一键刷新所有有主页链接的达人粉丝量
   * 按钮触发 → 显示 loading → 逐个抓取 → 写回 → 刷新列表
   */
  async function refreshAllFollowers() {
    const btn = document.getElementById('__kols-refresh-btn__');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 抓取中…'; }

    const kols = SD.listKols({ includeInactive: false });
    const targets = kols.filter(k => k.homepage);
    let updated = 0;

    for (const k of targets) {
      try {
        const followers = await fetchKolFollowers(k.homepage, k.platform || '');
        if (followers != null && Number.isFinite(followers)) {
          SD.updateKol(k.id, { followers, followers_updated_at: new Date().toISOString() });
          updated++;
        }
      } catch(e) {
        console.warn('[KolsPage] 抓取失败', k.name, e);
      }
    }

    if (btn) { btn.disabled = false; btn.textContent = '🔄 刷新粉丝量'; }

    if (updated > 0) {
      window.toast && window.toast(`已更新 ${updated} 位达人的粉丝量`, 'success');
      render();
    } else {
      window.toast && window.toast('暂未获取到数据（服务器上线后生效）', 'info', 3000);
    }
  }

  /* ------------------------- 工具 ------------------------- */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.KolsPage = {
    render, openEditor, paintEditor,
    _save, _delete,
    _closeEditor: closeEditor,
    _editFollowers, _saveFollowers, _followersKey,
    refreshAllFollowers,
    _switchTab,
  };
  console.log('[KolsPage] 已就绪');
})();
