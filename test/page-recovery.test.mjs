import {completedDialogFixture} from './fixtures/liepin-page.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../extension/content.js',import.meta.url),'utf8');
function fixture(options={}){
 let listener,now=0,dialogs=[],ids=['old-a'],page='1',loading=false,closeClicks=0,searchClicks=0,hold;
 class Input {get value(){return this._value||'';}set value(v){this._value=v;}dispatchEvent(){}}
 const input=new Input();input.value='old';
 const visibleNode=(body='')=>({innerText:body,isConnected:true,getClientRects:()=>[{}],querySelectorAll:()=>[],querySelector:()=>null,contains:()=>false});
 const account=visibleNode('你好，DEMO_ACCOUNT'),searchButton=visibleNode('搜 索');
 searchButton.closest=()=>searchButton;
 const close=visibleNode();
 const dialog=visibleNode(options.dialog||'免费开聊相似候选人');
 let dialogShown=!!options.dialog;
 dialog.getClientRects=()=>dialogShown?[{}]:[];
 dialog.querySelectorAll=()=>options.noClose?[]:[close];
 dialog.contains=e=>e===close;
 const active={get textContent(){return page;}};
 const target=visibleNode();target.textContent='2';target.querySelector=()=>target;
 const pager=visibleNode();pager.querySelector=s=>s==='.ant-pagination-item-active'?active:null;
 pager.querySelectorAll=()=>[target];pager.contains=e=>e===target;
 const spinner=visibleNode();spinner.getClientRects=()=>loading?[{}]:[];
 const empty=visibleNode('暂无符合条件的简历');
 const document={body:visibleNode('page text '.repeat(30)),hasFocus:()=>true,visibilityState:'visible',
   querySelector:s=>s==='#rc_select_1'?input:s==='.ant-spin-spinning'?spinner:null,
   querySelectorAll:s=>s==='[role=dialog]'?(dialogShown?[dialog]:[]):s==='p,a,span,div'?[account]:s==='tr'?ids.map(id=>({classList:['r-'+id]})):s==='.ant-pagination'?[pager]:s==='button,a,span,em'?[searchButton]:s==='.ant-empty-description,.ant-table-placeholder'?(ids.length?[]:[empty]):[],
 };
 const mutate={setNow:v=>now=v,setIds:v=>ids=v,setPage:v=>page=v,setLoading:v=>loading=v,setKeyword:v=>input.value=v,setDialog:v=>dialogShown=v};
 const context=vm.createContext({document,location:{hostname:'h.liepin.com'},HTMLInputElement:Input,Event:class{},
  chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},
  getComputedStyle:()=>({visibility:'visible',display:'block'}),
  RCPageControls:{resolveControl:e=>e,click:async(el,before=()=>{},guard=async()=>{},validate=()=>{})=>{
    await guard();options.beforeClick?.(mutate);validate();before();
    if(el===close){closeClicks++;if(!options.stuckDialog)dialogShown=false;return;}
    searchClicks++;
    if(options.holdClick)await new Promise(r=>hold=r);
    if(options.onSearch)options.onSearch(mutate);else {ids=['new-a'];page=options.paginate?'2':'1';}
  }},Date:class extends Date{static now(){return now;}},URL,TextEncoder,
  setTimeout:fn=>{now+=500;options.onTick?.(mutate,now);queueMicrotask(fn);},
 });
 vm.runInContext(source,context);
 const run=cmd=>new Promise(resolve=>listener({type:'search',keyword:options.paginate?'old':'new',config:{account:'DEMO_ACCOUNT'},...(options.paginate?{page:2}:{}),...cmd},{},resolve));
 return {run,stats:()=>({closeClicks,searchClicks}),release:()=>hold?.(),mutate};
}

