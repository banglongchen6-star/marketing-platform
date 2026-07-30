/* =====================================================================
 * 离火品宣 · 复盘总结
 *
 * 汇总各月「本月复盘」（DB.monthly_reviews）。按月份从早到晚排列，
 * 只显示写过内容的月份。本版面仅供查看，不能修改；
 * 如需修改，请到「月度总结」对应月份的「本月复盘」。
 *
 * 暴露：window.ReviewLogPage = { render }
 * ===================================================================== */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
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
      #page-review-log .rl-sub{font-size:.78rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.7}
      #page-review-log .rl-tip{color:var(--text-muted);font-size:.72rem}
      #page-review-log .rl-card{background:var(--bg-panel);border:1px solid var(--border);border-radius:10px;padding:13px 15px;margin-bottom:12px}
      #page-review-log .rl-h{font-size:.95rem;font-weight:700;color:var(--primary);margin-bottom:8px;display:flex;align-items:center;gap:8px}
      #page-review-log .rl-h::before{content:'';width:4px;height:15px;border-radius:3px;background:var(--primary);display:inline-block}
      #page-review-log .rl-text{white-space:pre-wrap;word-break:break-word;background:var(--bg-base);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:.85rem;line-height:1.7;color:var(--text-primary)}
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
          <div class="rl-text">${esc(reviews[k])}</div>
        </div>`).join('')
      : '<div class="rl-empty">还没有任何月度复盘。<br>去「月度总结」→「本月复盘」写下第一条，这里会自动收进来。</div>';
    page.innerHTML = `
      <div class="rl-wrap">
        <div class="rl-title">📝 复盘总结</div>
        <div class="rl-sub">汇总各月「本月复盘」，此处仅供查看${keys.length ? `　·　共 ${keys.length} 个月` : ''}<br><span class="rl-tip">✏️ 如需修改，请到「月度总结」对应月份的「本月复盘」编辑</span></div>
        ${cards}
      </div>`;
  }

  window.ReviewLogPage = { render };
  console.log('[ReviewLogPage] 复盘总结已就绪');
})();
