'use strict';
// 按人只读开放接口：Cowork 访问密钥 / popumind 身份断言都交给 Cowork 验证，按绑定的品宣账号返回本组织数据。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { emptyData, createOrganizationStore, atomicJson } = require('../organization-store');
const { registerOpenApi } = require('../open-api');

const ENV = { OIDC_ISSUER: 'https://cowork.test/oidc', OIDC_CLIENT_ID: 'pinxuan', OIDC_CLIENT_SECRET: 'test-client-secret' };
const KEY = 'cwk_' + 'a'.repeat(43);
const OVERSEAS_KEY = 'cwk_' + 'b'.repeat(43);
const UNBOUND_KEY = 'cwk_' + 'c'.repeat(43);
const ASSERTION = 'aaa.bbb.ccc';

function setupStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinxuan-open-api-test-'));
  const d = emptyData('domestic');
  d.bds = [{ id: 1, name: '张三', password: 'pw-zhang' }, { id: 2, name: '李四', password: 'pw-li' }];
  d.supervisors = [{ id: 's1', name: '王主管', password: 'pw-wang' }];
  d.kols = [
    { id: 'k1', name: '小鱼弹琴', platform: '抖音', homepage: 'https://douyin.example/1', followers: 12.5, category: '钢琴', notes: '回复快', bd_id: 1, status: 'pending' },
    { id: 'k2', name: '阿木吉他', platform: '小红书', homepage: '', followers: 3, category: '吉他', notes: '', bd_id: 2, status: 'pending' },
  ];
  d.schedules = [
    { id: 'sc1', schedule_date: '2026-11-03', kol_name: '小鱼弹琴', kol_id: 'k1', bd_id: 1, platform: '抖音', category_direction: '钢琴', work_type: '口播', amount: 3000, status: 'published', confirmed: true, publish_url: 'https://v.example/1', publish_date: '2026-11-05' },
    { id: 'sc2', schedule_date: '2026-11-20', kol_name: '小鱼弹琴', kol_id: 'k1', bd_id: 1, platform: '抖音', amount: 2000, status: 'planned' },
    { id: 'sc3', schedule_date: '2026-10-01', kol_name: '阿木吉他', kol_id: 'k2', bd_id: 2, platform: '小红书', amount: 800, status: 'cancelled' },
    { id: 'sc4', schedule_date: '2026-11-10', kol_name: '阿木吉他', kol_id: 'k2', bd_id: 2, amount: 900, status: 'planned', deleted_at: '2026-11-11' },
  ];
  d.contents = [{ id: 'c1', schedule_id: 'sc1', kol_name: '小鱼弹琴', kol_id: 'k1', bd_id: 1, price: 3000, work_type: '口播',
    publications: [{ id: 'p1', platform: '抖音', date: '2026-11-05', link: 'https://v.example/1', views: 8.2, likes: 900, comments: 40, shares: 12, collects: 30, promo_cost: 500, daily_stats: [{ d: 1 }] }] }];
  d.samples = [{ id: 7, talent: '小鱼弹琴', date: '2026-11-01', contact: 1, product: ['音乐密码2'], recipient_name: '收件人甲', phone: '13800000000', address: '某市某路 1 号',
    note: '白色', status: 'awaiting', tracking: 'SF123', gift_cost: 199 }];
  d.settlements = [{ id: 5, schedule_id: 'sc1', content_id: 'c1', kol_name: '小鱼弹琴', platform: '抖音', publish_date: '2026-11-05', contract_amount: 3000, amount: 3000,
    payments: [{ label: '尾款', amount: 3000, plan_date: '2026-11-30', status: '待付' }], invoice: '未开票', account: '星图', status: '待结算' }];
  atomicJson(path.join(root, 'db.json'), d);
  const organizations = createOrganizationStore(root, 'test-admin-pass');
  const overseas = emptyData('overseas');
  overseas.bds = [{ id: 9, name: 'Tom', password: 'pw-tom' }];
  overseas.kols = [{ id: 'o1', name: 'PianoTom', platform: 'TikTok', bd_id: 9 }];
  atomicJson(path.join(root, 'organizations', 'overseas', 'db.json'), overseas);
  return { root, organizations };
}

