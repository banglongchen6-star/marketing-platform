/* =====================================================================
 * 达人营销 · 内容排期模块 · 数据层 (Phase 1)
 *
 * 设计目标：所有"排期/规划/字典/达人库"的数据读写都通过 window.ScheduleData
 * 这一层做适配。当前底层用 localStorage（沿用工作台原有 DB），将来切到
 * Supabase / 自建后端只需替换本文件实现，业务层（calendar.js / budget.js
 * 等）一行不用动。
 *
 * 字段命名说明（与交接文档 §3.2 对齐）：
 *   - kol_schedules.category_direction = 达人类型（非"内容方向"）
 *   - schedule_budgets.category        = 达人类型（与字典 .name 对齐）
 *   - kol_schedules.category           = 已废弃，永远空串
 * ===================================================================== */
(function () {
  if (!window.DB) {
    console.error('[ScheduleData] DB 未就绪，请确保此文件在主 script 之后加载');
    return;
  }

  /* ------------------------- 1. 种子数据 ------------------------- */
  const SEED_DIRECTIONS = [
    { name: '弹唱', sort_order: 1 },
    { name: '弹奏', sort_order: 2 },
    { name: '鼓棒', sort_order: 3 },
    { name: '生活', sort_order: 4 },
    { name: '教学', sort_order: 5 },
    { name: '亲子', sort_order: 6 },
    { name: '种草', sort_order: 7 },
    { name: '口播', sort_order: 8 },
    { name: '测评', sort_order: 9 },
    { name: '乐队', sort_order: 10 },
    { name: '剧情', sort_order: 11 },
    { name: 'Vlog', sort_order: 12 },
  ];

  /* ------------------------- 2. 初始化集合 ------------------------- */
  // 不动 DB._version（避免清掉用户已有的 contents/candidates 等数据）
  // 新集合用首次访问时按需补齐策略
  function ensureCollection(key, defaultVal) {
    if (!DB[key]) {
      DB[key] = defaultVal;
      return true;
    }
    return false;
  }

  let mutated = false;
  mutated = ensureCollection('schedule_directions', []) || mutated;
  mutated = ensureCollection('schedule_budgets', []) || mutated;
  mutated = ensureCollection('product_lines', []) || mutated;
  mutated = ensureCollection('platforms', []) || mutated;
  mutated = ensureCollection('tiers', []) || mutated;
  mutated = ensureCollection('bds', []) || mutated;
  mutated = ensureCollection('supervisors', []) || mutated;
  mutated = ensureCollection('payment_accounts', ['私库', '星图']) || mutated;
  mutated = ensureCollection('kols', []) || mutated;
  mutated = ensureCollection('replacements', []) || mutated;
  mutated = ensureCollection('schedule_import_logs', []) || mutated;
  mutated = ensureCollection('sample_products', []) || mutated;
  mutated = ensureCollection('frozenMonths', []) || mutated;

  // ⚠️ 一次性重置（清掉所有迁移自老系统的演示数据），每个浏览器只触发一次
  // 保留 schedule_directions / schedule_budgets（字典 + 预算配置）
  // 重置后正常持久化新数据
  const RESET_FLAG = '_wiped_demo_data_2026_05_11';
  if (!DB[RESET_FLAG]) {
    DB.schedules = [];
    DB.kols = [];
    DB.schedule_import_logs = [];
    DB[RESET_FLAG] = true;
    mutated = true;
  }

  // 第 1 期联动改造：清掉 5 个老模块的 demo 数据（每浏览器一次），强制走关联排期录入
  const PHASE1_RESET_FLAG = '_wiped_phase1_modules_2026_05_11';
  if (!DB[PHASE1_RESET_FLAG]) {
    DB.contents = [];
    DB.candidates = [];
    DB.samples = [];
    DB.materials = [];
    DB.settlements = [];
    DB[PHASE1_RESET_FLAG] = true;
    mutated = true;
  }

  // 内容发布模型大改造：从"扁平 1 条 = 1 平台"改为"主信息+publications[]"
  // 老结构没有 schedule_id 强约束。一次性清空，强制走新结构。
  const COMMS_RESET_FLAG = '_comms_v2_2026_05_15';
  if (!DB[COMMS_RESET_FLAG]) {
    DB.contents = [];
    DB[COMMS_RESET_FLAG] = true;
    mutated = true;
  }

  // 字典首次为空时种 12 条
  if (DB.schedule_directions.length === 0) {
    const now = new Date().toISOString();
    DB.schedule_directions = SEED_DIRECTIONS.map((d, i) => ({
      id: uid(),
      name: d.name,
      sort_order: d.sort_order,
      is_active: true,
      created_at: now,
    }));
    mutated = true;
  }

  // 产品线字典种子（首次为空时种 2 条：键盘 / 鼓锤）
  if (DB.product_lines.length === 0) {
    const now = new Date().toISOString();
    DB.product_lines = [
      { id: uid(), name: '键盘', sort_order: 1, is_active: true, created_at: now },
      { id: uid(), name: '鼓锤', sort_order: 2, is_active: true, created_at: now },
    ];
    mutated = true;
  }

  // 平台字典种子（首次为空时种 4 条：抖音 / 小红书 / B站 / 视频号）
  if (DB.platforms.length === 0) {
    const now = new Date().toISOString();
    DB.platforms = [
      { id: uid(), name: '抖音',   sort_order: 1, is_active: true, created_at: now },
      { id: uid(), name: '小红书', sort_order: 2, is_active: true, created_at: now },
      { id: uid(), name: 'B站',    sort_order: 3, is_active: true, created_at: now },
      { id: uid(), name: '视频号', sort_order: 4, is_active: true, created_at: now },
    ];
    mutated = true;
  }

  // 层级字典种子（首次为空时种 5 条：sss级 / 头部 / 腰部 / 尾部 / KOC素人）
  if (DB.tiers.length === 0) {
    const now = new Date().toISOString();
    DB.tiers = [
      { id: uid(), name: 'sss级',   sort_order: 1, is_active: true, created_at: now },
      { id: uid(), name: '头部',    sort_order: 2, is_active: true, created_at: now },
      { id: uid(), name: '腰部',    sort_order: 3, is_active: true, created_at: now },
      { id: uid(), name: '尾部',    sort_order: 4, is_active: true, created_at: now },
      { id: uid(), name: 'KOC素人', sort_order: 5, is_active: true, created_at: now },
    ];
    mutated = true;
  }

  // 商务 BD 字典（首次为空时保持空白，由用户自行添加）
  // 已在字典管理中提供添加入口，无需预设样例

  // 发货品类字典种子（首次为空时写入）
  if (DB.sample_products.length === 0) {
    const now = new Date().toISOString();
    const names = ['二代白色琴包款2支装','二代黑色琴包款2支装','二代白色音箱','二代黑色音箱',
                   '黑色鼓棒','白色鼓棒','延音踏板','麦克风','二代黑色单键盘','二代白色单键盘'];
    DB.sample_products = names.map((name, i) => ({
      id: uid(), name, sort_order: i + 1, is_active: true, created_at: now,
    }));
    mutated = true;
  }

  /* ------------------------- 3. 已有 schedules 字段迁移 -------------------------
   * 老数据形如 { id, talent, price, topic, date }
   * 新数据形如 { id, schedule_date, kol_name, kol_id, category_direction,
   *             tier, amount, platform, status, publish_url, publish_date,
   *             notes, created_at, updated_at, category(=空串保留) }
   * 凡是检测到旧字段则补齐新字段，旧字段保留以免破坏「内容排期」老视图。
   */
  // 中文 status → 英文枚举映射（兼容老数据）
  const STATUS_CN_TO_EN = {
    '待策划': 'planned',
    '计划中': 'planned',
    '已联系': 'planned',
    '已确认': 'planned',
    '已发布': 'published',
    '已取消': 'cancelled',
  };
  const VALID_STATUS = new Set(['planned','published','cancelled']);

  function normalizeStatus(s) {
    if (!s) return 'planned';
    if (VALID_STATUS.has(s)) return s;
    return STATUS_CN_TO_EN[s] || 'planned';
  }

  if (Array.isArray(DB.schedules)) {
    DB.schedules.forEach((s) => {
      // 判断是否为老数据：缺 schedule_date 且有 date，或 status 是中文
      const isLegacy = (!s.schedule_date && s.date) || (s.status && !VALID_STATUS.has(s.status));
      if (isLegacy) {
        s.schedule_date = s.schedule_date || s.date || '';
        s.kol_name = s.kol_name || s.talent || '';
        s.amount = s.amount != null ? s.amount : (s.price || 0);
        s.notes = s.notes || s.topic || '';
        s.category_direction = s.category_direction || '';
        s.tier = s.tier || '';
        s.platform = s.platform || '';
        s.status = normalizeStatus(s.status);
        s.publish_url = s.publish_url || '';
        s.publish_date = s.publish_date || null;
        s.kol_id = s.kol_id || null;
        s.category = '';
        s.created_at = s.created_at || new Date().toISOString();
        s.updated_at = s.updated_at || s.created_at;
        mutated = true;
      }
      // 迁移：platform 字符串 → platforms 数组（支持逗号分隔的旧数据）
      if (!Array.isArray(s.platforms)) {
        s.platforms = s.platform
          ? s.platform.split(',').map(x => x.trim()).filter(Boolean)
          : [];
        mutated = true;
      }
      // 迁移：sync_platforms（主平台=第一个，同步=其余）
      if (!Array.isArray(s.sync_platforms)) {
        s.sync_platforms = s.platforms.slice(1);
        mutated = true;
      }
    });
  }

  if (mutated) saveData();

  // 启动清理：删除超过 7 天的"回收站"软删数据
  (function autoCleanup() {
    const cutoff = Date.now() - 7 * 86400000;
    const before = DB.schedules.length;
    DB.schedules = DB.schedules.filter(s => {
      if (!s.deleted_at) return true;
      const ts = new Date(s.deleted_at).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (DB.schedules.length !== before) {
      console.log('[ScheduleData] 自动清理过期回收站', before - DB.schedules.length, '条');
      saveData();
    }
  })();

  /* ------------------------- 4. 工具 ------------------------- */
  function uid() {
    // 简易 UUID（够本地用；后端可替换）
    return 'x-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function nowISO() { return new Date().toISOString(); }

  /** 返回本地今天日期字符串 YYYY-MM-DD（避免 toISOString 的 UTC 时区偏差）*/
  function todayLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymd(date) {
    if (typeof date === 'string') return date.slice(0, 10);
    const d = new Date(date);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthRange(year, month) {
    // [start, endExclusive) 字符串日期
    const start = `${year}-${pad2(month)}-01`;
    const ny = month === 12 ? year + 1 : year;
    const nm = month === 12 ? 1 : month + 1;
    const end = `${ny}-${pad2(nm)}-01`;
    return { start, end };
  }

  function prevMonth(year, month) {
    if (month === 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
  }

  /* ------------------------- 5. 字典 CRUD ------------------------- */
  function listDirections({ includeInactive = false } = {}) {
    const rows = DB.schedule_directions.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter((d) => d.is_active !== false);
  }

  function findDirectionByName(name) {
    return DB.schedule_directions.find((d) => d.name === name);
  }

  function createOrReactivateDirection({ name, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('达人类型名不能为空');
    const existing = findDirectionByName(name);
    if (existing) {
      if (existing.is_active === false) {
        existing.is_active = true;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const maxOrder = DB.schedule_directions.reduce((m, d) => Math.max(m, d.sort_order || 0), 0);
    const row = {
      id: uid(),
      name,
      sort_order: sort_order ?? maxOrder + 1,
      is_active: true,
      created_at: nowISO(),
    };
    DB.schedule_directions.push(row);
    saveData();
    return row;
  }

  function updateDirection(id, patch) {
    const d = DB.schedule_directions.find((x) => x.id === id);
    if (!d) throw new Error('达人类型不存在');
    Object.assign(d, patch, { updated_at: nowISO() });
    saveData();
    return d;
  }

  /**
   * 删除（停用）一个达人类型，并按需级联清理排期/预算。
   * 返回 { ok, deletedSchedules, deletedBudgets }
   */
  function deactivateDirectionCascade(id, { cascadeDeleteSchedules = false } = {}) {
    const d = DB.schedule_directions.find((x) => x.id === id);
    if (!d) throw new Error('达人类型不存在');
    let deletedSchedules = 0;
    let deletedBudgets = 0;
    if (cascadeDeleteSchedules) {
      // schedules 改为软删（可从回收站还原），预算仍是硬删
      const ts = nowISO();
      DB.schedules.forEach((s) => {
        if (s.category_direction === d.name && !s.deleted_at) {
          s.deleted_at = ts;
          s.updated_at = ts;
          deletedSchedules++;
        }
      });
      const beforeB = DB.schedule_budgets.length;
      DB.schedule_budgets = DB.schedule_budgets.filter((b) => b.category !== d.name);
      deletedBudgets = beforeB - DB.schedule_budgets.length;
    }
    d.is_active = false;
    d.updated_at = nowISO();
    saveData();
    return { ok: true, deletedSchedules, deletedBudgets };
  }

  function countDirectionUsage(name) {
    const schedules = DB.schedules.filter((s) => s.category_direction === name && s.status !== 'cancelled' && !s.deleted_at).length;
    const budgets = DB.schedule_budgets.filter((b) => b.category === name).length;
    return { schedules, budgets };
  }

  /* ------------------------- 5.5 产品线字典 CRUD -------------------------
   * 与 schedule_directions 平级的另一组字典，挂在 schedule_budgets.product_line
   * （字符串软引用名）。规划表新增一列展示/编辑。
   */
  function listProductLines({ includeInactive = false } = {}) {
    const rows = DB.product_lines.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter(p => p.is_active !== false);
  }
  function findProductLineByName(name) {
    return DB.product_lines.find(p => p.name === name);
  }
  function createOrReactivateProductLine({ name, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('产品线名不能为空');
    const existing = findProductLineByName(name);
    if (existing) {
      if (existing.is_active === false) {
        existing.is_active = true;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const maxOrder = DB.product_lines.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const row = {
      id: uid(), name,
      sort_order: sort_order ?? maxOrder + 1,
      is_active: true,
      created_at: nowISO(),
    };
    DB.product_lines.push(row);
    saveData();
    return row;
  }
  function updateProductLine(id, patch) {
    const p = DB.product_lines.find(x => x.id === id);
    if (!p) throw new Error('产品线不存在');
    Object.assign(p, patch, { updated_at: nowISO() });
    saveData();
    return p;
  }
  function deactivateProductLine(id, { cascadeClearBudgets = false } = {}) {
    const p = DB.product_lines.find(x => x.id === id);
    if (!p) throw new Error('产品线不存在');
    let cleared = 0;
    if (cascadeClearBudgets) {
      DB.schedule_budgets.forEach(b => {
        if (b.product_line === p.name) { b.product_line = ''; cleared++; }
      });
    }
    p.is_active = false;
    p.updated_at = nowISO();
    saveData();
    return { ok: true, clearedBudgets: cleared };
  }
  function countProductLineUsage(name) {
    return DB.schedule_budgets.filter(b => b.product_line === name).length;
  }

  /* ------------------------- 5.6 平台字典 CRUD -------------------------
   * 第 3 个字典：值用于 schedule_budgets.platform 和 kol_schedules.platform。
   * 字典中没有的值（如老数据"抖音 / 小红书"拼接串）仍可保留，但下拉只列字典里的。
   */
  function listPlatforms({ includeInactive = false } = {}) {
    const rows = DB.platforms.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter(p => p.is_active !== false);
  }
  function findPlatformByName(name) {
    return DB.platforms.find(p => p.name === name);
  }
  function createOrReactivatePlatform({ name, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('平台名不能为空');
    const existing = findPlatformByName(name);
    if (existing) {
      if (existing.is_active === false) {
        existing.is_active = true;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const maxOrder = DB.platforms.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const row = {
      id: uid(), name,
      sort_order: sort_order ?? maxOrder + 1,
      is_active: true,
      created_at: nowISO(),
    };
    DB.platforms.push(row);
    saveData();
    return row;
  }
  function updatePlatform(id, patch) {
    const p = DB.platforms.find(x => x.id === id);
    if (!p) throw new Error('平台不存在');
    Object.assign(p, patch, { updated_at: nowISO() });
    saveData();
    return p;
  }
  function deactivatePlatform(id, { cascadeClearBudgets = false } = {}) {
    const p = DB.platforms.find(x => x.id === id);
    if (!p) throw new Error('平台不存在');
    let cleared = 0;
    if (cascadeClearBudgets) {
      DB.schedule_budgets.forEach(b => {
        if (b.platform === p.name) { b.platform = ''; cleared++; }
      });
    }
    p.is_active = false;
    p.updated_at = nowISO();
    saveData();
    return { ok: true, clearedBudgets: cleared };
  }
  function countPlatformUsage(name) {
    const inBudgets = DB.schedule_budgets.filter(b => b.platform === name).length;
    const inSchedules = DB.schedules.filter(s => s.platform === name).length;
    return { budgets: inBudgets, schedules: inSchedules };
  }

  /* ------------------------- 5.7 层级字典 CRUD -------------------------
   * 第 4 个字典：值用于 kol_schedules.tier。排期编辑器层级下拉读这个字典。
   */
  function listTiers({ includeInactive = false } = {}) {
    const rows = DB.tiers.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter(t => t.is_active !== false);
  }
  function findTierByName(name) {
    return DB.tiers.find(t => t.name === name);
  }
  function createOrReactivateTier({ name, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('层级名不能为空');
    const existing = findTierByName(name);
    if (existing) {
      if (existing.is_active === false) {
        existing.is_active = true;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const maxOrder = DB.tiers.reduce((m, t) => Math.max(m, t.sort_order || 0), 0);
    const row = {
      id: uid(), name,
      sort_order: sort_order ?? maxOrder + 1,
      is_active: true,
      created_at: nowISO(),
    };
    DB.tiers.push(row);
    saveData();
    return row;
  }
  function updateTier(id, patch) {
    const t = DB.tiers.find(x => x.id === id);
    if (!t) throw new Error('层级不存在');
    Object.assign(t, patch, { updated_at: nowISO() });
    saveData();
    return t;
  }
  function deactivateTier(id, { cascadeClearSchedules = false } = {}) {
    const t = DB.tiers.find(x => x.id === id);
    if (!t) throw new Error('层级不存在');
    let cleared = 0;
    if (cascadeClearSchedules) {
      DB.schedules.forEach(s => {
        if (s.tier === t.name) { s.tier = ''; cleared++; }
      });
    }
    t.is_active = false;
    t.updated_at = nowISO();
    saveData();
    return { ok: true, clearedSchedules: cleared };
  }
  function countTierUsage(name) {
    return { schedules: DB.schedules.filter(s => s.tier === name).length };
  }

  /* ------------------------- 5.8 商务 BD 字典 CRUD -------------------------
   * 第 5 个字典：BD 商务负责人（含颜色）。挂在 schedule.bd_id / kol.bd_id。
   */
  const DEFAULT_BD_PALETTE = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899',
    '#06b6d4','#84cc16','#f97316','#6366f1','#14b8a6','#a855f7',
  ];
  function _autoPickColor() {
    const used = new Set(DB.bds.map(b => b.color));
    return DEFAULT_BD_PALETTE.find(c => !used.has(c)) || DEFAULT_BD_PALETTE[Math.floor(Math.random()*DEFAULT_BD_PALETTE.length)];
  }
  function listBds({ includeInactive = false } = {}) {
    const rows = DB.bds.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter(b => b.is_active !== false);
  }
  // 返回所有 BD 人员（商务BD + 品宣主管），用于表单选择器
  function listBdPersonnel() {
    const bds = listBds().map(b => ({ ...b, _kind: 'bd' }));
    const svs = (DB.supervisors || []).filter(sv => sv.name).map(sv => ({
      id: sv.id, name: sv.name, color: '#7c3aed', _kind: 'supervisor',
    }));
    return [...bds, ...svs];
  }
  function findBdByName(name) { return DB.bds.find(b => b.name === name); }
  function findBdById(id) { return DB.bds.find(b => b.id === id); }
  function createOrReactivateBd({ name, color, sort_order }) {
    name = String(name || '').trim();
    if (!name) throw new Error('BD 名不能为空');
    const existing = findBdByName(name);
    if (existing) {
      if (existing.is_active === false) {
        existing.is_active = true;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const maxOrder = DB.bds.reduce((m, b) => Math.max(m, b.sort_order || 0), 0);
    const row = {
      id: uid(), name,
      color: color || _autoPickColor(),
      sort_order: sort_order ?? maxOrder + 1,
      is_active: true,
      created_at: nowISO(),
    };
    DB.bds.push(row);
    saveData();
    return row;
  }
  function updateBd(id, patch) {
    const b = DB.bds.find(x => x.id === id);
    if (!b) throw new Error('BD 不存在');
    Object.assign(b, patch, { updated_at: nowISO() });
    saveData();
    return b;
  }
  function deactivateBd(id, { cascadeClear = false } = {}) {
    const b = DB.bds.find(x => x.id === id);
    if (!b) throw new Error('BD 不存在');
    let cleared = 0;
    if (cascadeClear) {
      DB.schedules.forEach(s => { if (s.bd_id === id) { s.bd_id = null; cleared++; } });
      DB.kols.forEach(k => { if (k.bd_id === id) { k.bd_id = null; cleared++; } });
    }
    b.is_active = false;
    b.updated_at = nowISO();
    saveData();
    return { ok: true, cleared };
  }
  function deleteBd(id) {
    let cleared = 0;
    DB.schedules.forEach(s => { if (s.bd_id === id) { s.bd_id = null; cleared++; } });
    DB.kols.forEach(k => { if (k.bd_id === id) { k.bd_id = null; cleared++; } });
    const idx = DB.bds.findIndex(b => b.id === id);
    if (idx >= 0) DB.bds.splice(idx, 1);
    saveData();
    return { ok: true, cleared };
  }

  function countBdUsage(id) {
    return {
      schedules: DB.schedules.filter(s => !s.deleted_at && s.bd_id === id).length,
      kols: DB.kols.filter(k => k.bd_id === id).length,
    };
  }

  /* ------------------------- 6. 排期 CRUD ------------------------- */
  function listSchedulesInRange(startDate, endDateExclusive, { tiers, bd_id, includeDeleted = false } = {}) {
    let rows = DB.schedules.filter((s) => {
      if (!s.schedule_date) return false;
      if (!includeDeleted && s.deleted_at) return false;
      return s.schedule_date >= startDate && s.schedule_date < endDateExclusive;
    });
    if (tiers && tiers.length) rows = rows.filter((s) => tiers.includes(s.tier));
    if (bd_id) rows = rows.filter((s) => s.bd_id === bd_id);
    return rows;
  }

  function listSchedulesByMonth(year, month, opts) {
    const { start, end } = monthRange(year, month);
    return listSchedulesInRange(start, end, opts);
  }

  function createSchedule(data) {
    if (!data.schedule_date) throw new Error('日期不能为空');
    if (!data.kol_name) throw new Error('达人名不能为空');
    const initialStatus = data.status || 'planned';
    const ts = nowISO();
    const row = {
      id: uid(),
      schedule_date: data.schedule_date,
      kol_name: String(data.kol_name).trim(),
      kol_id: data.kol_id || null,
      kol_homepage: data.kol_homepage || '',
      bd_id: data.bd_id || null,
      category_direction: data.category_direction || '',
      tier: data.tier || '',
      amount: Number(data.amount) || 0,
      platform: data.platform || (Array.isArray(data.platforms) ? data.platforms[0] : '') || '',
      sync_platforms: Array.isArray(data.sync_platforms) ? data.sync_platforms : (Array.isArray(data.platforms) ? data.platforms.slice(1) : []),
      platforms: data.platform ? [data.platform, ...(Array.isArray(data.sync_platforms) ? data.sync_platforms : [])] : (Array.isArray(data.platforms) ? data.platforms : []),
      status: initialStatus,
      publish_url: data.publish_url || '',
      publish_date: data.publish_date || null,
      notes: data.notes || '',
      category: '',
      created_at: ts,
      updated_at: ts,
      status_history: [{
        from: null, to: initialStatus, at: ts,
        by: (window.currentUser && window.currentUser.name) || 'system',
        reason: '新建排期',
      }],
    };
    DB.schedules.push(row);
    // 若绑定到达人库，将 homepage 回写到 kol 记录（已有则补、已不同则忽略）
    syncKolHomepage(row);
    saveData();
    return row;
  }

  function syncKolHomepage(row) {
    if (!row.kol_id || !row.kol_homepage) return;
    const k = DB.kols.find(x => x.id === row.kol_id);
    if (k && !k.homepage) {
      k.homepage = row.kol_homepage;
      k.updated_at = nowISO();
    }
  }

  function updateSchedule(id, patch) {
    const idx = DB.schedules.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error('排期不存在');
    const before = DB.schedules[idx];
    // 检测状态变化，追加 status_history
    let history = before.status_history || [];
    if (patch.status && patch.status !== before.status) {
      history = history.concat([{
        from: before.status,
        to: patch.status,
        at: nowISO(),
        by: (window.currentUser && window.currentUser.name) || 'system',
        reason: patch._autoAdvanceReason || '手动调整',
      }]);
    }
    // 清掉控制字段，避免泄漏到 row
    const { _autoAdvanceReason, ...realPatch } = patch;
    // 同步 platform / sync_platforms / platforms 三字段保持一致
    if (realPatch.platform != null || Array.isArray(realPatch.sync_platforms)) {
      const mainP = realPatch.platform != null ? realPatch.platform : (before.platform || '');
      const syncP = Array.isArray(realPatch.sync_platforms) ? realPatch.sync_platforms : (Array.isArray(before.sync_platforms) ? before.sync_platforms : []);
      realPatch.platform = mainP;
      realPatch.sync_platforms = syncP;
      realPatch.platforms = mainP ? [mainP, ...syncP] : [];
    } else if (Array.isArray(realPatch.platforms)) {
      realPatch.platform = realPatch.platforms[0] || '';
      realPatch.sync_platforms = realPatch.platforms.slice(1);
    }
    DB.schedules[idx] = {
      ...before,
      ...realPatch,
      status_history: history,
      updated_at: nowISO(),
    };
    syncKolHomepage(DB.schedules[idx]);

    // 日期变更处理
    const newDate = realPatch.schedule_date || before.schedule_date;
    if (realPatch.schedule_date) {
      if (newDate >= todayLocal()) {
        // 移至今天或未来 → 清除 auto_created 内容记录
        const before_len = (DB.contents || []).length;
        DB.contents = (DB.contents || []).filter(c => !(c.schedule_id === id && c.auto_created));
        if (DB.contents.length !== before_len) {
          console.log(`[updateSchedule] 排期 ${id} 移至未来，已清除 ${before_len - DB.contents.length} 条自动内容记录`);
        }
      } else {
        // 移至另一个过去日期 → 同步更新内容发布的 publications[].date
        const content = (DB.contents || []).find(c => c.schedule_id === id);
        if (content && Array.isArray(content.publications)) {
          content.publications = content.publications.map(p => ({ ...p, date: newDate }));
          console.log(`[updateSchedule] 排期 ${id} 移至 ${newDate}，已同步内容发布日期`);
        }
      }
    }

    saveData();
    return DB.schedules[idx];
  }

  /* 软删除：仅打 deleted_at 标记。7 天后由 cleanupExpiredRecycleBin 真正清除。
     同时联动删除关联的内容发布记录（有填写数据时禁止删除）。*/
  function deleteSchedule(id) {
    const s = DB.schedules.find(x => x.id === id);
    if (!s) throw new Error('排期不存在');
    if (s.deleted_at) return { ok: true, alreadyDeleted: true };
    // 有填写数据（链接 / 播放量等）时拒绝删除
    const hasData = (DB.contents || []).filter(c => c.schedule_id === id)
      .some(c => (c.publications || []).some(p => p.link || parseFloat(p.views) > 0 || parseFloat(p.completion) > 0));
    if (hasData) throw new Error('内容发布中已有填写数据，无法删除该排期');
    const ts = nowISO();
    s.deleted_at = ts;
    s.updated_at = ts;
    // 联动删除关联内容发布记录
    const linkedCount = (DB.contents || []).filter(c => c.schedule_id === id).length;
    DB.contents = (DB.contents || []).filter(c => c.schedule_id !== id);
    saveData();
    return { ok: true, deletedContents: linkedCount };
  }

  /* 回收站操作 */
  function listDeletedSchedules() {
    return DB.schedules
      .filter(s => s.deleted_at)
      .sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));
  }
  function restoreSchedule(id) {
    const s = DB.schedules.find(x => x.id === id);
    if (!s) throw new Error('排期不存在');
    if (!s.deleted_at) return { ok: true, notDeleted: true };
    delete s.deleted_at;
    s.updated_at = nowISO();
    saveData();
    return { ok: true };
  }
  function permanentlyDeleteSchedule(id) {
    const before = DB.schedules.length;
    DB.schedules = DB.schedules.filter(s => s.id !== id);
    if (DB.schedules.length === before) throw new Error('排期不存在');
    saveData();
    return { ok: true };
  }
  function emptyRecycleBin() {
    const count = DB.schedules.filter(s => s.deleted_at).length;
    DB.schedules = DB.schedules.filter(s => !s.deleted_at);
    saveData();
    return { ok: true, removed: count };
  }
  /* 启动时自动清理 7 天前的软删数据 */
  function cleanupExpiredRecycleBin(days = 7) {
    const cutoff = Date.now() - days * 86400000;
    const before = DB.schedules.length;
    DB.schedules = DB.schedules.filter(s => {
      if (!s.deleted_at) return true;
      const ts = new Date(s.deleted_at).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
    if (DB.schedules.length !== before) saveData();
    return { removed: before - DB.schedules.length };
  }

  /* ------------------------- 7. 预算 CRUD ------------------------- */
  function listBudgetsByMonth(year, month) {
    return DB.schedule_budgets.filter((b) => b.year === year && b.month === month);
  }

  function upsertBudget({ year, month, category, ...rest }) {
    if (!year || !month || !category) throw new Error('year/month/category 必填');
    let row = DB.schedule_budgets.find(
      (b) => b.year === year && b.month === month && b.category === category
    );
    if (row) {
      Object.assign(row, rest, { updated_at: nowISO() });
    } else {
      row = {
        id: uid(),
        year, month, category,
        budget_amount: 0,
        target_count: null,
        product_line: '',
        platform: '',
        requirements: '',
        function_display: '',
        notes: '',
        created_at: nowISO(),
        updated_at: nowISO(),
        ...rest,
      };
      DB.schedule_budgets.push(row);
    }
    saveData();
    return row;
  }

  function copyBudgetsFromLastMonth(year, month) {
    const { year: py, month: pm } = prevMonth(year, month);
    const source = listBudgetsByMonth(py, pm);
    let copied = 0;
    source.forEach((src) => {
      const exists = DB.schedule_budgets.some(
        (b) => b.year === year && b.month === month && b.category === src.category
      );
      if (exists) return;
      DB.schedule_budgets.push({
        ...src,
        id: uid(),
        year, month,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      copied++;
    });
    if (copied > 0) saveData();
    return { copied, total: source.length };
  }

  /* ------------------------- 7.5 内容发布 (Communication / 传播执行) -------------------------
   * 数据模型：一条 content = 一次合作（主信息）+ N 个 publication（平台发布渠道）
   *   主信息：schedule_id 必填，talent/price/category/bd_id 从 schedule 反查（不冗余）
   *   publications: [{ platform, date, link, views, likes, comments, completion, interaction,
   *                   search_views, search_rate, attr_*（抖音独有）, day7_recorded_at }]
   *   fans 独立存（发布时粉丝量快照），不和 kol.followers 强绑
   */
  function createContent(data) {
    // schedule_id 为 null 表示「不关联排期」，此时 kol_name 必填
    if (data.schedule_id) {
      const s = DB.schedules.find(x => x.id === data.schedule_id && !x.deleted_at);
      if (!s) throw new Error('关联的排期不存在');
    } else if (!data.kol_name || !String(data.kol_name).trim()) {
      throw new Error('不关联排期时，达人昵称为必填');
    }
    const s = data.schedule_id
      ? DB.schedules.find(x => x.id === data.schedule_id && !x.deleted_at)
      : null;
    const row = {
      id: uid(),
      schedule_id: data.schedule_id || null,
      kol_name: data.kol_name ? String(data.kol_name).trim() : null,
      fans: data.fans != null && data.fans !== '' ? Number(data.fans) : null,
      publications: (data.publications || []).map(normalizePublication),
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    DB.contents.push(row);
    // 自动推进排期状态到 published（仅关联排期时）
    if (s && window.SchedulePicker) window.SchedulePicker.advanceStatus(s.id, 'published', '内容已发布');
    saveData();
    return row;
  }

  function updateContent(id, patch) {
    const idx = DB.contents.findIndex(x => x.id === id);
    if (idx < 0) throw new Error('内容记录不存在');
    const before = DB.contents[idx];
    const next = { ...before, ...patch, updated_at: nowISO() };
    if (patch.publications) next.publications = patch.publications.map(normalizePublication);
    DB.contents[idx] = next;
    saveData();
    return next;
  }

  function deleteContent(id) {
    const before = DB.contents.length;
    if (!DB.contents.find(x => x.id === id)) throw new Error('内容记录不存在');
    const linked = (DB.settlements || []).filter(s => s.content_id === id || (s.schedule_id && DB.contents.find(c => c.id === id)?.schedule_id === s.schedule_id));
    const hasPaid = linked.some(s => (s.payments || []).some(p => !!p.paid_date));
    if (hasPaid) throw new Error('达人结算中已有付款记录，无法删除该内容');
    DB.settlements = (DB.settlements || []).filter(s => !linked.find(l => l.id === s.id));
    DB.contents = DB.contents.filter(x => x.id !== id);
    saveData();
    return { ok: true, deletedSettlements: linked.length };
  }

  /**
   * 扫描所有过期「计划中」排期 → 升为「已发布」并创建空链接内容发布记录
   * 每次调用都全量扫描（性能无虑，localStorage 数据量极小）
   * 因为检查 status === 'planned'，已处理过的排期不会重复升级
   * 因为检查 existing，不会重复创建内容发布记录
   * 返回本次新处理的排期列表，供调用方展示通知
   */
  function autoPublishPastSchedules() {
    const todayStr = todayLocal();

    let mutated = false;
    const processed = [];

    DB.schedules.forEach(s => {
      if (s.deleted_at) return;
      const d = s.schedule_date;
      if (!d || d >= todayStr) return; // 只处理今天之前的日期

      // ① 计划中 / 已结算 → 统一为已发布
      if (s.status === 'planned' || s.status === 'settled') {
        s.status = 'published';
        s.updated_at = nowISO();
        mutated = true;
        processed.push({ id: s.id, kol_name: s.kol_name, schedule_date: d });
      }

      // ② 已发布但完全没有内容发布记录 → 补建一条空占位记录
      // 注意：不修改已有记录的日期（BD 手动填写的真实发布日期应该保留）
      if (s.status === 'published') {
        const hasAny = DB.contents.some(c => c.schedule_id === s.id);
        if (!hasAny) {
          const plats = Array.isArray(s.platforms) && s.platforms.length
            ? s.platforms : (s.platform ? [s.platform] : ['']);
          DB.contents.push({
            id: uid(),
            schedule_id: s.id,
            fans: null,
            auto_created: true,
            publications: plats.map(p => normalizePublication({ platform: p, date: d, link: '' })),
            created_at: nowISO(),
            updated_at: nowISO(),
          });
          mutated = true;
          if (!processed.find(x => x.id === s.id)) {
            processed.push({ id: s.id, kol_name: s.kol_name, schedule_date: d });
          }
        }
      }
    });

    // 清理：同一 schedule_id 有多条记录时，保留有内容的，删除空的 auto_created 占位
    const scheduleContentMap = new Map();
    DB.contents.forEach(c => {
      if (!c.schedule_id) return;
      if (!scheduleContentMap.has(c.schedule_id)) scheduleContentMap.set(c.schedule_id, []);
      scheduleContentMap.get(c.schedule_id).push(c);
    });
    scheduleContentMap.forEach((items) => {
      if (items.length <= 1) return;
      const hasReal = items.some(c => !c.auto_created);
      if (hasReal) {
        // 删除所有空的 auto_created 占位
        const toDelete = items.filter(c => c.auto_created &&
          (c.publications || []).every(p => !p.link && p.views == null));
        if (toDelete.length) {
          const delIds = new Set(toDelete.map(c => c.id));
          DB.contents = DB.contents.filter(c => !delIds.has(c.id));
          mutated = true;
        }
      }
    });

    if (mutated) saveData();
    return processed;
  }

  /** 归一化 publication 字段，避免 undefined 漏存 */
  function normalizePublication(p) {
    return {
      id: p.id || uid(),
      platform: p.platform || '',
      date: p.date || '',
      link: p.link || '',
      views: p.views != null && p.views !== '' ? Number(p.views) : null,        // 单位：万
      likes: p.likes != null && p.likes !== '' ? Number(p.likes) : null,
      comments: p.comments != null && p.comments !== '' ? Number(p.comments) : null,
      completion: p.completion != null && p.completion !== '' ? Number(p.completion) : null, // %
      interaction: p.interaction != null && p.interaction !== '' ? Number(p.interaction) : null, // %
      search_views: p.search_views != null && p.search_views !== '' ? Number(p.search_views) : null,
      search_rate: p.search_rate != null && p.search_rate !== '' ? Number(p.search_rate) : null,
      // 抖音独有归因数据
      attr_direct: p.attr_direct != null && p.attr_direct !== '' ? Number(p.attr_direct) : null,
      attr_indirect: p.attr_indirect != null && p.attr_indirect !== '' ? Number(p.attr_indirect) : null,
      attr_search: p.attr_search != null && p.attr_search !== '' ? Number(p.attr_search) : null,
      attr_audience: p.attr_audience != null && p.attr_audience !== '' ? Number(p.attr_audience) : null,
      attr_store: p.attr_store || '',
      cpa3: p.cpa3 != null && p.cpa3 !== '' ? Number(p.cpa3) : null,
      // 投流数据（仅抖音常用：投流播放量 + 投流花费）
      promo_views: p.promo_views != null && p.promo_views !== '' ? Number(p.promo_views) : null,
      promo_cost: p.promo_cost != null && p.promo_cost !== '' ? Number(p.promo_cost) : null,
      // 数据采集时点：'' (不设) | 'd0' (发布当天) | 'd3' (第3天) | 'd7' (第7天) | 'd30' (第30天)
      snapshot_day: p.snapshot_day || '',
      // 实际采集时间戳（每次更新数据时自动刷新）
      snapshot_at: p.snapshot_at || null,
      // 兼容旧字段
      day7_recorded_at: p.day7_recorded_at || (p.snapshot_day === 'd7' ? (p.snapshot_at || nowISO()) : null),
      // 7天每日数据快照（自动抓取）：[{ date, likes, comments, fetched_at }, ...]
      daily_stats: Array.isArray(p.daily_stats) ? p.daily_stats : [],
      // 素材管理状态
      mat_downloaded: p.mat_downloaded || false,
      mat_uploaded:   p.mat_uploaded   || false,
      mat_note:       p.mat_note       || '',
    };
  }

  /* -------- 7.5.2 平台链接识别 & 7天数据追踪 -------- */

  /** 从发布链接 URL 识别平台名 */
  function detectPlatformFromLink(url) {
    if (!url) return '';
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('douyin.com') || host.includes('iesdouyin.com')) return '抖音';
      if (host.includes('xiaohongshu.com') || host.includes('xhslink.com')) return '小红书';
      if (host.includes('weixin.qq.com') || host.includes('channels.weixin')) return '视频号';
      if (host.includes('kuaishou.com') || host.includes('gifshow.com') || host.includes('kwai.com')) return '快手';
      if (host.includes('bilibili.com') || host.includes('b23.tv')) return 'B站';
    } catch(e) {}
    return '';
  }

  /** 工具：日期字符串（YYYY-MM-DD）加 N 天 */
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * 抓取单条视频在指定日期的点赞/评论数据
   * 当前为 stub（返回 null），上线后替换为真实 API 调用
   * @param {string} link  发布链接
   * @param {string} platform 平台名（抖音/小红书/视频号/快手/B站）
   * @param {string} date  YYYY-MM-DD
   * @returns {Promise<{likes:number,comments:number}|null>}
   */
  async function fetchPlatformStats(link, platform, date) {
    // TODO: 上线后按平台接入真实 API
    // 抖音  → 抖音创作者服务平台 / 开放平台视频数据接口
    // 小红书 → 小红书开放平台 API
    // 视频号 → 微信开放平台 API
    // 快手  → 快手开放平台 API
    // B站   → Bilibili 开放平台 API
    return null; // stub
  }

  /**
   * 扫描所有有发布链接的 publication，补抓 7 天内缺失日期的快照数据
   * 每次进入内容发布页面时调用（async，不阻塞页面渲染）
   * 发布日当天 = 第1天，发布日+6 = 第7天（截止日）
   * @returns {Promise<{updated:boolean}>}
   */
  async function checkAndUpdateDailyStats() {
    const today = todayLocal();
    let mutated = false;

    for (const c of DB.contents) {
      for (const p of (c.publications || [])) {
        if (!p.link) continue;
        const pubDate = p.date;
        if (!pubDate) continue;

        // 7天窗口：第7天 = 发布日 + 6
        const endDate = addDays(pubDate, 6);
        if (today > endDate) continue; // 超过7天不再追踪

        if (!Array.isArray(p.daily_stats)) p.daily_stats = [];
        const platform = p.platform || detectPlatformFromLink(p.link);

        for (let i = 0; i <= 6; i++) {
          const checkDate = addDays(pubDate, i);
          if (checkDate > today) break; // 未来日期跳过

          const alreadyHas = p.daily_stats.some(s => s.date === checkDate);
          if (!alreadyHas) {
            const stats = await fetchPlatformStats(p.link, platform, checkDate);
            if (stats) {
              p.daily_stats.push({
                date: checkDate,
                likes: stats.likes != null ? Number(stats.likes) : null,
                comments: stats.comments != null ? Number(stats.comments) : null,
                fetched_at: nowISO(),
              });
              mutated = true;
            }
          }
        }
      }
    }

    if (mutated) saveData();
    return { updated: mutated };
  }

  /** 列表查询：按月/主平台/BD/达人名筛选
   *  主平台 = publications[0].platform（按用户录入顺序，第一个即为主）
   */
  function listContents({ year, month, mainPlatform, bd_id, q, withPlaceholders = false } = {}) {
    let rows = DB.contents.slice();
    if (year && month) {
      // 按"主平台首条 publication 的发布日期"在该月内；
      // 不关联排期且未填发布日期时，回落到 created_at 所在月
      const monthStr = `${year}-${pad2(month)}`;
      rows = rows.filter(c => {
        const p = (c.publications || [])[0];
        if (p && p.date && p.date.startsWith(monthStr)) return true;
        // 无发布日期：用 created_at 判断
        if (!p || !p.date) return (c.created_at || '').startsWith(monthStr);
        return false;
      });
    }
    if (mainPlatform && mainPlatform !== '全部') {
      rows = rows.filter(c => (c.publications||[]).some(p => p.platform === mainPlatform));
    }
    if (bd_id) {
      rows = rows.filter(c => {
        if (!c.schedule_id) return false; // 不关联排期的记录不归属 BD，显示在全部
        const s = DB.schedules.find(x => x.id === c.schedule_id);
        return s && s.bd_id === bd_id;
      });
    }
    if (q) {
      const lo = String(q).toLowerCase().trim();
      rows = rows.filter(c => {
        // 不关联排期：搜 kol_name
        if (!c.schedule_id) return (c.kol_name || '').toLowerCase().includes(lo);
        const s = DB.schedules.find(x => x.id === c.schedule_id);
        return s && (s.kol_name || '').toLowerCase().includes(lo);
      });
    }

    // 补充：无内容记录的排期作为"待填写"占位行
    if (withPlaceholders) {
      const linkedIds = new Set(DB.contents.map(c => c.schedule_id).filter(Boolean));
      let scheds = (DB.schedules || []).filter(s => !s.deleted_at && !linkedIds.has(s.id));
      if (year && month) {
        const monthStr = `${year}-${pad2(month)}`;
        scheds = scheds.filter(s => s.schedule_date && s.schedule_date.startsWith(monthStr));
      }
      if (mainPlatform && mainPlatform !== '全部') {
        scheds = scheds.filter(s => {
          const plats = Array.isArray(s.platforms) ? s.platforms : [];
          return s.platform === mainPlatform || plats.includes(mainPlatform);
        });
      }
      if (bd_id) scheds = scheds.filter(s => s.bd_id === bd_id);
      if (q) {
        const lo = String(q).toLowerCase().trim();
        scheds = scheds.filter(s => (s.kol_name || '').toLowerCase().includes(lo));
      }
      rows = rows.concat(scheds.map(s => ({
        _placeholder: true,
        id: null,
        schedule_id: s.id,
        kol_name: s.kol_name,
        publications: [],
        created_at: s.schedule_date || s.created_at || '',
      })));
    }

    // 排序：有内容记录按发布日期，占位行按排期日期
    rows.sort((a, b) => {
      const getDate = x => {
        if (x._placeholder) {
          const s = DB.schedules.find(ss => ss.id === x.schedule_id);
          return s?.schedule_date || '';
        }
        return (x.publications||[])[0]?.date || x.created_at || '';
      };
      return getDate(b).localeCompare(getDate(a));
    });
    return rows;
  }

  /** 给一条内容生成"主信息合并视图"：从 schedule 反查 talent/price/category/bd */
  function resolveContent(c) {
    if (!c) return null;
    const s = c.schedule_id ? DB.schedules.find(x => x.id === c.schedule_id) : null;
    const bd = s && s.bd_id ? DB.bds.find(b => b.id === s.bd_id) : null;
    return {
      ...c,
      // 不关联排期时直接用内容记录上的 kol_name
      talent: s ? s.kol_name : (c.kol_name || '—'),
      price: s ? s.amount : (c.price || 0),
      category: s ? s.category_direction : '',
      tier: s ? s.tier : '',
      bd_id: s ? s.bd_id : null,
      bd_name: bd ? bd.name : '',
      bd_color: bd ? bd.color : '',
      schedule_date: s ? s.schedule_date : '',
    };
  }

  /** 月度 KPI：选定月份的总播放/总费用/CPM */
  function getCommunicationKPI({ year, month, mainPlatform, bd_id } = {}) {
    const list = listContents({ year, month, mainPlatform, bd_id });
    let totalViews = 0;        // 自然播放，单位 万
    let totalPromoViews = 0;   // 投流播放，单位 万
    let totalPrice = 0;        // 达人合作费
    let totalPromoCost = 0;    // 投流花费
    let publicationCount = 0;
    list.forEach(c => {
      // 一次合作的费用只算一次（在主行）
      const r = resolveContent(c);
      totalPrice += Number(r.price) || 0;
      (c.publications || [])
        .filter(p => !mainPlatform || mainPlatform === '全部' || p.platform === mainPlatform)
        .forEach(p => {
          totalViews      += (Number(p.views)       || 0) / 10000; // 个→万
          totalPromoViews += Number(p.promo_views)  || 0;          // 已是万
          totalPromoCost  += Number(p.promo_cost)   || 0;
          publicationCount++;
        });
    });
    const totalExposureWan = totalViews + totalPromoViews; // 均已是万
    const totalSpend = totalPrice + totalPromoCost;
    const cpm = totalExposureWan > 0 ? (totalSpend / (totalExposureWan * 10000) * 1000) : 0;
    return {
      contentCount: list.length,
      publicationCount,
      totalViews,
      totalPromoViews,
      totalPrice,
      totalPromoCost,
      totalExposureWan,   // 总曝光 = 自然 + 投流
      totalSpend,         // 总花费 = 合作费 + 投流费
      cpm: Number(cpm.toFixed(2)),
    };
  }

  /* ------------------------- 7.5.1 品宣 ROI 矩阵（平台 × 日期） -------------------------
   * 返回结构（仿 ROI 看板原表）：
   *  {
   *    year, month, daysInMonth,
   *    platforms: [
   *      { name: '抖音', perDay: { '01': {count, views, cost}, ... }, hasPromotion: true,
   *        promoPerDay: { '01': {plays, cost}, ... } },
   *      { name: '小红书', perDay: {...} },
   *      ...
   *    ],
   *    replacementsPerDay: { '01': totalCost, ... },
   *    totalsPerDay: { '01': {count, exposure, spend}, ... },
   *    monthTotal: { count, exposure, spend },
   *    kpi: { contentCount, totalExposure, brandSpend, cpm },  // 顶部 4 KPI
   *  }
   */
  function getBrandRoiMatrix({ year, month, bd_id } = {}) {
    if (!year || !month) { const d = new Date(); year = year || d.getFullYear(); month = month || d.getMonth()+1; }
    const daysInMonth = new Date(year, month, 0).getDate();
    const allDays = Array.from({ length: daysInMonth }, (_, i) => pad2(i + 1));

    // 列出本月发布 publications（从 contents.publications 展开）
    const contents = listContents({ year, month, bd_id });
    // 平台来源：字典里全部 active 平台 + 数据中出现的额外平台（保证 6 大平台总是显示）
    const platformSet = new Set();
    listPlatforms().forEach(p => platformSet.add(p.name));
    contents.forEach(c => (c.publications || []).forEach(p => p.platform && platformSet.add(p.platform)));

    // 一次合作（content）只能算一次"品宣费"——价格归在主行
    // perDay: 每个平台每天的 { count, views(万), cost }
    //   - count: 该平台当天 publication 数
    //   - views: 该平台当天的 views 合计（万）
    //   - cost: 该平台当天发布的"合作费"分摊：只在主行平台 + 主行日期算
    const platforms = {};
    platformSet.forEach(name => {
      platforms[name] = {
        name,
        perDay: {}, // { '01': {count, views, cost} }
        promoPerDay: {},
      };
      allDays.forEach(d => {
        platforms[name].perDay[d] = { count: 0, views: 0, cost: 0 };
        platforms[name].promoPerDay[d] = { plays: 0, cost: 0 };
      });
    });

    contents.forEach(c => {
      const r = resolveContent(c);
      const pubs = c.publications || [];
      if (!pubs.length) return;
      const mainPub = pubs[0];
      const mainDay = (mainPub.date || '').slice(8, 10);
      const mainPlatform = mainPub.platform;
      pubs.forEach((p, idx) => {
        if (!p.platform || !platforms[p.platform]) return;
        const day = (p.date || '').slice(8, 10);
        if (!day || !platforms[p.platform].perDay[day]) return;
        platforms[p.platform].perDay[day].count += 1;
        platforms[p.platform].perDay[day].views += (Number(p.views) || 0) / 10000; // 个→万
        // 投流（每个 publication 单独存）
        const promoP = Number(p.promo_views) || 0;
        const promoC = Number(p.promo_cost) || 0;
        if (promoP || promoC) {
          platforms[p.platform].promoPerDay[day].plays += promoP;
          platforms[p.platform].promoPerDay[day].cost += promoC;
        }
        // 合作费：只在主行平台主行日期计一次
        if (idx === 0 && p.platform === mainPlatform && day === mainDay) {
          platforms[p.platform].perDay[day].cost += Number(r.price) || 0;
        }
      });
    });

    // 投流数据覆盖：DB.douyin_promo 手动填入的日级数据优先于 publications 聚合值
    const douyinPromo = DB.douyin_promo || {};
    if (platforms['抖音']) {
      allDays.forEach(d => {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${d}`;
        const manual = douyinPromo[dateStr];
        if (manual) {
          platforms['抖音'].promoPerDay[d] = {
            plays: Number(manual.plays) || 0,
            cost:  Number(manual.cost)  || 0,
          };
        }
      });
    }

    // 置换成本（按日聚合）
    const replacementsPerDay = {};
    allDays.forEach(d => replacementsPerDay[d] = 0);
    listReplacements({ year, month }).forEach(rep => {
      const day = (rep.date || '').slice(8, 10);
      if (day && replacementsPerDay[day] != null) {
        replacementsPerDay[day] += Number(rep.total_cost) || 0;
      }
    });

    // 合计每天（数量 / 曝光（自然 + 投流，万）/ 费用（合作 + 投流 + 置换））
    const totalsPerDay = {};
    let monthCount = 0, monthExposure = 0, monthSpend = 0;
    let brandSpendOnly = 0; // 品宣费 = 合作费 + 投流费（不含置换）
    let totalExposure = 0;
    allDays.forEach(d => {
      let count = 0, exposure = 0, spend = 0;
      Object.values(platforms).forEach(pf => {
        count += pf.perDay[d].count;
        exposure += pf.perDay[d].views + pf.promoPerDay[d].plays;
        spend += pf.perDay[d].cost + pf.promoPerDay[d].cost;
      });
      brandSpendOnly += spend;
      spend += replacementsPerDay[d]; // 加上置换
      totalsPerDay[d] = { count, exposure, spend };
      monthCount += count;
      monthExposure += exposure;
      monthSpend += spend;
    });
    totalExposure = monthExposure; // 单位：万
    const cpm = totalExposure > 0 ? (brandSpendOnly / (totalExposure * 10000) * 1000) : 0;

    return {
      year, month, daysInMonth, allDays,
      platforms: Object.values(platforms),
      replacementsPerDay,
      totalsPerDay,
      monthTotal: { count: monthCount, exposure: monthExposure, spend: monthSpend },
      kpi: {
        contentCount: monthCount,
        totalExposure: monthExposure, // 万
        brandSpend: brandSpendOnly,
        cpm: Number(cpm.toFixed(2)),
      },
    };
  }

  /* ------------------------- 7.6 置换成本（达人赠送客户的产品成本） ------------------------- */
  const REPLACEMENT_TYPES = ['销售明细', '物料明细'];

  function listReplacements({ year, month, type, q } = {}) {
    let rows = DB.replacements.slice();
    if (year && month) {
      const prefix = `${year}-${pad2(month)}`;
      rows = rows.filter(r => (r.date||'').startsWith(prefix));
    }
    if (type) rows = rows.filter(r => r.type === type);
    if (q) {
      const lo = String(q).toLowerCase().trim();
      rows = rows.filter(r =>
        (r.customer||'').toLowerCase().includes(lo) ||
        (r.product||'').toLowerCase().includes(lo) ||
        (r.note||'').toLowerCase().includes(lo)
      );
    }
    rows.sort((a, b) => (b.date||'').localeCompare(a.date||''));
    return rows;
  }

  function createReplacement(data) {
    const date = String(data.date || '').trim();
    if (!date) throw new Error('日期必填');
    const type = data.type || '销售明细';
    if (!REPLACEMENT_TYPES.includes(type)) throw new Error('类型必须是 销售明细 或 物料明细');
    const qty = Number(data.qty) || 0;
    const unit_cost = Number(data.unit_cost) || 0;
    const explicit_total = data.total_cost != null && data.total_cost !== ''
      ? Number(data.total_cost) : null;
    const total_cost = explicit_total != null && Number.isFinite(explicit_total)
      ? explicit_total
      : qty * unit_cost;
    const row = {
      id: uid(),
      date, type,
      customer: String(data.customer || '').trim(),
      product: String(data.product || '').trim(),
      qty, unit_cost, total_cost,
      note: String(data.note || '').trim(),
      created_at: nowISO(),
    };
    DB.replacements.push(row);
    saveData();
    return row;
  }
  function updateReplacement(id, patch) {
    const r = DB.replacements.find(x => x.id === id);
    if (!r) throw new Error('置换记录不存在');
    Object.assign(r, patch, { updated_at: nowISO() });
    // 重新算 total_cost（如果 qty / unit_cost 改了且 total_cost 没显式给）
    if ((patch.qty != null || patch.unit_cost != null) && patch.total_cost == null) {
      r.total_cost = (Number(r.qty)||0) * (Number(r.unit_cost)||0);
    }
    saveData();
    return r;
  }
  function deleteReplacement(id) {
    const before = DB.replacements.length;
    DB.replacements = DB.replacements.filter(x => x.id !== id);
    if (DB.replacements.length === before) throw new Error('记录不存在');
    saveData();
    return { ok: true };
  }

  /** 月度置换 KPI */
  function getReplacementKPI({ year, month } = {}) {
    const list = listReplacements({ year, month });
    let total = 0;
    let bySales = 0, byMaterial = 0;
    list.forEach(r => {
      const c = Number(r.total_cost) || 0;
      total += c;
      if (r.type === '销售明细') bySales += c;
      else if (r.type === '物料明细') byMaterial += c;
    });
    return { count: list.length, total, bySales, byMaterial };
  }

  /* ------------------------- 8. 达人库 ------------------------- */
  function searchKols(q, limit = 8) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return [];
    return DB.kols
      .filter((k) => k.name && k.name.toLowerCase().includes(s))
      .slice(0, limit);
  }

  function listKols({ q, platform, bd_id, sort = 'created_desc' } = {}) {
    let rows = DB.kols.slice();
    if (q) {
      const lo = String(q).toLowerCase().trim();
      rows = rows.filter(k =>
        (k.name||'').toLowerCase().includes(lo) ||
        (k.homepage||'').toLowerCase().includes(lo) ||
        (k.notes||'').toLowerCase().includes(lo)
      );
    }
    if (platform) rows = rows.filter(k => k.platform === platform);
    if (bd_id) rows = rows.filter(k => k.bd_id === bd_id);
    // 默认按创建时间倒序
    rows.sort((a, b) => {
      if (sort === 'name')         return (a.name||'').localeCompare(b.name||'');
      if (sort === 'created_asc')  return (a.created_at||'').localeCompare(b.created_at||'');
      return (b.created_at||'').localeCompare(a.created_at||''); // created_desc
    });
    return rows;
  }

  /* 统计某个 kol 的合作情况（不含已软删的排期） */
  function getKolStats(kolId) {
    const list = DB.schedules.filter(s =>
      !s.deleted_at && s.kol_id === kolId && s.status !== 'cancelled'
    );
    const total = list.reduce((acc, s) => ({
      amount: acc.amount + (Number(s.amount) || 0),
      count: acc.count + 1,
    }), { amount: 0, count: 0 });
    const dates = list.map(s => s.schedule_date).filter(Boolean).sort();
    return {
      count: total.count,
      totalAmount: total.amount,
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
    };
  }

  function updateKol(id, patch) {
    const k = DB.kols.find(x => x.id === id);
    if (!k) throw new Error('达人不存在');
    // 防止重复（同名同平台已被占用）
    if (patch.name || patch.platform != null) {
      const newName = (patch.name ?? k.name).trim();
      const newPlat = patch.platform ?? k.platform ?? '';
      const conflict = DB.kols.find(x => x.id !== id && x.name === newName && (x.platform||'') === newPlat);
      if (conflict) throw new Error('已存在同名同平台的达人');
    }
    // 名字改了 → 同步所有未删的排期 kol_name
    if (patch.name && patch.name !== k.name) {
      DB.schedules.forEach(s => {
        if (s.kol_id === id && !s.deleted_at) s.kol_name = patch.name;
      });
    }
    Object.assign(k, patch, { updated_at: nowISO() });
    saveData();
    return k;
  }

  function deleteKol(id) {
    const k = DB.kols.find(x => x.id === id);
    if (!k) throw new Error('达人不存在');
    // 排期里的 kol_id 解绑（保留 kol_name 历史记录）
    let unlinked = 0;
    DB.schedules.forEach(s => {
      if (s.kol_id === id) { s.kol_id = null; unlinked++; }
    });
    DB.kols = DB.kols.filter(x => x.id !== id);
    saveData();
    return { ok: true, unlinked };
  }

  function createKol({ name, platform, homepage, followers, category, notes, bd_id }) {
    name = String(name || '').trim();
    if (!name) throw new Error('达人名不能为空');
    const exists = DB.kols.find(k => k.name === name && (k.platform||'') === (platform||''));
    if (exists) throw new Error('已存在同名同平台的达人');
    const row = {
      id: uid(), name,
      platform: platform || '',
      homepage: homepage || '',
      followers: followers != null && followers !== '' ? Number(followers) : null,
      category: category || '',
      notes: notes || '',
      bd_id: bd_id || null,
      status: 'pending',
      created_at: nowISO(),
    };
    DB.kols.push(row);
    saveData();
    return row;
  }

  /* 批量导入达人（去重键：name + platform）
   * conflictStrategy: 'skip' | 'overwrite' | 'fillEmpty'
   */
  function batchImportKols(items, { conflictStrategy = 'skip' } = {}) {
    const result = { success: 0, skipped: 0, overwritten: 0, failed: 0, errors: [] };
    items.forEach((item, idx) => {
      try {
        const name = String(item.name || '').trim();
        if (!name) throw new Error('达人名为空');
        const platform = item.platform || '';
        const existing = DB.kols.find(k => k.name === name && (k.platform || '') === platform);
        if (existing) {
          if (conflictStrategy === 'skip') { result.skipped++; return; }
          const patch = {
            homepage: item.homepage || '',
            followers: item.followers != null && item.followers !== '' ? Number(item.followers) : null,
            category: item.category || '',
            notes: item.notes || '',
            updated_at: nowISO(),
          };
          if (conflictStrategy === 'overwrite') {
            Object.assign(existing, patch);
          } else if (conflictStrategy === 'fillEmpty') {
            Object.keys(patch).forEach(k => {
              if (existing[k] === undefined || existing[k] === null || existing[k] === '') {
                existing[k] = patch[k];
              }
            });
            existing.updated_at = nowISO();
          }
          result.overwritten++;
          return;
        }
        DB.kols.push({
          id: uid(), name, platform,
          homepage: item.homepage || '',
          followers: item.followers != null && item.followers !== '' ? Number(item.followers) : null,
          category: item.category || '',
          notes: item.notes || '',
          status: 'pending',
          created_at: nowISO(),
        });
        result.success++;
      } catch (e) {
        result.failed++;
        result.errors.push({ row: idx + 1, error: e.message });
      }
    });
    if (result.success || result.overwritten) saveData();
    return result;
  }

  function quickCreateKol({ name, platform, homepage }) {
    name = String(name || '').trim();
    if (!name) throw new Error('达人名不能为空');
    // upsert: 同名同平台返回已有
    const existing = DB.kols.find(
      (k) => k.name === name && (k.platform || '') === (platform || '')
    );
    if (existing) {
      if (homepage && !existing.homepage) {
        existing.homepage = homepage;
        existing.updated_at = nowISO();
        saveData();
      }
      return existing;
    }
    const row = {
      id: uid(),
      name,
      platform: platform || '',
      homepage: homepage || '',
      followers: null,
      category: '',
      status: 'pending',
      created_at: nowISO(),
    };
    DB.kols.push(row);
    saveData();
    return row;
  }

  /* ------------------------- 9. 月度规划三层 JOIN -------------------------
   * 这是模块的核心计算。详见交接文档 §7.2。
   * 行底 = 当前 active 的字典；预算层覆盖配置；排期层贡献"实际"统计。
   * cancelled 状态不计入实际。
   * 字典里没有但排期有的 → 作为"孤儿行"加到底部（categoryId=null）。
   */
  function getMonthlyBudgetRows(year, month) {
    const activeDirs = listDirections();
    const budgets = listBudgetsByMonth(year, month);
    const budgetByName = {};
    budgets.forEach((b) => { budgetByName[b.category] = b; });

    const schedules = listSchedulesByMonth(year, month);
    const actualByDir = {};
    schedules.forEach((s) => {
      if (s.status === 'cancelled') return;
      const k = s.category_direction || '';
      if (!actualByDir[k]) actualByDir[k] = { spent: 0, count: 0 };
      actualByDir[k].spent += Number(s.amount) || 0;
      actualByDir[k].count += 1;
    });

    const rows = activeDirs.map((d) => {
      const b = budgetByName[d.name];
      const actual = actualByDir[d.name] || { spent: 0, count: 0 };
      const budgetAmount = b ? Number(b.budget_amount) || 0 : 0;
      return {
        categoryId: d.id,
        category: d.name,
        shortName: d.name,
        budgetAmount,
        targetCount: b ? b.target_count : null,
        productLine: b ? b.product_line || '' : '',
        platform: b ? b.platform || '' : '',
        functionDisplay: b ? b.function_display || '' : '',
        requirements: b ? b.requirements || '' : '',
        actualSpent: actual.spent,
        actualCount: actual.count,
        gap: budgetAmount - actual.spent,
        hasBudgetRecord: !!b,
        isOrphan: false,
      };
    });

    // 孤儿行：字典里没有但排期里有
    Object.entries(actualByDir).forEach(([name, actual]) => {
      if (!name) return; // 空 category_direction 不算孤儿
      if (activeDirs.some((d) => d.name === name)) return;
      rows.push({
        categoryId: null,
        category: name,
        shortName: name,
        budgetAmount: 0,
        targetCount: null,
        productLine: '',
        platform: '',
        functionDisplay: '',
        requirements: '',
        actualSpent: actual.spent,
        actualCount: actual.count,
        gap: -actual.spent,
        hasBudgetRecord: false,
        isOrphan: true,
      });
    });

    const total = rows.reduce(
      (acc, r) => ({
        budget: acc.budget + r.budgetAmount,
        target: acc.target + (r.targetCount || 0),
        spent: acc.spent + r.actualSpent,
        count: acc.count + r.actualCount,
        gap: acc.gap + r.gap,
      }),
      { budget: 0, target: 0, spent: 0, count: 0, gap: 0 }
    );

    return { year, month, rows, total };
  }

  /* ------------------------- 9.5 批量导入 -------------------------
   * 去重键：(schedule_date, kol_name, category_direction)
   * conflictStrategy: 'skip' | 'overwrite' | 'fillEmpty'
   */
  function findDuplicate(item) {
    return DB.schedules.find(s =>
      !s.deleted_at &&
      s.schedule_date === item.schedule_date &&
      (s.kol_name || '') === (item.kol_name || '') &&
      (s.category_direction || '') === (item.category_direction || '')
    );
  }

  function batchCreateSchedules(items, { conflictStrategy = 'skip' } = {}) {
    const result = { success: 0, skipped: 0, overwritten: 0, failed: 0, errors: [] };
    items.forEach((item, idx) => {
      try {
        if (!item.schedule_date) throw new Error('日期为空');
        if (!item.kol_name) throw new Error('达人名为空');
        const dup = findDuplicate(item);
        if (dup) {
          if (conflictStrategy === 'skip') {
            result.skipped++;
            return;
          }
          if (conflictStrategy === 'overwrite') {
            Object.assign(dup, normalize(item), { updated_at: nowISO() });
            result.overwritten++;
            return;
          }
          if (conflictStrategy === 'fillEmpty') {
            // 只填空字段
            const n = normalize(item);
            for (const k of Object.keys(n)) {
              if (dup[k] === undefined || dup[k] === null || dup[k] === '' || dup[k] === 0) {
                dup[k] = n[k];
              }
            }
            dup.updated_at = nowISO();
            result.overwritten++;
            return;
          }
        }
        DB.schedules.push({ id: uid(), ...normalize(item), created_at: nowISO(), updated_at: nowISO() });
        result.success++;
      } catch (e) {
        result.failed++;
        result.errors.push({ row: idx + 1, error: e.message });
      }
    });
    if (result.success || result.overwritten) saveData();
    return result;
  }

  function normalize(item) {
    return {
      schedule_date: item.schedule_date || '',
      kol_name: String(item.kol_name || '').trim(),
      kol_id: item.kol_id || null,
      kol_homepage: item.kol_homepage || '',
      category_direction: item.category_direction || '',
      tier: item.tier || '',
      amount: Number(item.amount) || 0,
      platform: item.platform || '',
      status: item.status || 'planned',
      publish_url: item.publish_url || '',
      publish_date: item.publish_date || null,
      notes: item.notes || '',
      category: '',
    };
  }

  function recordImportLog(log) {
    const row = {
      id: uid(),
      filename: log.filename || '',
      total_rows: log.total_rows || 0,
      success_count: log.success_count || 0,
      skipped_count: log.skipped_count || 0,
      failed_count: log.failed_count || 0,
      errors: log.errors || [],
      created_at: nowISO(),
    };
    DB.schedule_import_logs.unshift(row);
    // 只保留最近 20 条
    if (DB.schedule_import_logs.length > 20) DB.schedule_import_logs.length = 20;
    saveData();
    return row;
  }

  /* ------------------------- 9.8 发货品类字典 CRUD ------------------------- */
  function listSampleProducts({ includeInactive = false } = {}) {
    const rows = DB.sample_products.slice();
    rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
    return includeInactive ? rows : rows.filter(p => p.is_active !== false);
  }
  function createSampleProduct(name) {
    name = String(name || '').trim();
    if (!name) throw new Error('品类名不能为空');
    if (DB.sample_products.find(p => p.name === name)) throw new Error('品类已存在');
    const maxOrder = DB.sample_products.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const row = { id: uid(), name, sort_order: maxOrder + 1, is_active: true, created_at: nowISO() };
    DB.sample_products.push(row);
    saveData();
    return row;
  }
  function updateSampleProduct(id, patch) {
    const p = DB.sample_products.find(x => x.id === id);
    if (!p) throw new Error('品类不存在');
    Object.assign(p, patch, { updated_at: nowISO() });
    saveData();
    return p;
  }
  function deleteSampleProduct(id) {
    const idx = DB.sample_products.findIndex(x => x.id === id);
    if (idx < 0) throw new Error('品类不存在');
    DB.sample_products.splice(idx, 1);
    saveData();
    return { ok: true };
  }

  /* ------------------------- 10. 权限 ------------------------- */
  // 当前账号体系只有 admin（角色="管理员"），其他角色待后续扩展
  function canEditBudget() {
    return !!window.currentUser; // 当前所有登录用户都可编辑；接入真后端时收紧
  }
  function canManageDict() { return !!window.currentUser; }

  /* ------------------------- 11. 导出 ------------------------- */
  /* ========== 冻结月份 ========== */
  function _monthKey(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  function isMonthFrozen(year, month) {
    return (DB.frozenMonths || []).includes(_monthKey(year, month));
  }
  function listFrozenMonths() {
    return (DB.frozenMonths || []).slice();
  }
  function freezeMonth(year, month) {
    const key = _monthKey(year, month);
    if (!(DB.frozenMonths || []).includes(key)) {
      if (!DB.frozenMonths) DB.frozenMonths = [];
      DB.frozenMonths.push(key);
      saveData();
    }
  }
  function unfreezeMonth(year, month) {
    const key = _monthKey(year, month);
    if (!DB.frozenMonths) return;
    DB.frozenMonths = DB.frozenMonths.filter(k => k !== key);
    saveData();
  }

  window.ScheduleData = {
    // utils
    uid, nowISO, ymd, pad2, monthRange, prevMonth, todayLocal,
    detectPlatformFromLink, addDays, fetchPlatformStats, checkAndUpdateDailyStats,
    // dict (达人类型)
    listDirections, findDirectionByName, createOrReactivateDirection,
    updateDirection, deactivateDirectionCascade, countDirectionUsage,
    // dict (产品线)
    listProductLines, findProductLineByName, createOrReactivateProductLine,
    updateProductLine, deactivateProductLine, countProductLineUsage,
    // dict (平台)
    listPlatforms, findPlatformByName, createOrReactivatePlatform,
    updatePlatform, deactivatePlatform, countPlatformUsage,
    // dict (层级)
    listTiers, findTierByName, createOrReactivateTier,
    updateTier, deactivateTier, countTierUsage,
    // dict (商务 BD)
    listBds, listBdPersonnel, findBdByName, findBdById, createOrReactivateBd,
    updateBd, deactivateBd, deleteBd, countBdUsage,
    // schedules
    listSchedulesInRange, listSchedulesByMonth,
    createSchedule, updateSchedule, deleteSchedule,
    // recycle bin
    listDeletedSchedules, restoreSchedule, permanentlyDeleteSchedule,
    emptyRecycleBin, cleanupExpiredRecycleBin,
    // budgets
    listBudgetsByMonth, upsertBudget, copyBudgetsFromLastMonth,
    // kols
    searchKols, quickCreateKol, listKols, getKolStats,
    createKol, updateKol, deleteKol, batchImportKols,
    // contents (传播执行)
    createContent, updateContent, deleteContent,
    listContents, resolveContent, getCommunicationKPI,
    autoPublishPastSchedules,
    getBrandRoiMatrix,
    // replacements (置换成本)
    listReplacements, createReplacement, updateReplacement, deleteReplacement,
    getReplacementKPI, REPLACEMENT_TYPES,
    // aggregate
    getMonthlyBudgetRows,
    // dict (发货品类)
    listSampleProducts, createSampleProduct, updateSampleProduct, deleteSampleProduct,
    // batch
    batchCreateSchedules, recordImportLog,
    // perms
    canEditBudget, canManageDict,
    // freeze
    isMonthFrozen, freezeMonth, unfreezeMonth, listFrozenMonths,
  };

  console.log('[ScheduleData] 已就绪',
    '字典', DB.schedule_directions.length,
    '排期', DB.schedules.length,
    '预算', DB.schedule_budgets.length,
    '达人', DB.kols.length);
})();