test('known suggestion closes once through its close button then completes search',async()=>{
 const f=fixture({dialog:'免费开聊相似候选人\n免费开聊10/10'});const r=await f.run();
 assert.equal(r.ok,true,r.error);assert.equal(r.data.confirmed,true);assert.deepEqual(f.stats(),{closeClicks:1,searchClicks:1});
});

test('a job selection dialog stays untouched, including one containing success text',async()=>{
 const f=fixture({dialog:'请选择职位开聊\n已向某某发送打招呼语'});const r=await f.run();
 assert.equal(r.ok,false);assert.match(r.error,/弹窗/);assert.deepEqual(f.stats(),{closeClicks:0,searchClicks:0});
});

test('unknown or security dialog is not closed and no search occurs',async()=>{
 for(const dialog of ['未知业务弹窗','安全验证\n免费开聊相似候选人']){
  const f=fixture({dialog});const r=await f.run();assert.equal(r.ok,false);assert.deepEqual(f.stats(),{closeClicks:0,searchClicks:0});
 }
});

test('known modal without a unique close button remains blocked',async()=>{
 const f=fixture({dialog:'免费开聊相似候选人',noClose:true});const r=await f.run();
 assert.equal(r.ok,false);assert.match(r.error,/关闭按钮/);assert.deepEqual(f.stats(),{closeClicks:0,searchClicks:0});
});

test('a close with no observable dismissal is not clicked repeatedly',async()=>{
 const f=fixture({dialog:'免费开聊相似候选人',stuckDialog:true});const r=await f.run();
 assert.equal(r.ok,false);assert.deepEqual(f.stats(),{closeClicks:1,searchClicks:0});
});

test('page indicator change with the old candidate set never confirms pagination',async()=>{
 const f=fixture({paginate:true,onSearch:m=>m.setPage('2')});const r=await f.run();
 assert.equal(r.ok,false);assert.equal(f.stats().searchClicks,1);
});

test('changed rows with old page indicator never confirm pagination',async()=>{
 const f=fixture({paginate:true,onSearch:m=>m.setIds(['new-a'])});const r=await f.run();assert.equal(r.ok,false);
});

test('keyword text change alone never confirms a search',async()=>{
 const f=fixture({onSearch:()=>{}});const r=await f.run();assert.equal(r.ok,false);assert.equal(f.stats().searchClicks,1);
});

test('empty query result requires the real empty-result marker and page one',async()=>{
 const f=fixture({onSearch:m=>m.setIds([])});const r=await f.run();assert.equal(r.ok,true,r.error);assert.equal(r.data.candidateIds.length,0);
});

test('only a previously confirmed identical query can reuse existing results',async()=>{
 const f=fixture();const first=await f.run({keyword:'old'});assert.equal(first.ok,true,first.error);assert.equal(f.stats().searchClicks,1);
 await Promise.resolve();await Promise.resolve();const r=await f.run({keyword:'old'});assert.equal(r.ok,true,r.error);assert.equal(r.data.reusedCurrentResults,true);assert.equal(f.stats().searchClicks,1);
});

test('initial same input does not prove that the query was submitted',async()=>{
 const f=fixture({onSearch:()=>{}});const r=await f.run({keyword:'old'});assert.equal(r.ok,false);assert.equal(f.stats().searchClicks,1);
});

test('a running search rejects a second mutation without an extra click',async()=>{
 const f=fixture({holdClick:true});const first=f.run();
 for(let i=0;i<10&&f.stats().searchClicks===0;i++)await Promise.resolve();
 const second=await f.run();assert.equal(second.ok,false);assert.match(second.error,/仍在进行/);f.release();assert.equal((await first).ok,true);assert.equal(f.stats().searchClicks,1);
});

