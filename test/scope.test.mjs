import test from 'node:test';
import assert from 'node:assert/strict';
let serial=0;
async function load(fetcher){
 const before={chrome:globalThis.chrome,fetch:globalThis.fetch};
 globalThis.chrome={runtime:{getURL:name=>'chrome-extension://fixture/'+name}};
 globalThis.fetch=fetcher;
 try{return await import('../extension/scope.mjs?test='+serial++);}
 finally{globalThis.chrome=before.chrome;globalThis.fetch=before.fetch;}
}
test('missing private scope leaves only a harmless public demo binding',async()=>{
 const {SCOPE}=await load(async()=>{throw TypeError('file missing');});
 assert.equal(SCOPE.account,'DEMO_ACCOUNT');assert.equal(SCOPE.jobId,'10000000');
});
test('private scope supplies the exact account, job and greeting',async()=>{
 const value={account:'LOCAL_FIXTURE',jobId:'12345678',greeting:'fixture greeting'};
 const {SCOPE}=await load(async()=>({ok:true,json:async()=>value}));
 assert.deepEqual(SCOPE,value);assert.equal(Object.isFrozen(SCOPE),true);
});
test('invalid private scope fails closed instead of silently using demo values',async()=>{
 await assert.rejects(load(async()=>({ok:true,json:async()=>({account:'fixture',jobId:4,greeting:'fixture'})})),/配置无效/);
});
