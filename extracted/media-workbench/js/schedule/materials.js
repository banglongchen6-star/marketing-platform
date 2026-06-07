/* =====================================================================
 * 达人营销 · 素材管理模块
 *
 * 数据来源：DB.contents.publications（有发布链接的自动同步）
 * 状态字段存于 publication 对象：mat_downloaded / mat_uploaded / mat_note
 * 暴露：window.MaterialsPage = { render }
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[MaterialsPage] ScheduleData 未就绪'); return; }

  const state = {
    year: 0, month: 0,
    bd_id: '',
    q: '',
  };

  function initState() {
    if (state.year) return;
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth() + 1;
  }

  function fmtMonth(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }

  /* ---------- 数据：从内容发布筛出有链接的 publication ---------- */
  function getItems() {
    const ym = fmtMonth(state.year, state.month);
    const q = (state.q || '').trim().toLowerCase();
    const contents = (window.DB?.contents || []);
    // 以内容记录 ID 为单位分组（同一合同所有平台放一起）
    const groups = [];

    contents.forEach(c => {
      const r = SD.resolveContent(c);
      if (state.bd_id && String(r.bd_id) !== String(state.bd_id)) return;
      if (q && !(r.talent || '').toLowerCase().includes(q)) return;

      // 只取主平台（publications[0]）那一条，同步平台不显示
      const mainPub = (c.publications || [])[0];
      if (!mainPub || !mainPub.link) return;
      const pubMonth = (mainPub.date || '').slice(0, 7);
      if (pubMonth !== ym) return;

      groups.push({ c, r, pub: mainPub, mainDate: mainPub.date || '' });
    });

    // 按主平台日期升序，相同则按达人名
    groups.sort((a, b) => {
      const d = a.mainDate.localeCompare(b.mainDate);
      return d !== 0 ? d : (a.r.talent || '').localeCompare(b.r.talent || '');
    });
    return groups;
  }

  /* ---------- 更新 publication 上的素材状态 ---------- */
  function _toggle(contentId, pubId, field) {
    const c = (window.DB?.contents || []).find(x => x.id === contentId);
    if (!c) return;
    const newPubs = (c.publications || []).map(p =>
      p.id === pubId ? { ...p, [field]: !p[field] } : p
    );
    try {
      SD.updateContent(contentId, { publications: newPubs });
    } catch (e) {
      window.toast && window.toast('保存失败: ' + e.message, 'error');
    }
    render();
  }

  function _saveNote(contentId, pubId, val) {
    const c = (window.DB?.contents || []).find(x => x.id === contentId);
    if (!c) return;
    const newPubs = (c.publications || []).map(p =>
      p.id === pubId ? { ...p, mat_note: val } : p
    );
    try {
      SD.updateContent(contentId, { publications: newPubs });
    } catch (e) {
      window.toast && window.toast('保存失败: ' + e.message, 'error');
    }
  }

  /* ---------- 渲染 ---------- */
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderToolbar(total) {
    const bdList = SD.listBdPersonnel ? SD.listBdPersonnel() : SD.listBds();
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 0 10px;flex-wrap:wrap">
        <button class="cal-nav" onclick="MaterialsPage._prevMonth()">‹</button>
        <span style="font-weight:600;font-size:1rem;min-width:80px;text-align:center">${state.year}-${String(state.month).padStart(2,'0')}</span>
        <button class="cal-nav" onclick="MaterialsPage._nextMonth()">›</button>
        <input class="search-input" style="width:180px" placeholder="🔍 搜索达人昵称…"
               value="${escapeHtml(state.q)}"
               oninput="MaterialsPage._search(this.value)">
        <select class="sched-form-control" style="width:130px;height:34px"
                onchange="MaterialsPage._setBd(this.value)">
          <option value="">全部 BD</option>
          ${bdList.map(b => `<option value="${b.id}" ${String(state.bd_id)===String(b.id)?'selected':''}>${escapeHtml(b.name)}</option>`).join('')}
        </select>
        <span style="margin-left:auto;font-size:.82rem;color:var(--text-muted)">共 ${total} 条素材</span>
      </div>
    `;
  }

  function renderTable(groups) {
    if (!groups.length) {
      return `<div style="text-align:center;padding:60px 0;color:var(--text-muted)">
        <div style="font-size:2rem;margin-bottom:8px">🗂️</div>
        <div>本月暂无已发布链接的素材</div>
        <div style="font-size:.78rem;margin-top:6px">在「内容发布」填写发布链接后自动同步到这里</div>
      </div>`;
    }

    const tbodyRows = groups.map(({ c, r, pub: p }) => {
      const bdDot = r.bd_color
        ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${r.bd_color};margin-right:4px;vertical-align:middle"></span>`
        : '';
      const dl = p.mat_downloaded ? 'checked' : '';
      const ul = p.mat_uploaded ? 'checked' : '';
      const note = escapeHtml(p.mat_note || '');
      return `
        <tr>
          <td style="font-weight:500;vertical-align:middle">${bdDot}${escapeHtml(r.talent || '—')}</td>
          <td><span class="sched-card-chip platform">${escapeHtml(p.platform || '—')}</span></td>
          <td>${escapeHtml(p.date || '—')}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <a href="${escapeHtml(p.link)}" target="_blank" rel="noopener"
               style="color:var(--primary);text-decoration:none;font-size:.82rem"
               title="${escapeHtml(p.link)}">🔗 ${escapeHtml(p.link.replace(/^https?:\/\//, '').slice(0, 30))}…</a>
          </td>
          <td style="text-align:center">
            <input type="checkbox" ${dl} style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary)"
                   onchange="MaterialsPage._toggle('${c.id}','${p.id}','mat_downloaded')">
          </td>
          <td style="text-align:center">
            <input type="checkbox" ${ul} style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary)"
                   onchange="MaterialsPage._toggle('${c.id}','${p.id}','mat_uploaded')">
          </td>
          <td>
            <input type="text" value="${note}" placeholder="备注…"
                   style="width:100%;border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-size:.78rem;outline:none;background:transparent"
                   onfocus="this.style.borderColor='var(--primary)'"
                   onblur="this.style.borderColor='var(--border)';MaterialsPage._saveNote('${c.id}','${p.id}',this.value)"
                   onkeydown="if(event.key==='Enter')this.blur()">
          </td>
        </tr>
      `;
    }).join('');

    const allPubs = groups.map(g => g.pub);
    const dlCount = allPubs.filter(p => p.mat_downloaded).length;
    const ulCount = allPubs.filter(p => p.mat_uploaded).length;
    const total = allPubs.length;

    return `
      <div style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto">
        <table class="comm-table">
          <thead>
            <tr>
              <th style="min-width:120px">达人昵称</th>
              <th>平台</th>
              <th>发布日期</th>
              <th style="min-width:200px">发布链接</th>
              <th style="text-align:center;min-width:70px">
                已下载<br><span style="font-size:.68rem;color:var(--text-muted);font-weight:400">${dlCount}/${total}</span>
              </th>
              <th style="text-align:center;min-width:70px">
                已上传<br><span style="font-size:.68rem;color:var(--text-muted);font-weight:400">${ulCount}/${total}</span>
              </th>
              <th style="min-width:140px">备注</th>
            </tr>
          </thead>
          <tbody>${tbodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function render() {
    initState();
    const page = document.getElementById('page-materials');
    if (!page) return;
    const groups = getItems();
    const totalPubs = groups.length;
    page.innerHTML = `
      <div style="padding:0 24px 24px">
        ${renderToolbar(totalPubs)}
        ${renderTable(groups)}
      </div>
    `;
  }

  /* ---------- 暴露 ---------- */
  window.MaterialsPage = {
    render,
    _prevMonth() {
      if (state.month === 1) { state.year--; state.month = 12; } else state.month--;
      render();
    },
    _nextMonth() {
      if (state.month === 12) { state.year++; state.month = 1; } else state.month++;
      render();
    },
    _search(v) { state.q = v; render(); },
    _setBd(v) { state.bd_id = v; render(); },
    _toggle,
    _saveNote,
  };

  // 覆盖旧 renderMaterials 全局函数
  window.renderMaterials = render;

  console.log('[MaterialsPage] 已就绪');
})();
