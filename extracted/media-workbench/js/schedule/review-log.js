/* =====================================================================
 * 离火品宣 · 心得月度复盘
 *
 * 汇总各月「本月复盘」（DB.monthly_reviews，与月度总结双向同步）。
 * 按月份从早到晚排列，只显示写过内容的月份；可在此直接编辑、失焦保存。
 *
 * 暴露：window.ReviewLogPage = { render, save }
 * ===================================================================== */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const escAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;');
  function monthLabel(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(key || '');
    return m ? `${m[1]}年${Number(m[2])}月` : key;
  }

  function ensureStyle() {
    if (document.getElementById('rl-style')) return;
    const s = document.createElement('style');
    s.id = 'rl-style';
    s.textContent = `
      #page-review-log .rl-wrap{padding:2px;max-width:860px}
      #page-review-log .rl-title{font-size:1.25rem;font-weight:700;margin:0 0 4px}
      #page-review-log .rl-sub{font-size:.78rem;color:var(--text-secondary);margin-bottom:16px}
      #page-review-log .rl-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin-bottom:12px}
      #page-review-log .rl-h{font-size:.95rem;font-weight:700;color:var(--primary);margin-bottom:8px;display:flex;align-items:center;gap:8px}
      #page-review-log .rl-h::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--primary);display:inline-block}
      #page-review-log .rl-box{width:100%;box-sizing:border-box;min-height:64px;border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-family:inherit;font-size:.85rem;line-height:1.6;resize:vertical;outline:none;background:var(--bg-base);color:var(--text-primary)}
      #page-review-log .rl-box:focus{border-color:var(--primary)}
      #page-review-log .rl-empty{text-align:center;color:var(--text-muted);padding:48px 0;font-size:.9rem;line-height:1.8}`;
    document.head.appendChild(s);
  }

  function render() {
    const page = document.getElementById('page-review-log');
    if (!page) return;
    ensureStyle();
    const DB = window.DB || {};
    const reviews = DB.monthly_reviews || {};
    const keys = Object.keys(reviews)
      .filter(k => String(reviews[k] || '').trim())
      .sort((a, b) => a.localeCompare(b));   // 从早到晚：2026-07 → 2026-08 → …
    const cards = keys.length
      ? keys.map(k => `
        <div class="rl-card">
          <div class="rl-h">${esc(monthLabel(k))}</div>
          <textarea class="rl-box" onblur="ReviewLogPage.save('${escAttr(k)}', this.value)">${esc(reviews[k])}</textarea>
        </div>`).join('')
      : '<div class="rl-empty">还没有任何月度复盘。<br>去「月度总结」→「本月复盘」写下第一条，这里会自动收进来。</div>';
    page.innerHTML = `
      <div class="rl-wrap">
        <div class="rl-title">📝 心得月度复盘</div>
        <div class="rl-sub">汇总各月「本月复盘」，与月度总结双向同步${keys.length ? `　·　共 ${keys.length} 个月` : ''}</div>
        ${cards}
      </div>`;
  }

  function save(key, v) {
    const DB = window.DB || (window.DB = {});
    if (!DB.monthly_reviews) DB.monthly_reviews = {};
    const val = String(v || '').trim();
    if (val) DB.monthly_reviews[key] = val; else delete DB.monthly_reviews[key];
    if (window.saveData) window.saveData();
    window.toast && window.toast('已保存', 'success', 1200);
  }

  window.ReviewLogPage = { render, save };
  console.log('[ReviewLogPage] 心得月度复盘已就绪');
})();
