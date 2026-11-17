'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { emptyData, createOrganizationStore } = require('../organization-store');
const clone = data => JSON.parse(JSON.stringify(data));

test('organization auth, persistence, merging, exports and restart isolation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinxuan-org-test-'));
  const adminPass = 'test-admin-' + Date.now();
  const integrationToken = require('node:crypto').randomBytes(32).toString('hex');
  const data = emptyData('domestic');
  data.bds = [{id:123, name:'测试国内员工', password:'test-bd', is_active:true}];
  data.supervisors = [{id:'sv1',name:'测试国内主管',password:'test-sv'}];
  data.kols = [{id:'k1',name:'测试国内达人'}];
  data.contents = [{id:'c1',kol_name:'测试国内达人',publications:[{id:'p1',platform:'抖音',date:'2026-11-16',link:'https://example.com/domestic'}]}];
  const domesticText = JSON.stringify(data);
  fs.writeFileSync(path.join(root,'db.json'), domesticText);
  let child, base, output = '';
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd:path.resolve(__dirname,'..'), env:{...process.env,
      NODE_ENV:'test',PORT:'0',HOST:'127.0.0.1',DATA_DIR:root,ADMIN_PASS:adminPass,AUTH_TOKEN:'test-legacy-token',CONTENT_SYNC_TOKEN:integrationToken,LOCAL_PREVIEW:'1'}, stdio:['ignore','pipe','pipe'] });
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    for (let i=0;i<100;i++) {
      if (child.exitCode !== null) throw new Error('Test server exited: '+output);
      const m = output.match(/TEST_LISTEN_PORT=(\d+)/);
      if (m) { base='http://127.0.0.1:'+m[1]; return; }
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error('Test server not ready: '+output);
  }
  async function stop() { if (child && child.exitCode === null) { child.kill(); await once(child,'exit'); } }
  t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
  async function api(url,{token,org,body,method,cookie,extraHeaders={}}={}) {
    const headers = {'Content-Type':'application/json',...extraHeaders};
    if(cookie) headers.cookie=cookie;
    if(token) headers['x-auth-token']=token;
    if(org) headers['x-organization-id']=org;
    const res = await fetch(base+url,{method:method || (body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});
    return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};
  }
  async function login(org,identity,password) {
    const r=await api('/api/login',{body:{organization:org,identity,password}});assert.equal(r.status,200);return r.body.token;
  }
  const save = (db,token,extra={}) => api('/api/data',{token,body:{...clone(db),_baseRev:db._rev,...extra}});
  await start();
  // Login must remain private while large HTML/data responses use compression.
  const home = await fetch(base+'/', {headers:{'Accept-Encoding':'gzip'}});
  assert.equal(home.headers.get('content-encoding'),'gzip');
  assert.equal(home.headers.get('cache-control'),'no-cache');
  assert.match(await home.text(), /<title>离火品宣<\/title>/);
  const asset = await fetch(base+'/js/organizations.js?v=4', {headers:{'Accept-Encoding':'gzip'}});
  assert.equal(asset.headers.get('content-encoding'),'gzip');
  assert.equal(asset.headers.get('cache-control'),'public, max-age=31536000, immutable');
  await asset.text();
  const unversioned = await fetch(base+'/js/organizations.js');
  assert.ok(!unversioned.headers.get('cache-control').includes('immutable'));
  await unversioned.text();
  const orgs=await api('/api/organizations');assert.equal(orgs.body.length,2);
  assert.equal(fs.readFileSync(path.join(root,'db.json'),'utf8'),domesticText,'startup preserves domestic file exactly');
  assert.equal(fs.readFileSync(path.join(root,'before-organizations.json'),'utf8'),domesticText,'migration archive preserves original bytes');
  const ad=await login('domestic','admin',adminPass), ao=await login('overseas','admin',adminPass);
  const compressedData = await fetch(base+'/api/data', {headers:{'x-auth-token':ad,'Accept-Encoding':'gzip'}});
  assert.equal(compressedData.headers.get('content-encoding'),'gzip');
  assert.equal(compressedData.headers.get('cache-control'),'no-store');
  assert.equal((await compressedData.json())._organization_id,'domestic');
  const sessionResponse = await fetch(base+'/api/session', {headers:{'x-auth-token':ad,'Accept-Encoding':'gzip'}});
  assert.equal(sessionResponse.headers.get('content-encoding'),null);
  assert.equal(sessionResponse.headers.get('cache-control'),'no-store');
  await sessionResponse.json();
  const bd=await login('domestic','bd__123','test-bd');
  const sv=await login('domestic','sv__sv1','test-sv');
  assert.equal((await api('/api/login',{body:{organization:'overseas',identity:'bd__123',password:'test-bd'}})).status,401);
  const opts=await api('/api/login-options?organization=overseas');assert.deepEqual(opts.body.map(o=>o.value),['admin']);
  assert.equal((await api('/api/data',{token:'test-legacy-token'})).status,401);
  assert.equal((await api('/api/data',{token:bd,org:'overseas'})).status,403);
  assert.equal((await api('/api/organizations',{token:bd,body:{name:'无权限',region:'overseas'}})).status,403);
  assert.equal((await api('/api/organizations/switch',{token:sv,body:{organization:'overseas'}})).status,403);
  const switched=await api('/api/organizations/switch',{token:ad,body:{organization:'overseas'}});assert.equal(switched.body.user.organization.id,'overseas');
  const domestic=(await api('/api/data',{token:ad})).body, overseas=(await api('/api/data',{token:ao})).body;
  assert.equal(overseas.contents.length,0);assert.equal(overseas.bds.length,0);
  assert.ok(overseas.platforms.some(p=>p.name==='TikTok'));
  assert.equal((await api('/api/data',{token:bd})).body.bds[0].password,undefined);
  assert.equal((await save(domestic,ao)).status,403,'cannot send a domestic snapshot into overseas');
  assert.equal((await save(overseas,ao,{_base:domestic})).status,403,'cross-org merge base rejected');
  overseas.kols.push({id:'ko',name:'测试海外达人'});
  overseas.contents.push({id:'co',kol_name:'测试海外达人',publications:[{id:'po',platform:'TikTok',date:'2026-11-16',link:'https://example.com/overseas'}]});
  overseas.bds.push({id:123,name:'测试海外员工',password:'test-overseas'});
  assert.equal((await save(overseas,ao)).status,200);
  assert.equal((await api('/api/data',{token:ad})).body.contents.length,1);
  assert.equal((await api('/api/data',{token:ad})).body._rev,domestic._rev,'overseas save does not advance domestic revision');
  const ob=await login('overseas','bd__123','test-overseas');
  assert.equal((await api('/api/login',{body:{organization:'overseas',identity:'bd__123',password:'test-bd'}})).status,401);
  let odb=(await api('/api/data',{token:ob})).body;odb.bds[0].password='attempted-change';
  assert.equal((await save(odb,ob)).status,200);await login('overseas','bd__123','test-overseas');
  const a=clone(domestic),b=clone(domestic);a.kols[0].name='国内A修改';b.samples.push({id:'s1',name:'国内B新增'});
  assert.equal((await save(a,ad)).status,200);
  const merged=await save(b,ad);assert.equal(merged.status,200);assert.equal(merged.body.merged,true);
  const latest=(await api('/api/data',{token:ad})).body;assert.equal(latest.kols[0].name,'国内A修改');assert.equal(latest.samples.length,1);
  assert.equal((await save(latest,ad,{_baseRev:9999})).status,409);
  const rescue=await save(latest,ad,{_baseRev:9999,_base:latest});assert.equal(rescue.status,200);
  assert.equal((await api('/api/data',{token:ad,body:{_organization_id:'domestic',_epoch:latest._epoch,_baseRev:latest._rev}})).status,409);
  const dl=await api('/api/logs',{token:ad}),ol=await api('/api/logs',{token:ao});
  assert.ok(!JSON.stringify(dl.body).includes('测试海外达人'));assert.ok(JSON.stringify(ol.body).includes('测试海外达人'));
  assert.equal((await api('/api/backups',{token:bd})).status,403);
  const backups=await api('/api/backups',{token:ao});assert.ok(backups.body.length>0);
  const backup=await api('/api/backups/'+backups.body[0].filename,{token:ao});assert.equal(backup.body._organization_id,'overseas');assert.equal(backup.body.contents[0].id,'co');
  const email={enabled:false,senderEmail:'test@example.com',senderPass:'test-mail-password',recipients:[]};
  assert.equal((await api('/api/email-config',{token:ao,body:email})).status,200);
  assert.equal((await api('/api/email-config',{token:ad})).body.senderEmail,undefined);
  assert.equal((await api('/api/email-config',{token:ao})).body.senderPass,'••••••••');
  const integration=await fetch(base+'/api/integrations/v1/content-publications',{headers:{Authorization:'Bearer '+integrationToken}});
  assert.equal(integration.status,200);const external=await integration.text();assert.ok(external.includes('测试国内达人'));assert.ok(!external.includes('测试海外达人'));
  const created=await api('/api/organizations',{token:ad,body:{name:'测试第三组织',region:'overseas'}});assert.equal(created.status,201);
  assert.equal((await api('/api/organizations',{token:ad,body:{name:'测试第三组织',region:'overseas'}})).status,400);
  const third=await login(created.body.id,'admin',adminPass);assert.equal((await api('/api/data',{token:third})).body.contents.length,0);
  // Remembering is opt-in and restores an organization-bound tab token, never a password.
  const actionHeaders={'x-login-action':'1','x-forwarded-proto':'https'};
  const remembered=await api('/api/login',{body:{organization:'domestic',identity:'admin',password:adminPass,remember:true},extraHeaders:actionHeaders});
  assert.match(remembered.cookie,/^__Host-pinxuan_remember=/);
  assert.match(remembered.cookie,/HttpOnly/);assert.match(remembered.cookie,/Secure/);assert.match(remembered.cookie,/SameSite=Strict/);
  assert.ok(!remembered.cookie.includes(adminPass));
  const days=Number(remembered.cookie.match(/Max-Age=(\d+)/)[1]);assert.ok(days>=2591990&&days<=2592000);
  const cookie=remembered.cookie.split(';')[0];
  assert.equal((await api('/api/data',{cookie,extraHeaders:actionHeaders})).status,401,'cookie cannot directly authorize business requests');
  assert.equal((await api('/api/data',{token:cookie.split('=')[1]})).status,401,'remember credential is not an API token');
  assert.equal((await api('/api/session/restore',{method:'POST',cookie})).status,403);
  assert.equal((await api('/api/session/restore',{method:'POST',cookie,extraHeaders:{...actionHeaders,origin:'https://unrelated.example'}})).status,403);
  assert.equal((await api('/api/login',{body:{identity:'admin',password:adminPass},extraHeaders:{origin:'https://unrelated.example'}})).status,403);
  const restored=await api('/api/session/restore',{method:'POST',cookie,extraHeaders:actionHeaders});
  assert.equal(restored.body.user.organization.id,'domestic');assert.equal((await api('/api/session',{token:restored.body.token})).status,200);
  const switchedRemember=await api('/api/organizations/switch',{token:restored.body.token,cookie,extraHeaders:actionHeaders,body:{organization:'overseas'}});
  const overseasCookie=switchedRemember.cookie.split(';')[0];
  const claims=c=>JSON.parse(Buffer.from(decodeURIComponent(c.split('=')[1]).split('~')[0].split('.')[0],'base64url'));
  assert.equal(claims(overseasCookie).exp,claims(cookie).exp,'switching does not extend 30-day deadline');
  assert.equal((await api('/api/session/restore',{method:'POST',cookie:overseasCookie,extraHeaders:actionHeaders})).body.user.organization.id,'overseas');
  const unchecked=await api('/api/login',{cookie,extraHeaders:actionHeaders,body:{identity:'admin',password:adminPass,remember:false}});
  assert.match(unchecked.cookie,/Expires=.*1970/);
  assert.equal((await api('/api/session/restore',{method:'POST',cookie:unchecked.cookie.split(';')[0],extraHeaders:actionHeaders})).body.user,null);
  // 普通退出暂停自动进入，但保留已验证凭据；继续登录必须绑定原组织/账号。
  const paused=await api('/api/logout',{cookie,extraHeaders:actionHeaders,body:{keepRemembered:true}});
  assert.equal(paused.status,200);assert.match(paused.cookie,/^__Host-pinxuan_remember_paused=1/);
  assert.match(paused.cookie,/HttpOnly/);assert.match(paused.cookie,/Secure/);
  const pausedCookie=cookie+'; '+paused.cookie.split(';')[0];
  const pausedRestore=await api('/api/session/restore',{method:'POST',cookie:pausedCookie,extraHeaders:actionHeaders});
  assert.deepEqual(pausedRestore.body,{user:null,remembered:[{organization:'domestic',identity:'admin'}]});
  assert.equal((await api('/api/data',{cookie:pausedCookie,extraHeaders:actionHeaders})).status,401);
  const resumeBody={organization:'domestic',identity:'admin',remember:true};
  assert.equal((await api('/api/session/resume',{cookie:pausedCookie,body:resumeBody})).status,403);
  assert.equal((await api('/api/session/resume',{cookie:pausedCookie,body:resumeBody,extraHeaders:{...actionHeaders,origin:'https://unrelated.example'}})).status,403);
  assert.equal((await api('/api/session/resume',{body:resumeBody,extraHeaders:actionHeaders})).status,401);
  for (const other of [{organization:'overseas'},{identity:'bd__123'}]) {
    const denied=await api('/api/session/resume',{cookie:pausedCookie,extraHeaders:actionHeaders,body:{...resumeBody,...other}});
    assert.equal(denied.status,403);assert.equal(denied.body.token,undefined);
  }
  const resumed=await api('/api/session/resume',{cookie:pausedCookie,extraHeaders:actionHeaders,body:resumeBody});
  assert.equal(resumed.status,200);assert.equal((await api('/api/session',{token:resumed.body.token})).status,200);
  assert.match(resumed.cookie,/__Host-pinxuan_remember_paused=;/);
  assert.match(resumed.cookie,/Expires=.*1970/);
  assert.ok(resumed.cookie.includes(cookie+';'),'continuing only reorders the original remember credential, never replaces/extends it');
  const resumedClaims=JSON.parse(Buffer.from(resumed.body.token.split('.')[0],'base64url'));
  assert.ok(resumedClaims.exp<=claims(cookie).exp);
  const resumeUnchecked=await api('/api/session/resume',{cookie:pausedCookie,extraHeaders:actionHeaders,body:{...resumeBody,remember:false}});
  assert.equal(resumeUnchecked.status,200);assert.match(resumeUnchecked.cookie,/^__Host-pinxuan_remember=;/);
  assert.equal((await api('/api/session/resume',{cookie:resumeUnchecked.cookie.split(';')[0],extraHeaders:actionHeaders,body:resumeBody})).status,401);
  const logout=await api('/api/logout',{method:'POST',cookie,extraHeaders:actionHeaders});assert.match(logout.cookie,/Expires=.*1970/);
  assert.equal((await api('/api/session/restore',{method:'POST',cookie:logout.cookie.split(';')[0],extraHeaders:actionHeaders})).body.user,null);
  const invalid=await api('/api/session/restore',{method:'POST',cookie:cookie+'invalid',extraHeaders:actionHeaders});assert.equal(invalid.body.user,null);assert.match(invalid.cookie,/Expires=.*1970/);
  // 多账号记住：每个组织/身份各存一张凭据，互不覆盖；忘记或取消勾选只影响该账号。
  const bdAccount={organization:'overseas',identity:'bd__123'}, adminAccount={organization:'domestic',identity:'admin'};
  const both=(await api('/api/login',{cookie,extraHeaders:actionHeaders,body:{...bdAccount,password:'test-overseas',remember:true}})).cookie.split(';')[0];
  assert.equal(decodeURIComponent(both.split('=')[1]).split('~').length,2,'second account is added, first is kept');
  assert.equal(claims(both).org,'overseas','most recent login comes first');
  const bothPaused=both+'; '+(await api('/api/logout',{cookie:both,extraHeaders:actionHeaders,body:{keepRemembered:true}})).cookie.split(';')[0];
  assert.deepEqual((await api('/api/session/restore',{method:'POST',cookie:bothPaused,extraHeaders:actionHeaders})).body,{user:null,remembered:[bdAccount,adminAccount]});
  for (const account of [adminAccount,bdAccount]) {
    const r=await api('/api/session/resume',{cookie:bothPaused,extraHeaders:actionHeaders,body:{...account,remember:true}});
    assert.equal(r.status,200);assert.equal(r.body.user.organization.id,account.organization,'each remembered account resumes without password');
  }
  assert.equal(claims((await api('/api/session/resume',{cookie:bothPaused,extraHeaders:actionHeaders,body:{...adminAccount,remember:true}})).cookie.split(';')[0]).org,'domestic','resumed account moves to front');
  const forgotBd=(await api('/api/logout',{cookie:both,extraHeaders:actionHeaders,body:bdAccount})).cookie.split(';')[0];
  assert.deepEqual((await api('/api/session/restore',{method:'POST',cookie:forgotBd+'; '+paused.cookie.split(';')[0],extraHeaders:actionHeaders})).body.remembered,[adminAccount],'forgetting one account keeps the other');
  const uncheckedAdmin=(await api('/api/login',{cookie:both,extraHeaders:actionHeaders,body:{...adminAccount,password:adminPass,remember:false}})).cookie.split(';')[0];
  assert.equal(claims(uncheckedAdmin).org,'overseas','unchecking remember only removes that account');
  assert.equal((await api('/api/session/resume',{cookie:uncheckedAdmin,extraHeaders:actionHeaders,body:{...adminAccount,remember:true}})).status,403);
  const rememberedMember=await api('/api/login',{body:{organization:'overseas',identity:'bd__123',password:'test-overseas',remember:true},extraHeaders:actionHeaders});
  const memberCookie=rememberedMember.cookie.split(';')[0];
  const beforeRestart=(await api('/api/data',{token:ad})).body;
  await stop();output='';await start();
  assert.equal((await api('/api/session',{token:ad})).status,200,'session survives restart');
  assert.equal((await api('/api/session/restore',{method:'POST',cookie,extraHeaders:actionHeaders})).body.user.organization.id,'domestic','remembered login survives service restart');
  const afterRestart=(await api('/api/data',{token:ad})).body;
  assert.notEqual(beforeRestart._epoch,afterRestart._epoch);
  assert.equal((await save(beforeRestart,ad,{_baseRev:afterRestart._rev})).status,409,'same rev after restart is not same baseline');
  assert.equal((await save(beforeRestart,ad,{_baseRev:afterRestart._rev,_base:beforeRestart})).status,200);
  let disabled=(await api('/api/data',{token:ao})).body;disabled.bds[0].is_active=false;await save(disabled,ao);
  assert.equal((await api('/api/session',{token:ob})).status,401,'disabled member session revoked');
  assert.equal((await api('/api/session/restore',{method:'POST',cookie:memberCookie,extraHeaders:actionHeaders})).body.user,null,'disabled member cannot use remembered login');
  assert.equal((await api('/api/session/resume',{cookie:memberCookie,extraHeaders:actionHeaders,body:{organization:'overseas',identity:'bd__123',remember:true}})).status,401,'disabled member cannot click to resume');
  fs.writeFileSync(path.join(root,'organizations','overseas','db.json'),'{broken');
  assert.equal((await api('/api/data',{token:ao})).status,500,'corrupt data is not treated as empty');
  assert.equal((await api('/api/data',{token:ad})).status,200,'another org remains usable');
  fs.unlinkSync(path.join(root,'db.json'));
  assert.equal((await api('/api/data',{token:ad})).status,500,'missing domestic data is not silently replaced');
});

