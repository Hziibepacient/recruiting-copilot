import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

function harness(mutate) {
  let listener, clicks = 0, page = '1', ids = ['old-a','old-b'], dialogs = [];
  let input = {value:'Java 深圳 Agent'};
  const account = {innerText:'你好，DEMO_ACCOUNT',getClientRects:()=>[{}]};
  const active = {get textContent(){return page;}};
  const anchor = {isConnected:true,getClientRects:()=>[{}]};
  const item = {textContent:'2',isConnected:true,getClientRects:()=>[{}],querySelector:()=>anchor};
  const pager = {getClientRects:()=>[{}],querySelector:selector=>selector==='.ant-pagination-item-active'?active:null,
    querySelectorAll:selector=>selector==='.ant-pagination-item'?[item]:[],contains:node=>node===item};
  const rows = () => ids.map(id=>({classList:['r-'+id]}));
  const document = {body:{innerText:'page content '.repeat(20)},hasFocus:()=>true,visibilityState:'visible',
    querySelector:selector=>selector==='#rc_select_1'?input:selector==='.ant-spin-spinning'?null:null,
    querySelectorAll:selector=>selector==='[role=dialog]'?dialogs:selector==='p,a,span,div'?[account]:selector==='tr'?rows():selector==='.ant-pagination'?[pager]:[]};
  const context = vm.createContext({chrome:{runtime:{onMessage:{addListener:fn=>listener=fn}}},location:{hostname:'h.liepin.com'},document,
    getComputedStyle:()=>({visibility:'visible',display:'block'}),TTCPageControls:{click:async(_target,_before,_guard,validate)=>{
      await _guard(); mutate?.({setPage:v=>page=v,setIds:v=>ids=v,setDialogs:v=>dialogs=v,replaceInput:()=>input={value:'Java 深圳 Agent'},setItemText:v=>item.textContent=v});
      validate(); clicks++; page='2'; ids=['new-a','new-b'];
    }},Date,URL,TextEncoder,setTimeout});
  vm.runInContext(source,context);
  return {run:async data=>new Promise(resolve=>listener({type:'search',keyword:'Java 深圳 Agent',page:2,config:{account:'DEMO_ACCOUNT'},...data},{},resolve)),get clicks(){return clicks;}};
}

test('pagination waits for a stable new candidate set and returns its binding',async()=>{
  const h=harness();const r=await h.run();assert.equal(r.ok,true,r.error);assert.equal(h.clicks,1);assert.deepEqual(Array.from(r.data.candidateIds),['r-new-a','r-new-b']);assert.equal(r.data.keyword,'Java 深圳 Agent');assert.equal(r.data.fromPage,1);assert.equal(r.data.page,2);
});

test('popup appearing during click guard blocks pagination',async()=>{
  const h=harness(({setDialogs})=>setDialogs([{innerText:'开聊确认',getClientRects:()=>[{}]}]));const r=await h.run();assert.equal(r.ok,false);assert.match(r.error,/弹窗/);assert.equal(h.clicks,0);
});

test('reused target page node with changed label is rejected before click',async()=>{
  const h=harness(({setItemText})=>setItemText('3'));const r=await h.run();assert.equal(r.ok,false);assert.match(r.error,/目标页码/);assert.equal(h.clicks,0);
});

test('replaced keyword input is rejected before pagination click',async()=>{
  const h=harness(({replaceInput})=>replaceInput());const r=await h.run();assert.equal(r.ok,false);assert.match(r.error,/输入框/);assert.equal(h.clicks,0);
});

test('noninteger page input is rejected without clicking',async()=>{
  const h=harness();const r=await h.run({page:'2'});assert.equal(r.ok,false);assert.match(r.error,/页码/);assert.equal(h.clicks,0);
});





