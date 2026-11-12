import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../extension/controller.mjs';
import {DEFAULTS, day, needsKeywordSwitch} from '../extension/core.mjs';

function setup(overrides={}) {
  const db={config:{...DEFAULTS},events:[],queue:[],run:{batchId:'batch',lastKeyword:'old',sent:0,switchCheckpoint:0},historyAccount:DEFAULTS.account,...overrides};
  const reads=[],calls=[];
  let keyword='old';
  globalThis.chrome={storage:{local:{
    get:async keys=>{reads.push(keys);return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in db).map(k=>[k,structuredClone(db[k])]));},
    set:async values=>Object.assign(db,structuredClone(values)),
  }},tabs:{get:async()=>({url:'https://h.liepin.com/search'}),update:async()=>{},sendMessage:async(id,m)=>{
    calls.push(m);
    if(m.type==='health')return {ok:true,data:{protocol:6,clickVersion:1}};
    if(m.type==='inspect')return {ok:true,data:{kind:'list',pageText:'你好，'+DEFAULTS.account,keyword}};
    if(m.type==='search'){keyword=m.keyword;return {ok:true,data:{keyword,confirmed:true}};}
    throw Error('unexpected page mutation');
  }}};
  const store={migrateLegacySnapshots:async()=>{},getSnapshots:async()=>({})};
  return {db,reads,calls,handle:createController({store})};
}
const events=n=>Array.from({length:n},(_,i)=>({account:DEFAULTS.account,jobId:DEFAULTS.jobId,candidateId:'synthetic'+i,status:'verified',origin:'extension',batchId:'batch',day:day()}));

test('state never reads complete candidate snapshots',async()=>{
  const {handle,reads}=setup();assert.equal((await handle({type:'state'})).release,'0.3.1');
  assert.equal(reads.flat().includes('snapshots'),false);
});
test('search reload needs stopped state and no unresolved attempt',async()=>{
  const {handle,db}=setup();let reloads=0;chrome.tabs.reload=async()=>{reloads++;};
  chrome.tabs.get=async()=>({url:'https://h.liepin.com/search/getConditionItem'});
  await assert.rejects(handle({type:'reloadSearch',tabId:1}),/停止/);
  db.stop=true;assert.equal((await handle({type:'reloadSearch',tabId:1})).requiresRead,true);assert.equal(reloads,1);
  db.events.push({account:DEFAULTS.account,status:'uncertain',candidateId:'x'});
  await assert.rejects(handle({type:'reloadSearch',tabId:1}),/未决/);assert.equal(reloads,1);
});
test('pagination keeps the controller lock and original deadline across awaits',async()=>{
  const {handle}=setup();let release;
  const waiting=new Promise(resolve=>{release=resolve;});const deadline=Date.now()+5000;
  chrome.tabs.sendMessage=async(id,m)=>{
    if(m.type==='health'){await waiting;return {ok:true,data:{protocol:6,clickVersion:1}};}
    assert.equal(m.type,'search');assert.ok(m.deadlineAt<=deadline);
    return {ok:true,data:{confirmed:true,page:2,keyword:'old'}};
  };
  const first=handle({type:'search',tabId:1,page:2,keyword:'old',_deadlineAt:deadline});
  await assert.rejects(handle({type:'search',tabId:1,keyword:'another'}),/进行中/);
  release();assert.equal((await first).page,2);
});
test('an already expired command cannot touch any page control',async()=>{
  const {handle,calls}=setup();
  await assert.rejects(handle({type:'resume',tabId:1,_deadlineAt:Date.now()-1}),/过期/);
  assert.equal(calls.length,0);
});
test('resume requires reconciled receipts and clears obsolete preparation',async()=>{
  const {handle,db}=setup({stop:true,preparedReview:{old:true}});
  assert.equal((await handle({type:'resume',tabId:1})).requiresFreshPrepare,true);
  assert.equal(db.stop,false);assert.equal(db.preparedReview,null);
  db.stop=true;db.events.push({account:DEFAULTS.account,status:'uncertain',candidateId:'x'});
  await assert.rejects(handle({type:'resume',tabId:1}),/结果不明/);assert.equal(db.stop,true);
});
test('failed prepare invalidates previous approval before accessing evidence',async()=>{
  const {handle,db}=setup({preparedReview:{old:true}});
  await assert.rejects(handle({type:'prepare',tabId:1,id:'absent'}));
  assert.equal(db.preparedReview,null);
});
test('early keyword change restarts per-keyword count and invalidates preparation',async()=>{
  const {handle,db,calls}=setup({events:events(8),preparedReview:{old:true}});
  await handle({type:'search',tabId:1,keyword:'new'});
  assert.equal(db.run.switchCheckpoint,8);assert.equal(db.preparedReview,null);
  db.events=events(10);assert.equal(needsKeywordSwitch(db),false);
  db.events=events(18);assert.equal(needsKeywordSwitch(db),true);
  assert.ok(calls.find(x=>x.type==='search').deadlineAt>Date.now());
});
test('batch rollover preserves keyword count instead of granting extra ten',async()=>{
  const {handle,db}=setup({events:events(20),run:{batchId:'batch',lastKeyword:'old',switchCheckpoint:18,keywordCarry:0}});
  await handle({type:'nextBatch',tabId:1});
  assert.equal(db.run.keywordCarry,2);assert.equal(db.run.switchCheckpoint,0);
  const next=events(8).map(e=>({...e,candidateId:'next'+e.candidateId,batchId:db.run.batchId}));
  db.events.push(...next);assert.equal(needsKeywordSwitch(db),true);
});
test('unknown older attempt is not reconciled using an unbound boolean receipt',async()=>{
  const {handle,calls}=setup({events:[{account:DEFAULTS.account,jobId:DEFAULTS.jobId,candidateId:'old',status:'uncertain'}]});
  await assert.rejects(handle({type:'reconcile',tabId:1}),/缺少身份绑定/);
  assert.equal(calls.length,0);
});
test('configuration change invalidates queue and preparation, unresolved cannot be hidden',async()=>{
  const {handle,db}=setup({queue:[{old:true}],preparedReview:{old:true}});
  await handle({type:'config',value:{...DEFAULTS}});assert.deepEqual(db.queue,[]);assert.equal(db.preparedReview,null);
  db.events.push({account:DEFAULTS.account,candidateId:'old',status:'pending'});
  await assert.rejects(handle({type:'config',value:{...DEFAULTS,account:'other'}}),/未明/);
  assert.equal(db.config.account,DEFAULTS.account);
});
