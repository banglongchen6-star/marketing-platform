/* =====================================================================
 * 置换成本页面（达人赠送给客户的产品/物料成本）
 *
 * 暴露：window.ReplacementsPage = { render, openEditor(id?), ... }
 *
 * 数据：销售明细 / 物料明细 两类；列出每条置换 + 月度合计
 * ===================================================================== */
(function () {
  const SD = window.ScheduleData;
  if (!SD) { console.error('[ReplacementsPage] ScheduleData 未就绪'); return; }

  const state = {
    year: 0, month: 0,
    type: '',
    q: '',
    editor: {
      open: false, mode: 'create', id: null,
      form: defaultForm(),
    },
  };

  function defaultForm() {
    const today = new Date();
    return {
      date: today.toISOString().slice(0, 10),
      type: '销售明细',
      customer: '',
      product: '',
      qty: '',
      unit_cost: '',
      total_cost: '',
      note: '',
    };
  }

  function initState() {
    if (state.year) return;
    const d = new Date();
    state.year = d.getFullYear();
    state.month = d.getMonth() + 1;
  }

  function render() {
    initState();
    const page = document.getElementById('page-replacements');
    if (!page) return;
    const kpi = SD.getReplacementKPI({ year: state.year, month: state.month });
    page.innerHTML = `
      ${renderToolbar(kpi)}
      ${renderList()}
    `;
    bindToolbar();
  }

  function renderToolbar(kpi) {
    return `
      <div class="sched-toolbar" style="flex-wrap:wrap;gap:10px">
        <button class="sched-month-btn" onclick="ReplacementsPage._prevMonth()">‹</button>
        <div class="sched-month-current" style="min-width:96px">${state.year}-${String(state.month).padStart(2,'0')}</div>
        <button class="sched-month-btn" onclick="ReplacementsPage._nextMonth()">›</button>
        <select id="__rep-type__" class="filter-select" style="width:140px">
          <option value="">全部类型</option>
          <option value="销售明细" ${state.type==='销售明细'?'selected':''}>销售明细</option>
          <option value="物料明细" ${state.type==='物料明细'?'selected':''}>物料明细</option>
        </select>
        <input id="__rep-q__" class="search-input"
               style="width:200px"
               placeholder="🔍 客户 / 产品 / 备注" value="${escapeAttr(state.q)}">
        <!-- KPI -->
        <div style="display:flex;gap:14px;margin-left:14px;padding:0 14px;border-left:1px solid var(--border)">
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">本月置换总额</div>
            <div style="font-weight:600;color:var(--primary)">¥${kpi.total.toLocaleString()}</div>
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">销售明细</div>
            <div style="font-weight:600">¥${kpi.bySales.toLocaleString()}</div>
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">物料明细</div>
            <div style="font-weight:600">¥${kpi.byMaterial.toLocaleString()}</div>
          </div>
          <div>
            <div style="font-size:.72rem;color:var(--text-muted)">条数</div>
            <div style="font-weight:600">${kpi.count}</div>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" onclick="ReplacementsPage.openEditor()">＋ 新增置换</button>
        </div>
      </div>
    `;
  }

  function bindToolbar() {
    const t = document.getElementById('__rep-type__');
    if (t) t.addEventListener('change', e => { state.type = e.target.value; render(); });
    const q = document.getElementById('__rep-q__');
    if (q) {
      let timer;
      q.addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => { state.q = e.target.value; render(); }, 200);
      });
    }
  }

  function _prevMonth() {
    if (state.month === 1) { state.year--; state.month = 12; } else state.month--;
    render();
  }
  function _nextMonth() {
    if (state.month === 12) { state.year++; state.month = 1; } else state.month++;
    render();
  }

  function renderList() {
    const list = SD.listReplacements({
      year: state.year, month: state.month,
      type: state.type || undefined, q: state.q || undefined,
    });
    if (!list.length) {
      return `<div style="background:var(--bg-panel);border-radius:var(--radius);padding:60px 16px;text-align:center;color:var(--text-muted);box-shadow:var(--shadow)">
        <div style="font-size:2rem;margin-bottom:8px">💱</div>
        <div>本月暂无置换成本记录</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-top:6px">点击「+ 新增置换」录入达人赠送客户的产品/物料成本</div>
      </div>`;
    }
    return `
      <div style="background:var(--bg-panel);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto">
        <table class="sched-budget-table">
          <thead>
            <tr>
              <th style="width:100px">日期</th>
              <th style="width:90px">类型</th>
              <th style="width:140px">客户</th>
              <th style="width:160px">产品/物料</th>
              <th style="width:70px;text-align:right">数量</th>
              <th style="width:100px;text-align:right">单价</th>
              <th style="width:110px;text-align:right">总成本</th>
              <th>备注</th>
              <th style="width:90px"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map(r => `
              <tr style="cursor:pointer" onclick="ReplacementsPage.openEditor('${r.id}')">
                <td>${escapeHtml(r.date)}</td>
                <td><span class="sched-card-chip ${r.type==='销售明细'?'platform':'direction'}">${escapeHtml(r.type)}</span></td>
                <td><strong>${escapeHtml(r.customer || '-')}</strong></td>
                <td>${escapeHtml(r.product || '-')}</td>
                <td style="text-align:right">${r.qty || '-'}</td>
                <td style="text-align:right">¥${Number(r.unit_cost||0).toLocaleString()}</td>
                <td style="text-align:right;font-weight:600;color:var(--primary)">¥${Number(r.total_cost||0).toLocaleString()}</td>
                <td><span style="font-size:.78rem;color:var(--text-secondary)">${escapeHtml((r.note||'').slice(0, 40))}</span></td>
                <td><button class="sched-budget-del" title="删除" onclick="event.stopPropagation();ReplacementsPage._delete('${r.id}')">🗑</button></td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr class="sched-budget-total-row">
              <td colspan="6">合计 ${list.length} 条</td>
              <td style="text-align:right">¥${list.reduce((s,r)=>s+(Number(r.total_cost)||0),0).toLocaleString()}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  /* ------------------------- 编辑器抽屉 ------------------------- */
  function openEditor(id) {
    ensureEditorNode();
    if (id) {
      const r = window.DB.replacements.find(x => x.id === id);
      if (!r) return;
      state.editor.mode = 'edit';
      state.editor.id = id;
      state.editor.form = {
        date: r.date,
        type: r.type,
        customer: r.customer || '',
        product: r.product || '',
        qty: r.qty != null ? String(r.qty) : '',
        unit_cost: r.unit_cost != null ? String(r.unit_cost) : '',
        total_cost: r.total_cost != null ? String(r.total_cost) : '',
        note: r.note || '',
      };
    } else {
      state.editor.mode = 'create';
      state.editor.id = null;
      state.editor.form = defaultForm();
    }
    state.editor.open = true;
    paintEditor();
    requestAnimationFrame(() => {
      document.getElementById('rep-drawer').classList.add('open');
      document.getElementById('rep-drawer-overlay').classList.add('open');
      document.getElementById('rf-customer')?.focus();
    });
  }

  function closeEditor() {
    state.editor.open = false;
    const d = document.getElementById('rep-drawer');
    const o = document.getElementById('rep-drawer-overlay');
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('open');
  }

  function ensureEditorNode() {
    if (document.getElementById('rep-drawer')) return;
    const ov = document.createElement('div');
    ov.id = 'rep-drawer-overlay';
    ov.className = 'sched-drawer-overlay';
    ov.addEventListener('click', closeEditor);
    document.body.appendChild(ov);
    const d = document.createElement('div');
    d.id = 'rep-drawer';
    d.className = 'sched-drawer';
    d.innerHTML = `
      <div class="sched-drawer-header">
        <div class="sched-drawer-title" id="rep-drawer-title">新增置换</div>
        <button class="sched-drawer-close" onclick="ReplacementsPage._closeEditor()">×</button>
      </div>
      <div class="sched-drawer-body" id="rep-drawer-body"></div>
      <div class="sched-drawer-footer" id="rep-drawer-footer"></div>
    `;
    document.body.appendChild(d);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.editor.open) closeEditor();
    });
  }

  function paintEditor() {
    document.getElementById('rep-drawer-title').textContent =
      state.editor.mode === 'edit' ? '编辑置换' : '新增置换';
    const f = state.editor.form;
    const calcedTotal = (Number(f.qty)||0) * (Number(f.unit_cost)||0);
    document.getElementById('rep-drawer-body').innerHTML = `
      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">日期<span class="req">*</span></label>
          <input type="date" id="rf-date" class="sched-form-control" value="${escapeAttr(f.date)}">
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">类型<span class="req">*</span></label>
          <select id="rf-type" class="sched-form-control">
            <option value="销售明细" ${f.type==='销售明细'?'selected':''}>销售明细（达人赠送给客户的产品）</option>
            <option value="物料明细" ${f.type==='物料明细'?'selected':''}>物料明细（达人赠送给客户的物料）</option>
          </select>
        </div>
      </div>
      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">客户</label>
          <input id="rf-customer" class="sched-form-control" placeholder="如：客户A" value="${escapeAttr(f.customer)}">
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">产品/物料</label>
          <input id="rf-product" class="sched-form-control" placeholder="产品或物料名称" value="${escapeAttr(f.product)}">
        </div>
      </div>
      <div class="sched-form-row">
        <div class="sched-form-group">
          <label class="sched-form-label">数量</label>
          <input type="number" min="0" id="rf-qty" class="sched-form-control" value="${escapeAttr(f.qty)}">
        </div>
        <div class="sched-form-group">
          <label class="sched-form-label">单价（元）</label>
          <input type="number" min="0" step="0.01" id="rf-unit" class="sched-form-control" value="${escapeAttr(f.unit_cost)}">
        </div>
      </div>
      <div class="sched-form-group">
        <label class="sched-form-label">总成本（元）</label>
        <input type="number" min="0" step="0.01" id="rf-total" class="sched-form-control" value="${escapeAttr(f.total_cost)}">
        <div class="sched-form-hint">${f.total_cost === '' ? `留空将自动按 数量 × 单价 = ¥${calcedTotal.toLocaleString()} 计算` : `手动填写覆盖自动计算`}</div>
      </div>
      <div class="sched-form-group">
        <label class="sched-form-label">备注</label>
        <textarea id="rf-note" class="sched-form-control" rows="3" placeholder="合作背景、寄送时间等">${escapeHtml(f.note)}</textarea>
      </div>
    `;
    document.getElementById('rep-drawer-footer').innerHTML = `
      ${state.editor.mode === 'edit' ? `<button class="btn btn-danger btn-sm" onclick="ReplacementsPage._delete('${state.editor.id}')">删除</button>` : ''}
      <div class="spacer" style="flex:1"></div>
      <button class="btn btn-secondary btn-sm" onclick="ReplacementsPage._closeEditor()">取消</button>
      <button class="btn btn-primary btn-sm" onclick="ReplacementsPage._save()">保存</button>
    `;
    bindEditor();
  }

  function bindEditor() {
    on('rf-date', 'input', v => state.editor.form.date = v);
    on('rf-type', 'change', v => state.editor.form.type = v);
    on('rf-customer', 'input', v => state.editor.form.customer = v);
    on('rf-product', 'input', v => state.editor.form.product = v);
    on('rf-qty', 'input', v => { state.editor.form.qty = v; paintEditor(); });
    on('rf-unit', 'input', v => { state.editor.form.unit_cost = v; paintEditor(); });
    on('rf-total', 'input', v => state.editor.form.total_cost = v);
    on('rf-note', 'input', v => state.editor.form.note = v);
  }
  function on(id, evt, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(evt, e => fn(e.target.value));
  }

  function _save() {
    const f = state.editor.form;
    if (!f.date) {
      window.toast && window.toast('日期不能为空', 'error');
      return;
    }
    try {
      if (state.editor.mode === 'edit') {
        SD.updateReplacement(state.editor.id, f);
        window.toast && window.toast('已更新', 'success');
      } else {
        SD.createReplacement(f);
        window.toast && window.toast('已新增', 'success');
      }
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  function _delete(id) {
    if (!confirm('删除这条置换记录？不可恢复。')) return;
    try {
      SD.deleteReplacement(id);
      window.toast && window.toast('已删除', 'info');
      closeEditor();
      render();
    } catch (e) {
      window.toast && window.toast(e.message, 'error');
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.ReplacementsPage = {
    render, openEditor,
    _prevMonth, _nextMonth, _save, _delete, _closeEditor: closeEditor,
  };
  console.log('[ReplacementsPage] 已就绪');
})();
