'use strict';
/* 汇率：中国外汇交易中心受权公布的人民币汇率中间价（USD/CNY）
 * 文件 exchange-rates.json 为全部组织共用：
 *   { USD: { 'YYYY-MM-DD': { rate, source: 'cfets'|'manual', cfets?, updated_at, by? } }, fetched_at }
 * 只记录公布日；周末/节假日由使用方沿用最近一个公布日（见 lookup）。
 * 手动录入优先于自动获取，自动获取不会覆盖手动值（原自动值保存在 cfets 字段）。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { atomicJson } = require('./organization-store');

const CFETS_URL = 'https://www.chinamoney.com.cn/ags/ms/cm-u-bk-ccpr/CcprHisNew';
const BACKFILL_FROM = '2025-01-01';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 北京时间的今天（服务器时区不一定是东八区）
function beijingToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function postJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Length': 0 } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; if (body.length > 2e6) req.destroy(new Error('响应过大')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('汇率接口返回 ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('汇率接口返回格式异常')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('汇率接口超时')));
    req.on('error', reject);
    req.end();
  });
}

// 拉取 [start, end] 区间的 USD/CNY 中间价，返回 { 'YYYY-MM-DD': 6.7152, ... }
async function fetchCfets(start, end, request = postJson) {
  const out = {};
  for (let page = 1; page <= 20; page++) {
    const qs = new URLSearchParams({ startDate: start, endDate: end, currency: 'USD/CNY', pageNum: String(page), pageSize: '50' });
    const json = await request(CFETS_URL + '?' + qs);
    for (const r of (json && json.records) || []) {
      const rate = Number(r && r.values && r.values[0]);
      if (DATE_RE.test(r.date) && rate > 0 && rate < 100) out[r.date] = rate;
    }
    const pageTotal = Number(json && json.data && json.data.pageTotal) || 1;
    if (page >= pageTotal) break;
  }
  return out;
}

function createExchangeRates(dataDir, { request, log = console } = {}) {
  const file = path.join(dataDir, 'exchange-rates.json');
  let store = { USD: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data.USD === 'object' && !Array.isArray(data.USD)) store = data;
  } catch (e) { if (e.code !== 'ENOENT') log.warn('[汇率] 文件读取失败，按空表处理：', e.message); }
  const save = () => atomicJson(file, store);

  function list() { return store.USD; }
  // 某日适用的汇率：当日公布值，否则沿用此前最近的公布日；早于最早记录时用最早一条
  function lookup(date) {
    const dates = Object.keys(store.USD).sort();
    if (!dates.length) return null;
    let hit = null;
    for (const d of dates) { if (d <= date) hit = d; else break; }
    const d = hit || dates[0];
    return { date: d, ...store.USD[d] };
  }
  function merge(rates) {
    let changed = 0;
    const now = new Date().toISOString();
    for (const [date, rate] of Object.entries(rates)) {
      const cur = store.USD[date];
      if (cur && cur.source === 'manual') { if (cur.cfets !== rate) { cur.cfets = rate; changed++; } continue; }
      if (!cur || cur.rate !== rate) { store.USD[date] = { rate, source: 'cfets', updated_at: now }; changed++; }
    }
    if (changed) { store.fetched_at = now; save(); }
    return changed;
  }
  async function refresh(start, end) {
    const rates = await fetchCfets(start, end, request);
    return merge(rates);
  }
  // 启动时补齐历史；之后每天补最近两周（覆盖节假日后补发、接口迟到）
  async function sync({ today = beijingToday() } = {}) {
    const known = Object.keys(store.USD).filter(d => store.USD[d].source === 'cfets').sort();
    let start = known.length ? addDays(known[known.length - 1], -14) : BACKFILL_FROM;
    let changed = 0;
    while (start <= today) {
      const end = addDays(start, 59) < today ? addDays(start, 59) : today;
      changed += await refresh(start, end);
      start = addDays(end, 1);
    }
    return changed;
  }
  function setManual(date, rate, by) {
    if (!DATE_RE.test(String(date))) throw new Error('日期格式应为 YYYY-MM-DD');
    rate = Number(rate);
    if (!(rate > 0 && rate < 100)) throw new Error('汇率需为大于0的数字');
    const cur = store.USD[date];
    store.USD[date] = { rate: Math.round(rate * 1e4) / 1e4, source: 'manual', cfets: cur ? (cur.source === 'manual' ? cur.cfets : cur.rate) : undefined,
      updated_at: new Date().toISOString(), by: by || '' };
    save();
    return store.USD[date];
  }
  // 删除手动值：有自动值则恢复自动值，否则整条删除
  function clearManual(date) {
    const cur = store.USD[date];
    if (!cur || cur.source !== 'manual') return null;
    if (cur.cfets != null) store.USD[date] = { rate: cur.cfets, source: 'cfets', updated_at: new Date().toISOString() };
    else delete store.USD[date];
    save();
    return store.USD[date] || null;
  }
  return { list, lookup, merge, refresh, sync, setManual, clearManual };
}

module.exports = { createExchangeRates, fetchCfets };