/** 假的 Cowork 验证接口：按凭证返回绑定的品宣账号 */
function fakeCowork() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, auth: init.headers.authorization, body });
    if (body.key === KEY) return new Response(JSON.stringify({ active: true, username: '张三', keyId: 'key-1234567890', keyName: 'claude', readOnly: true }));
    if (body.key === OVERSEAS_KEY) return new Response(JSON.stringify({ active: true, username: '海外品宣部门/Tom', keyId: 'key-tom', keyName: 'x', readOnly: false }));
    if (body.key === UNBOUND_KEY) return new Response(JSON.stringify({ active: false, reason: 'not_bound' }));
    if (body.assertion === ASSERTION) return new Response(JSON.stringify({ active: true, username: '王主管', readOnly: true, via: { agent: '花小秘', run: 'r_1', tenant: 't' }, confirmed: false }));
    return new Response(JSON.stringify({ active: false, reason: 'invalid' }));
  };
  return { calls, fetchImpl };
}

async function start(t, { env = ENV } = {}) {
  const { root, organizations } = setupStore();
  const cowork = fakeCowork();
  const logs = [];
  const app = express();
  registerOpenApi(app, { organizations, env, fetch: cowork.fetchImpl, log: line => logs.push(line) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (p, headers = {}) => fetch(base + p, { headers });
  const as = (p, key = KEY) => get(p, { authorization: 'Bearer ' + key });
  return { get, as, cowork, logs, base };
}

test('没带凭证、凭证无效、没绑定账号都拒绝；只接受 GET', async t => {
  const { get, as, base } = await start(t);
  const none = await get('/api/open/kols');
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate') || '', /Bearer/);
  assert.equal((await as('/api/open/kols', 'cwk_' + 'z'.repeat(43))).status, 401);
  assert.equal((await as('/api/open/kols', 'not-a-key')).status, 401);
  const unbound = await as('/api/open/kols', UNBOUND_KEY);
  assert.equal(unbound.status, 401);
  assert.match((await unbound.json()).error, /绑定/);
  assert.equal((await fetch(base + '/api/open/kols', { method: 'POST', headers: { authorization: 'Bearer ' + KEY } })).status, 405);
  assert.equal((await as('/api/open/nope')).status, 404);
  assert.equal((await as('/api/open/kols')).headers.get('cache-control'), 'no-store');
});

test('没配统一登录时 503，不放行', async t => {
  const { as } = await start(t, { env: {} });
  const res = await as('/api/open/kols');
  assert.equal(res.status, 503);
});

test('访问密钥：交给 Cowork 验证，按绑定账号所在组织返回达人，带负责人和合作统计', async t => {
  const { as, cowork, logs } = await start(t);
  const res = await as('/api/open/kols?q=小鱼');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(cowork.calls[0].url, 'https://cowork.test/sso/keys/verify');
  assert.equal(cowork.calls[0].auth, 'Basic ' + Buffer.from('pinxuan:test-client-secret').toString('base64'));
  assert.deepEqual(body.organization, { id: 'domestic', name: '国内品宣部门' });
  assert.equal(body.currency, 'CNY');
  assert.equal(body.total, 1);
  const kol = body.rows[0];
  assert.equal(kol.owner, '张三');
  assert.deepEqual(kol.stats, { count: 2, totalAmount: 5000, firstDate: '2026-11-03', lastDate: '2026-11-20' }, '已取消、已删除的排期不算');
  assert.match(logs[0], /张三.*key:key-1234/);

  const byOwner = await (await as('/api/open/kols?owner=李四')).json();
  assert.deepEqual(byOwner.rows.map(r => r.name), ['阿木吉他']);
  await as('/api/open/kols');
  assert.equal(cowork.calls.length, 1, '验证结果缓存');
});

test('身份断言：按断言里的人返回，日志记经由哪个 agent', async t => {
  const { get, logs } = await start(t);
  const res = await get('/api/open/schedules?from=2026-11-01&to=2026-11-30', { 'x-popu-mind-assertion': ASSERTION });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.rows.map(r => r.id), ['sc2', 'sc1'], '新的在前，已删除的不出现');
  assert.equal(body.rows[1].owner, '张三');
  assert.equal(body.rows[1].amount, 3000);
  assert.match(logs[0], /王主管.*agent:花小秘.*run:r_1/);
  assert.equal((await get('/api/open/kols', { 'x-popu-mind-assertion': 'bad' })).status, 401);
});

test('排期按状态和达人筛选；分页', async t => {
  const { as } = await start(t);
  const planned = await (await as('/api/open/schedules?status=planned')).json();
  assert.deepEqual(planned.rows.map(r => r.id), ['sc2']);
  const page = await (await as('/api/open/schedules?take=1&skip=1')).json();
  assert.equal(page.total, 3);
  assert.equal(page.rows.length, 1);
  assert.equal((await as('/api/open/schedules?take=0')).status, 400);
  assert.equal((await as('/api/open/schedules?from=11-01')).status, 400);
});

test('内容发布带各平台数据；样品不给收件人、电话、地址', async t => {
  const { as } = await start(t);
  const contents = await (await as('/api/open/contents?kol=小鱼弹琴')).json();
  const pub = contents.rows[0].publications[0];
  assert.equal(pub.views, 8.2);
  assert.equal(pub.promo_cost, 500);
  assert.equal(pub.daily_stats, undefined, '逐日数据不给');

  const samples = await (await as('/api/open/samples')).json();
  const sample = samples.rows[0];
  assert.equal(sample.owner, '张三');
  assert.equal(sample.status, 'awaiting');
  for (const field of ['recipient_name', 'phone', 'address']) assert.equal(sample[field], undefined, field);
  assert.doesNotMatch(JSON.stringify(samples), /13800000000|某市/);
});

test('结算给状态、金额和付款计划，不给收款账户；也不暴露人员密码', async t => {
  const { as } = await start(t);
  const body = await (await as('/api/open/settlements')).json();
  const row = body.rows[0];
  assert.equal(row.status, '待结算');
  assert.equal(row.contract_amount, 3000);
  assert.equal(row.payments[0].plan_date, '2026-11-30');
  assert.equal(row.account, undefined);
  for (const p of ['/api/open/kols', '/api/open/schedules', '/api/open/contents', '/api/open/samples', '/api/open/settlements']) {
    assert.doesNotMatch(await (await as(p)).text(), /pw-/, p);
  }
});

test('其他组织的人只看到自己组织的数据，金额币种按组织', async t => {
  const { as } = await start(t);
  const body = await (await as('/api/open/kols', OVERSEAS_KEY)).json();
  assert.equal(body.organization.id, 'overseas');
  assert.equal(body.currency, 'USD');
  assert.deepEqual(body.rows.map(r => r.name), ['PianoTom']);
});

test('服务器 Node 太老（没有全局 fetch 和 AbortSignal.timeout）时照常启动，开放接口返回 503', async () => {
  const { execFileSync } = require('node:child_process');
  // 在子进程里去掉这两个全局，模拟 Node 14；用 http 模块发请求
  const script = `
    delete globalThis.fetch; delete AbortSignal.timeout;
    const express = require('express'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
    const { emptyData, createOrganizationStore, atomicJson } = require('./organization-store');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinxuan-old-node-'));
    atomicJson(path.join(root, 'db.json'), emptyData('domestic'));
    const app = express();
    require('./open-api').registerOpenApi(app, { organizations: createOrganizationStore(root, 'x'), env: ${JSON.stringify(ENV)}, log: () => {} });
    const server = app.listen(0, '127.0.0.1', () => {
      http.get({ port: server.address().port, path: '/api/open/kols', headers: { authorization: 'Bearer ${KEY}' } }, res => {
        process.stdout.write(String(res.statusCode)); server.close(); fs.rmSync(root, { recursive: true, force: true });
      });
    });`;
  assert.equal(execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..') }).toString(), '503');
});
