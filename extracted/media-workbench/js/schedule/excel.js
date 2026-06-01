/* =====================================================================
 * 达人营销 · 内容排期模块 · Excel 解析器
 *
 * 提供：
 *   window.ScheduleExcel = {
 *     COLUMNS,           // 列定义
 *     STATUS_TO_LABEL, LABEL_TO_STATUS,
 *     parseDate, parseAmount, parseStatus, parseTier,
 *     parseFile(file)         → Promise<{ headers, rows }>
 *     buildTemplate()         → Workbook
 *     exportToWorkbook(rows)  → Workbook
 *     fuzzyMapping(headers)   → { [colKey]: headerName | null }
 *   }
 *
 * 参考交接文档 §7.1。
 * ===================================================================== */
(function () {
  const COLUMNS = [
    { key: 'schedule_date',      header: '日期',     required: true,  example: '2026-05-01' },
    { key: 'kol_name',           header: '达人名',   required: true,  example: '万万也没想到' },
    { key: 'category_direction', header: '达人类型', required: false, example: '弹唱' },
    { key: 'tier',               header: '层级',     required: false, example: '尾部' },
    { key: 'amount',             header: '费用',     required: true,  example: 500 },
    { key: 'platform',           header: '平台',     required: false, example: '抖音' },
    { key: 'status',             header: '状态',     required: false, example: '已结算' },
    { key: 'publish_url',        header: '发布链接', required: false, example: 'https://...' },
    { key: 'publish_date',       header: '发布日期', required: false, example: '2026-05-02' },
    { key: 'notes',              header: '备注',     required: false, example: '' },
  ];

  const STATUS_TO_LABEL = {
    planned: '计划中', published: '已发布', cancelled: '已取消',
  };
  const LABEL_TO_STATUS = {};
  Object.entries(STATUS_TO_LABEL).forEach(([k, v]) => { LABEL_TO_STATUS[v] = k; });
  // 兼容老数据
  LABEL_TO_STATUS['待策划'] = 'planned';

  const VALID_STATUS = new Set(Object.keys(STATUS_TO_LABEL));
  const TIER_VALUES = new Set(['头部', '中部', '腰部', '尾部', '素人']);

  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatYMD(y, m, d) {
    if (!y || !m || !d) return { ok: false, error: '日期格式不识别' };
    if (m < 1 || m > 12 || d < 1 || d > 31) return { ok: false, error: '日期超出范围' };
    return { ok: true, value: `${y}-${pad2(m)}-${pad2(d)}` };
  }

  /* ------------------------- parseDate ------------------------- */
  function parseDate(raw, contextYear) {
    if (raw === undefined || raw === null || raw === '') return { ok: false, error: '日期不能为空' };
    // Excel 数字序列号
    if (typeof raw === 'number') {
      const epoch = Date.UTC(1899, 11, 30);
      const d = new Date(epoch + raw * 86400000);
      if (isNaN(d.getTime())) return { ok: false, error: `日期序号「${raw}」无效` };
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }
    const s = String(raw).trim();
    let m;
    if ((m = s.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/))) {
      const y = contextYear ?? new Date().getFullYear();
      return formatYMD(y, +m[1], +m[2]);
    }
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
      return formatYMD(+m[1], +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/))) {
      const y = contextYear ?? new Date().getFullYear();
      return formatYMD(y, +m[1], +m[2]);
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) return { ok: true, value: d.toISOString().slice(0, 10) };
    return { ok: false, error: `日期「${s}」格式不识别` };
  }

  /* ------------------------- parseAmount ------------------------- */
  function parseAmount(raw) {
    if (raw === undefined || raw === null || raw === '') return { ok: false, error: '费用不能为空' };
    if (typeof raw === 'number') {
      if (raw < 0) return { ok: false, error: '费用不能为负' };
      return { ok: true, value: raw };
    }
    const s = String(raw).replace(/[¥￥,，\s元]/g, '').trim();
    const wanMatch = s.match(/^([\d.]+)\s*万$/);
    if (wanMatch) {
      const n = Number(wanMatch[1]) * 10000;
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `费用「${raw}」无效` };
      return { ok: true, value: n };
    }
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `费用「${raw}」无效` };
    return { ok: true, value: n };
  }

  /* ------------------------- parseStatus ------------------------- */
  function parseStatus(raw) {
    if (raw === undefined || raw === null || raw === '') return { ok: true, value: 'planned' };
    const s = String(raw).trim();
    if (VALID_STATUS.has(s)) return { ok: true, value: s };
    const v = LABEL_TO_STATUS[s];
    if (!v) return { ok: false, error: `状态「${s}」不识别` };
    return { ok: true, value: v };
  }

  /* ------------------------- parseTier ------------------------- */
  function parseTier(raw) {
    if (raw === undefined || raw === null || raw === '') return { ok: true, value: '' };
    const s = String(raw).trim();
    if (!TIER_VALUES.has(s)) return { ok: false, error: `层级「${s}」非法（应为：头部/中部/腰部/尾部/素人）` };
    return { ok: true, value: s };
  }

  /* ------------------------- parseFile ------------------------- */
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) return reject(new Error('Excel 文件没有 Sheet'));
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (!rows.length) return reject(new Error('Sheet 为空'));
          const headers = rows[0].map(h => String(h || '').trim()).filter(Boolean);
          const dataRows = rows.slice(1).filter(r => r.some(c => c !== '' && c !== null && c !== undefined));
          resolve({ headers, rows: dataRows });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsArrayBuffer(file);
    });
  }

  /* ------------------------- fuzzyMapping -------------------------
   * 启发式：精确匹配 → 包含匹配 → 别名表
   */
  const ALIASES = {
    schedule_date:      ['日期', '时间', '排期日期', 'date', '计划日期'],
    kol_name:           ['达人名', '达人', '博主', '昵称', 'kol'],
    category_direction: ['方向', '内容方向', '类型', '达人类型', 'category'],
    tier:               ['层级', '量级', '级别', 'tier'],
    amount:             ['费用', '价格', '金额', 'price', 'amount'],
    platform:           ['平台', '渠道', 'platform'],
    status:             ['状态', 'status'],
    publish_url:        ['发布链接', '链接', 'url', '视频链接'],
    publish_date:       ['发布日期', '实际日期', '上线日期'],
    notes:              ['备注', '说明', 'notes', 'remark'],
  };
  function fuzzyMapping(headers) {
    const map = {};
    COLUMNS.forEach(col => {
      let pick = null;
      const lc = headers.map(h => h.toLowerCase());
      // 1. exact
      pick = headers.find(h => h === col.header);
      // 2. alias exact
      if (!pick) {
        const aliases = ALIASES[col.key] || [];
        pick = headers.find(h => aliases.some(a => h === a || h.toLowerCase() === a.toLowerCase()));
      }
      // 3. contains
      if (!pick) {
        pick = headers.find(h => h.includes(col.header) || col.header.includes(h));
      }
      // 4. lowercase contains
      if (!pick) {
        const aliases = ALIASES[col.key] || [];
        pick = headers.find(h => aliases.some(a => h.toLowerCase().includes(a.toLowerCase())));
      }
      map[col.key] = pick || null;
    });
    return map;
  }

  /* ------------------------- 校验整行 ------------------------- */
  function validateRow(rawRow, mapping, headers, contextYear) {
    const errors = [];
    const out = {};
    const get = (key) => {
      const hdr = mapping[key];
      if (!hdr) return '';
      const idx = headers.indexOf(hdr);
      return idx >= 0 ? rawRow[idx] : '';
    };

    // 日期
    const dr = parseDate(get('schedule_date'), contextYear);
    if (!dr.ok) errors.push(`日期：${dr.error}`); else out.schedule_date = dr.value;

    // 达人名
    const name = String(get('kol_name') || '').trim();
    if (!name) errors.push('达人名不能为空'); else out.kol_name = name;

    // 费用
    const ar = parseAmount(get('amount'));
    if (!ar.ok) errors.push(`费用：${ar.error}`); else out.amount = ar.value;

    // 状态
    const sr = parseStatus(get('status'));
    if (!sr.ok) errors.push(`状态：${sr.error}`); else out.status = sr.value;

    // 层级
    const tr = parseTier(get('tier'));
    if (!tr.ok) errors.push(`层级：${tr.error}`); else out.tier = tr.value;

    out.category_direction = String(get('category_direction') || '').trim();
    out.platform = String(get('platform') || '').trim();
    out.publish_url = String(get('publish_url') || '').trim();

    const pdRaw = get('publish_date');
    if (pdRaw !== '' && pdRaw !== undefined && pdRaw !== null) {
      const pd = parseDate(pdRaw, contextYear);
      if (pd.ok) out.publish_date = pd.value;
      else errors.push(`发布日期：${pd.error}`);
    } else {
      out.publish_date = null;
    }

    out.notes = String(get('notes') || '');

    return { parsed: out, errors };
  }

  /* ------------------------- 模板 / 导出 ------------------------- */
  function buildTemplate() {
    const headers = COLUMNS.map(c => c.header);
    const example = COLUMNS.map(c => c.example);
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    // 列宽
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '排期数据');

    // 第 2 个 sheet：填写说明
    const help = [
      ['字段',         '是否必填', '说明'],
      ['日期',         '是',       '支持：2026-05-01 / 2026/5/1 / 5月1日 / Excel 日期单元格'],
      ['达人名',       '是',       '若库里没有同名达人，导入时会自动创建'],
      ['费用',         '是',       '元；支持 ￥500 / 500 / 5,000 / 5万'],
      ['达人类型',     '否',       '弹唱 / 弹奏 / 鼓棒 / 生活 / ... （字典里没有的会作为"孤儿行"显示在规划表）'],
      ['层级',         '否',       '头部 / 中部 / 腰部 / 尾部 / 素人'],
      ['平台',         '否',       '抖音 / 小红书 / 视频号 / B站 / 微博 / 快手'],
      ['状态',         '否',       '计划中 / 已发布 / 已取消（默认计划中）'],
      ['发布链接',     '否',       '只有状态 ≥ 已发布 时才有意义'],
      ['发布日期',     '否',       '同日期格式'],
      ['备注',         '否',       '任意文本'],
    ];
    const wsHelp = XLSX.utils.aoa_to_sheet(help);
    wsHelp['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsHelp, '填写说明');
    return wb;
  }

  function exportToWorkbook(schedules) {
    const data = [COLUMNS.map(c => c.header)];
    schedules.forEach(s => {
      data.push(COLUMNS.map(c => {
        if (c.key === 'status') return STATUS_TO_LABEL[s.status] || s.status || '';
        if (c.key === 'amount') return Number(s.amount) || 0;
        return s[c.key] != null ? s[c.key] : '';
      }));
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = COLUMNS.map(c => ({ wch: Math.max(c.header.length * 2 + 2, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '排期数据');
    return wb;
  }

  window.ScheduleExcel = {
    COLUMNS, STATUS_TO_LABEL, LABEL_TO_STATUS,
    parseDate, parseAmount, parseStatus, parseTier,
    parseFile, fuzzyMapping, validateRow,
    buildTemplate, exportToWorkbook,
  };
  console.log('[ScheduleExcel] 已就绪');
})();