test('row replacement after the final click cannot be treated as a verified receipt',async()=>{
 const f=completedDialogFixture({replaceRowAfterClick:true});assert.equal((await f.run('prepare')).ok,true);
 const result=await f.run('send');assert.equal(result.ok,false);assert.match(result.error,/回执身份绑定/);assert.equal(f.stats().sendClicks,1);
});
test('receipt reconciliation rejects replaced rows and changed accounts without resending',async()=>{
 for(const mutation of ['replaceRow','changeAccount']){
  const f=completedDialogFixture();assert.equal((await f.run('prepare')).ok,true);assert.equal((await f.run('send')).data.verified,true);
  f[mutation]();const receipt=await f.run('receipt');assert.equal(receipt.ok,false);assert.equal(f.stats().sendClicks,1);
 }
});

test('a verified send can retire only its own unchanged leftover job dialog',async()=>{
 const f=completedDialogFixture();assert.equal((await f.run('prepare')).ok,true);const sent=await f.run('send');assert.equal(sent.data.verified,true);
 const search=await f.run('search');assert.equal(search.ok,true,search.error);assert.deepEqual(f.stats(),{closeClicks:1,sendClicks:1});
});

test('a manual job change after receipt prevents automatic dismissal',async()=>{
 const f=completedDialogFixture();assert.equal((await f.run('prepare')).ok,true);assert.equal((await f.run('send')).data.verified,true);f.changeJob();
 const search=await f.run('search');assert.equal(search.ok,false);assert.match(search.error,/弹窗/);assert.deepEqual(f.stats(),{closeClicks:0,sendClicks:1});
});


test('expired incoming search is rejected before any page action',async()=>{
 const f=fixture({dialog:'免费开聊相似候选人'});f.mutate.setNow(10);const r=await f.run({deadlineAt:1});
 assert.equal(r.ok,false);assert.match(r.error,/期限/);assert.deepEqual(f.stats(),{closeClicks:0,searchClicks:0});
 const invalid=await f.run({deadlineAt:-1});assert.equal(invalid.ok,false);assert.match(invalid.error,/期限/);
});

test('search expiring during asynchronous preparation never clicks search',async()=>{
 const f=fixture({beforeClick:m=>m.setNow(2000)});const r=await f.run({deadlineAt:2000});
 assert.equal(r.ok,false);assert.match(r.error,/期限/);assert.deepEqual(f.stats(),{closeClicks:0,searchClicks:0});
});

test('search deadline bounds result polling even if its local wait is longer',async()=>{
 const f=fixture({onSearch:()=>{}});const r=await f.run({deadlineAt:400});
 assert.equal(r.ok,false);assert.match(r.error,/期限/);assert.equal(f.stats().searchClicks,1);
});

test('send expiring while the control is preparing returns notSent and never clicks',async()=>{
 const f=completedDialogFixture({beforeSend:({advance})=>advance(1000)});assert.equal((await f.run('prepare')).ok,true);
 const r=await f.run('send',{deadlineAt:2000});assert.equal(r.ok,true);assert.equal(r.data.notSent,true);assert.match(r.data.error,/期限/);assert.equal(f.stats().sendClicks,0);
});

test('expiration after the send click remains unresolved rather than notSent or verified',async()=>{
 const f=completedDialogFixture({advanceAfterClick:1000});assert.equal((await f.run('prepare')).ok,true);
 const r=await f.run('send',{deadlineAt:2000});assert.equal(r.ok,false);assert.match(r.error,/期限/);assert.equal(r.data,undefined);assert.equal(f.stats().sendClicks,1);
 const receipt=await f.run('receipt');assert.equal(receipt.data.verified,true);assert.equal(f.stats().sendClicks,1);
});

test('a health message cannot extend the in-flight send deadline',async()=>{
 let f;
 f=completedDialogFixture({beforeSend:async({advance})=>{const health=await f.run('health',{deadlineAt:100000});assert.equal(health.ok,true);advance(1000);}});
 assert.equal((await f.run('prepare')).ok,true);const r=await f.run('send',{deadlineAt:2000});
 assert.equal(r.data.notSent,true);assert.match(r.data.error,/期限/);assert.equal(f.stats().sendClicks,0);
});