test('registry and session secret persist; names and ids cannot escape storage', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinxuan-registry-test-'));
  try {
    const store=createOrganizationStore(root,'test-pass');
    assert.throws(()=>store.context('../domestic'));
    assert.throws(()=>store.create('', 'overseas'));
    assert.throws(()=>store.create('valid','../../outside'));
    const org=store.create('国际业务', 'overseas');
    assert.match(org.id,/^org-[a-f0-9]+$/);
    const token=store.login(org.id,'admin','test-pass').token;
    const reopened=createOrganizationStore(root,'test-pass');
    assert.equal(reopened.authenticate(token).user.organization.name,'国际业务');
    assert.equal(reopened.authenticate(token+'x'),null);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});


test('data-layer initialization never wipes real records without historical flags', () => {
  const vm = require('node:vm');
  const data = emptyData('overseas');
  delete data._wiped_demo_data_2026_05_11;
  delete data._wiped_phase1_modules_2026_05_11;
  delete data._comms_v2_2026_05_15;
  data._organization = {id:'overseas',region:'overseas'};
  data.kols = [{id:'k',name:'保留达人'}];
  data.contents = [{id:'c',kol_name:'保留内容',publications:[]}];
  data.schedules = [{id:'s',kol_name:'保留排期',schedule_date:'2026-11-16',status:'planned'}];
  const context = {DB:data,window:{DB:data},console,saveData:()=>{},setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extracted/media-workbench/js/schedule/data.js'),'utf8'),context);
  context.window.ScheduleData.initialize();
  assert.equal(data.kols.length,1);assert.equal(data.contents.length,1);assert.equal(data.schedules.length,1);
  assert.ok(data.platforms.every(p=>p.name!=='抖音'));
});


test('remember credentials expire and become invalid after password changes', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pinxuan-remember-test-'));
  try {
    const store=createOrganizationStore(root,'old-test-password');
    const user=store.resolveUser('domestic','admin');
    const remembered=store.issue('domestic',user,{purpose:'remember',expiresAt:Date.now()+30*86400000}).token;
    assert.equal(store.authenticate(remembered),null);
    assert.equal(store.authenticate(remembered,'remember').user.organization.id,'domestic');
    assert.equal(store.authenticate(store.issue('domestic',user,{purpose:'remember',expiresAt:Date.now()-1}).token,'remember'),null);
    const changed=createOrganizationStore(root,'new-test-password');
    assert.equal(changed.authenticate(remembered,'remember'),null);
    const normal=store.login('domestic','admin','old-test-password').token;
    assert.equal(store.authenticate(normal,'remember'),null);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
