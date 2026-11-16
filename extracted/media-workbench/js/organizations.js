(function () {
  'use strict';
  const TOKEN_KEY = 'mw_org_token_v1', SESSION_KEY = 'mw_org_session_v1', LAST_KEY = 'mw_last_organization';
  let session = null, organizations = [], loginChoice = localStorage.getItem(LAST_KEY) || 'domestic';
  try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) {}
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function json(url, options) {
    const r = await fetch(url, options), body = await r.json();
    if (!r.ok) { const error = new Error(body.error || '请求失败'); error.status = r.status; throw error; }
    return body;
  }
  function setSession(value) {
    session = value.user;
    if (value.token) sessionStorage.setItem(TOKEN_KEY, value.token);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value.user));
    localStorage.setItem(LAST_KEY, value.user.organization.id);
  }
  async function refreshLogin() {
    const host = document.getElementById('login-organizations');
    try {
      organizations = await json('/api/organizations');
      if (!organizations.some(o => o.id === loginChoice)) loginChoice = organizations[0].id;
      host.innerHTML = organizations.map(o => `<button type="button" class="org-choice ${o.id === loginChoice ? 'active' : ''}" aria-pressed="${o.id === loginChoice}" data-org="${esc(o.id)}">${esc(o.name)}</button>`).join('');
      host.querySelectorAll('[data-org]').forEach(b => b.onclick = () => {
        loginChoice = b.dataset.org; localStorage.setItem(LAST_KEY, loginChoice);
        document.getElementById('login-pass').value = '';
        document.getElementById('login-error').textContent = '';
        refreshLogin();
      });
      await populateLoginIdentities();
    } catch(e) {
      host.textContent = '组织加载失败，请刷新重试';
      document.getElementById('login-identity').innerHTML = '';
    }
  }
  async function restore() {
    if (sessionStorage.getItem(TOKEN_KEY)) {
      try { const data = await json('/api/session'); setSession(data); return data.user; }
      catch(e) { if (e.status !== 401) throw e; clear(); }
    }
    const data = await json('/api/session/restore', {method:'POST', headers:{'x-login-action':'1'}});
    if (!data.user) { clear(); return null; }
    setSession(data); return data.user;
  }
  async function forgetRemembered() {
    await json('/api/logout', {method:'POST', headers:{'x-login-action':'1'}});
  }
  function clear() {
    sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(SESSION_KEY);
    session = null;
  }
  function renderCurrent() {
    const host = document.getElementById('current-organization');
    if (!host || !session) return;
    host.innerHTML = `<span class="org-current-label">当前组织</span><button type="button" id="org-switch-trigger" title="${esc(session.organization.name)}">${esc(session.organization.name)}${session.isSuperAdmin ? ' ▾' : ''}</button>`;
    document.getElementById('org-switch-trigger').onclick = () => session.isSuperAdmin && openSwitcher();
    const mobile = document.getElementById('ui-mobile-organization');
    if (mobile) mobile.textContent = session.organization.name;
    document.getElementById('organization-management').hidden = !session.isSuperAdmin;
  }
  async function openSwitcher() {
    try {
      organizations = await json('/api/organizations');
      const modal = document.createElement('div'); modal.className = 'org-modal';
      modal.innerHTML = `<div class="org-dialog"><h3>切换组织</h3><div class="org-switch-list">${organizations.map(o => `<button type="button" class="org-choice ${o.id === session.organization.id ? 'active' : ''}" data-org="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div><button class="btn btn-secondary org-close">取消</button></div>`;
      document.body.appendChild(modal);
      modal.querySelector('.org-close').onclick = () => modal.remove();
      modal.querySelectorAll('[data-org]').forEach(b => b.onclick = () => { modal.remove(); switchTo(b.dataset.org); });
    } catch(e) { toast(e.message, 'error'); }
  }
  function switchTo(id) {
    if (id === session.organization.id) return;
    if (window.__dirty || window.__orgPendingWrites) { toast('当前改动尚未保存成功，请等待保存完成后切换组织', 'error'); return; }
    appConfirm('切换组织将关闭当前页面，请确认已保存正在填写的内容。', async () => {
      if (window.__dirty || window.__orgPendingWrites) { toast('请先完成当前保存', 'error'); return; }
      try {
        const data = await json('/api/organizations/switch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({organization:id}) });
        window.__syncReady = false;
        setSession(data); location.reload();
      } catch(e) { toast(e.message, 'error'); }
    }, {okText:'切换组织'});
  }
  async function renderManagement() {
    const host = document.getElementById('org-management-body');
    if (!session?.isSuperAdmin || !host) return;
    try {
      organizations = await json('/api/organizations');
      host.innerHTML = `<p class="org-help">每个组织独立管理人员和业务数据；进入对应组织后，可在下方添加该部门的商务BD和主管账号。</p><div class="org-management-list">${organizations.map(o => `<div><strong>${esc(o.name)}</strong><span>人民币 · 北京时间</span><button class="btn btn-secondary btn-sm" data-org="${esc(o.id)}" ${o.id===session.organization.id?'disabled':''}>${o.id===session.organization.id?'当前组织':'进入组织'}</button></div>`).join('')}</div>`;
      host.querySelectorAll('[data-org]').forEach(b => b.onclick = () => switchTo(b.dataset.org));
    } catch(e) { host.textContent = e.message; }
  }
  function openCreate() {
    if (!session?.isSuperAdmin) return;
    const modal = document.createElement('div'); modal.className = 'org-modal';
    modal.innerHTML = `<form class="org-dialog"><h3>新增组织</h3><label for="org-new-name">组织名称</label><input id="org-new-name" maxlength="40" required placeholder="例如：海外品宣二部" /><label for="org-new-region">平台模板</label><select id="org-new-region"><option value="overseas">海外平台（TikTok、Instagram、YouTube、Facebook）</option><option value="domestic">国内平台（抖音、小红书等）</option></select><p class="org-help">创建空的业务数据区，沿用人民币、北京时间。平台可在字典管理中调整。</p><p class="org-error" role="alert"></p><div class="org-actions"><button type="button" class="btn btn-secondary org-close">取消</button><button type="submit" class="btn btn-primary">创建组织</button></div></form>`;
    document.body.appendChild(modal); modal.querySelector('.org-close').onclick = () => modal.remove();
    modal.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const button = modal.querySelector('[type=submit]'); button.disabled = true;
      try {
        await json('/api/organizations', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:modal.querySelector('input').value,region:modal.querySelector('select').value})});
        modal.remove(); renderManagement(); toast('组织已创建，进入后即可添加该部门人员');
      } catch(e) { modal.querySelector('.org-error').textContent = e.message; button.disabled = false; }
    };
    modal.querySelector('input').focus();
  }
  window.OrgApp = { TOKEN_KEY, SESSION_KEY, get activeId() { return session?.organization?.id || 'domestic'; },
    get user() { return session; }, get loginId() { return loginChoice; }, setSession, clear, restore, forgetRemembered, refreshLogin, renderCurrent, renderManagement, openCreate,
    get cacheKey() { return 'pxw_org_v1:' + (session?.organization?.id || 'anonymous') + ':' + (session?.identity || '') + ':' + (session?.bd_id || ''); } };
})();
