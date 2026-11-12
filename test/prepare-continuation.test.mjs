import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const original=fs.readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
const source=original.replace('  async function dispatch(m){','  globalThis.openingQA={openCandidate,resumableOpening,prepare};\n  async function dispatch(m){');
function fixture(){
 let clickHandler,shown=false,identity='one',target='%7B%22userc_id_encode%22%3A%22native-one%22%7D',clicks=0,now=1;
 const node=body=>({innerText:body,isConnected:true,getClientRects:()=>[{}],querySelectorAll:()=>[],querySelector:()=>null});
 const control=node('立即沟通');
 const row={...node('候选人 立即沟通'),classList:{contains:s=>s==='r-'+identity},contains:n=>n===control,querySelectorAll:()=>[control]};
 const button={...node('立即开聊'),getAttribute:()=>target};
 const dialog={...node('请选择职位开聊'),contains:n=>n===button,querySelectorAll:()=>[button]};
 const account=node('你好，DEMO_ACCOUNT');
 const document={body:node('body'.repeat(50)),hasFocus:()=>true,visibilityState:'visible',addEventListener:(name,fn)=>clickHandler=fn,
 querySelectorAll:s=>s==='[role=dialog]'?(shown?[dialog]:[]):s==='tr'?[row]:s==='p,a,span,div'?[account]:[],};
 const ctx=vm.createContext({document,location:{hostname:'h.liepin.com'},getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),
 chrome:{storage:{local:{set:async()=>{}}},runtime:{onMessage:{addListener:()=>{}}}},
 TTCPageControls:{click:async(el,before,guard,validate)=>{await guard();validate();before();clicks++;}},
 Date:class extends Date{static now(){return now;}},URL,TextEncoder});
 vm.runInContext(source,ctx);
 const m={id:'one',config:{account:'DEMO_ACCOUNT',jobId:'10000000'}};
 return {qa:ctx.openingQA,m,row,show:()=>shown=true,changeTarget:()=>target='%7B%22userc_id_encode%22%3A%22native-other%22%7D',expire:()=>now+=300001,
 changeIdentity:()=>identity='other',manualOther:()=>clickHandler({isTrusted:true,target:{closest:s=>s==='tr'?{}:null}}),stats:()=>clicks};
}
test('late opening resumes the same bound window without another candidate click',async()=>{
 const f=fixture();await f.qa.openCandidate(f.m,f.row);f.show();assert.equal(f.qa.resumableOpening(f.m,f.row),true);
 await assert.rejects(f.qa.prepare(f.m),/找不到职位选择框/);assert.equal(f.stats(),1);
 assert.equal(f.qa.resumableOpening(f.m,f.row),true,'a failed job-control lookup must retain the same-window continuation');
 await assert.rejects(f.qa.prepare(f.m),/找不到职位选择框/);assert.equal(f.stats(),1);
});
test('late opening cannot be used for another candidate or another job scope',async()=>{
 const f=fixture();await f.qa.openCandidate(f.m,f.row);f.show();assert.equal(f.qa.resumableOpening({...f.m,id:'other'},f.row),false);
 assert.equal(f.qa.resumableOpening({...f.m,config:{...f.m.config,jobId:'other'}},f.row),false);
});
test('native target changes, manual candidate switches and expiration invalidate late opening',async()=>{
 for(const change of ['changeTarget','manualOther','expire']){
  const f=fixture();await f.qa.openCandidate(f.m,f.row);f.show();assert.equal(f.qa.resumableOpening(f.m,f.row),true);f[change]();assert.equal(f.qa.resumableOpening(f.m,f.row),false,change);
 }
});
test('an existing unowned dialog is never adopted as an opening',()=>{
 const f=fixture();f.show();assert.equal(f.qa.resumableOpening(f.m,f.row),false);assert.equal(f.stats(),0);
});
