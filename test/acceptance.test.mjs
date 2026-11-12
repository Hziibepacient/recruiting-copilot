import test from 'node:test';
import assert from 'node:assert/strict';
import {SCOPE,validatePermit} from '../extension/acceptance.mjs';
import {DEFAULTS,day,checkBudget,batchUsed} from '../extension/core.mjs';
const fakeStore=s=>({migrateLegacySnapshots:async()=>{},getSnapshots:async ids=>Object.fromEntries(ids.map(id=>[id,s.snapshots[id]]))});
const TARGET={...SCOPE,candidateId:'IndependentCandidate02',usercId:'b'.repeat(32)};

function fixture(){
 const quote='独立测试证据';
 const d={...TARGET,direction:'通用',digest:'a'.repeat(64),approved:true,gates:Object.fromEntries(['education','backend','expected_city','agent','delivery','ai_dev'].map(k=>[k,{state:'pass',quote}]))};
 const s={config:{...DEFAULTS},queue:[d],snapshots:{[TARGET.candidateId]:{complete:true,digest:d.digest,text:quote}},events:[],run:{batchId:'test-batch',sent:0,keywordIndex:0},historyAccount:TARGET.account};
 const p={...TARGET,state:'consumed',permitId:'test-permit',commandId:'test-command',batchId:s.run.batchId,digest:d.digest,expiresAt:Date.now()/1000+120};
 s.preparedReview={...p};
 return {s,m:{type:'run',tabId:1,candidateId:TARGET.candidateId,permitId:p.permitId,_commandId:p.commandId,_permit:p}};
}
test('preflight validates the final prepared controls without consuming permits or submitting',async()=>{
 const {s}=fixture();s.preparedReview.preparedAt=new Date().toISOString();
 const before=structuredClone(s);const calls=[];
 globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in s).map(k=>[k,structuredClone(s[k])])),set:async v=>Object.assign(s,structuredClone(v))}},tabs:{get:async()=>({url:'https://h.liepin.com/search'}),sendMessage:async(id,m)=>{
  calls.push(m.type);
  if(m.type==='health')return {ok:true,data:{protocol:6,clickVersion:1}};
  if(m.type==='validatePrepared')return {ok:true,data:{ready:true,candidateId:TARGET.candidateId,usercId:TARGET.usercId,jobId:SCOPE.jobId,greeting:SCOPE.greeting}};
  throw Error('preflight must not click send');
 }}};
 const {createController}=await import('../extension/controller.mjs');const handle=createController({store:fakeStore(s)});
 const result=await handle({type:'preflight',id:TARGET.candidateId,tabId:1});
 assert.equal(result.dryRun,true);assert.equal(result.submitted,false);assert.deepEqual(calls,['health','validatePrepared']);
 assert.deepEqual(s.events,before.events);assert.deepEqual(s.preparedReview,before.preparedReview);assert.equal(s.usedPermits,undefined);
 for(const time of ['invalid',new Date(Date.now()-601000).toISOString(),new Date(Date.now()+60000).toISOString()]){
  s.preparedReview.preparedAt=time;await assert.rejects(handle({type:'preflight',id:TARGET.candidateId,tabId:1}),/过期/);
 }
 assert.deepEqual(calls,['health','validatePrepared']);
});
test('错误usercId和重复许可都拒绝',()=>{
 const {s,m}=fixture();assert.equal(validatePermit(m,s,{}).candidateId,TARGET.candidateId);
 assert.throws(()=>validatePermit({...m,_permit:{...m._permit,usercId:'c'.repeat(32)}},s,{}),/准备不符/);
 assert.throws(()=>validatePermit(m,s,{[m.permitId]:true}),/已使用/);
});
test('第二候选人可复用，但身份材料批次不可串用',()=>{
 const {s,m}=fixture();assert.equal(validatePermit(m,s,{}).candidateId,'IndependentCandidate02');
 for(const [key,value]of [['candidateId','IndependentCandidate03'],['digest','d'.repeat(64)],['batchId','other-batch']])assert.throws(()=>validatePermit({...m,_permit:{...m._permit,[key]:value}},s,{}),/不符/);
});
test('当天计数去重且旧历史不能遮盖今日成功或未决',()=>{
 const verified={account:SCOPE.account,candidateId:'candidate1',status:'verified',day:day(),batchId:'batch',origin:'extension'};
 const old={...verified,day:'2026-01-01',origin:'historical-import'};
 assert.equal(checkBudget([verified,verified,old],DEFAULTS),1);
 assert.equal(batchUsed([verified,verified,old],DEFAULTS,'batch'),1);
 assert.throws(()=>checkBudget([{...verified,status:'pending',permitId:'pending-1'},old],DEFAULTS),/不明/);
 const rows=Array.from({length:60},(_,i)=>({...verified,candidateId:'candidate'+i}));
 assert.equal(checkBudget(rows.slice(0,59),DEFAULTS),59);assert.throws(()=>checkBudget(rows,DEFAULTS),/额度/);
});
test('批次20及日60上限在任何页面动作前拒绝',async()=>{
 for(const [kind,count]of [['batch',20],['daily',60]]){
  const {s,m}=fixture();s.events=Array.from({length:count},(_,i)=>({account:SCOPE.account,candidateId:'old'+i,status:'verified',day:day(),origin:'extension',batchId:kind==='batch'?s.run.batchId:'other'}));
  globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in s).map(k=>[k,structuredClone(s[k])])),set:async v=>Object.assign(s,structuredClone(v))}},tabs:{get:async()=>{throw Error('不得触达页面');}}};
  const {createController}=await import('../extension/controller.mjs');const handle=createController({store:fakeStore(s)});
  const r=await handle(m);assert.equal(r.notSent,true);assert.equal(r.submitted,false);assert.match(r.error,kind==='batch'?/本批上限/:/今日额度/);
 }
});
test('批次19与日59各允许最后一条并正确持久计数',async()=>{
 for(const kind of ['batch','daily']){
  const {s,m}=fixture();const count=kind==='batch'?19:59;let sends=0;
  s.events=Array.from({length:count},(_,i)=>({account:SCOPE.account,candidateId:'old'+i,status:'verified',day:day(),origin:'extension',batchId:kind==='batch'?s.run.batchId:'other'}));
  if(kind==='batch')s.run.switchCheckpoint=10;
  globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in s).map(k=>[k,structuredClone(s[k])])),set:async v=>Object.assign(s,structuredClone(v))}},tabs:{get:async()=>({url:'https://h.liepin.com/search'}),sendMessage:async(id,msg)=>{
   if(msg.type==='health')return {ok:true,data:{protocol:6,clickVersion:1}};
   if(msg.type==='validatePrepared')return {ok:true,data:{ready:true}};
   if(msg.type==='send'){sends++;return {ok:true,data:{verified:true,candidateId:TARGET.candidateId,usercId:TARGET.usercId,receipt:'test'}};}
   throw Error('unexpected test call');
  }}};
  const {createController}=await import('../extension/controller.mjs');const handle=createController({store:fakeStore(s)});const result=await handle(m);
  assert.equal(sends,1);assert.equal(result.verified,true);assert.equal(s.events.at(-1).status,'verified');
  if(kind==='batch'){assert.equal(result.batchSent,20);assert.equal(result.needsKeywordChange,true);}
  else assert.throws(()=>checkBudget(s.events,DEFAULTS),/今日额度/);
 }
});
test('发送超时持久化uncertain且相同许可第二次不再调用send',async()=>{
 const {s,m}=fixture();const db=structuredClone(s);let sends=0;
 globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in db).map(k=>[k,structuredClone(db[k])])),set:async v=>Object.assign(db,structuredClone(v))}},tabs:{get:async()=>({url:'https://h.liepin.com/search'}),sendMessage:async(id,msg)=>{
  if(msg.type==='health')return {ok:true,data:{protocol:6,clickVersion:1}};
  if(msg.type==='validatePrepared')return {ok:true,data:{ready:true}};
  if(msg.type==='send'){sends++;assert.equal(db.events.at(-1).status,'pending');assert.ok(db.usedPermits[m.permitId]);return new Promise(()=>{});}
  throw Error('unexpected mock request');
 }}};
 const original=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms>=14000?20:ms,...args);
 try{
  const {createController}=await import('../extension/controller.mjs');const handle=createController({store:fakeStore(db)});
  await assert.rejects(handle(m),/须先核验回执/);assert.equal(db.events.at(-1).status,'uncertain');assert.equal(sends,1);
  await assert.rejects(handle(m),/已使用/);assert.equal(sends,1);
 }finally{globalThis.setTimeout=original;}
});
test('旧历史导入后reconcile仍核验原许可并解除未决',async()=>{
 const {s}=fixture();let receipts=0;
 const pending={account:SCOPE.account,candidateId:TARGET.candidateId,jobId:SCOPE.jobId,status:'uncertain',day:day(),batchId:s.run.batchId,permitId:'original-permit',usercId:TARGET.usercId,time:'2000-01-01T00:00:00.000Z'};
 s.events=[pending,{...pending,status:'verified',origin:'historical-import',day:'1999-01-01',time:'1999-01-01T00:00:00.000Z'}];
 assert.throws(()=>checkBudget(s.events,DEFAULTS),/不明/);
 globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in s).map(k=>[k,structuredClone(s[k])])),set:async v=>Object.assign(s,structuredClone(v))}},tabs:{get:async()=>({url:'https://h.liepin.com/search'}),sendMessage:async(id,msg)=>{
  if(msg.type==='health')return {ok:true,data:{protocol:6,clickVersion:1}};
  if(msg.type==='receipt'){receipts++;assert.equal(msg.id,TARGET.candidateId);return {ok:true,data:{verified:true,candidateId:TARGET.candidateId,usercId:TARGET.usercId}};}
  throw Error('reconcile must not send');
 }}};
 const {createController}=await import('../extension/controller.mjs');const handle=createController({store:fakeStore(s)});await handle({type:'reconcile',tabId:1});
 assert.equal(receipts,1);assert.equal(s.events.at(-1).permitId,'original-permit');assert.equal(s.events.at(-1).status,'verified');assert.equal(checkBudget(s.events,DEFAULTS),1);
});
