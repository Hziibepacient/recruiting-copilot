import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({Date});
vm.runInContext(fs.readFileSync(new URL('../demo/model.js',import.meta.url),'utf8'),context);
const M=context.TTCDemo;
const a='demo-person-a',b='demo-person-b';
function reviewed(id=a,s=M.initial()) {return M.apply(M.apply(s,'read',{id}),'review',{id});}
function sent(s,id=a) {return M.apply(M.apply(s,'prepare',{id}),'send',{jobId:M.JOB,greeting:M.GREETING});}

test('demo normal path confirms one receipt and refuses the same person again',()=>{
 const s=sent(reviewed());assert.equal(M.count(s),1);assert.equal(s.modal.type,'suggestion');
 const after=M.apply(s,'dismiss');assert.throws(()=>M.apply(after,'prepare',{id:a}),/去重/);
});

test('demo unknown evidence and failed education never enter approved queue',()=>{
 for(const id of ['demo-person-c','demo-person-f']) {const s=reviewed(id);assert.equal(s.decisions[id].approved,false);assert.throws(()=>M.apply(s,'prepare',{id}),/尚未通过/);}
});

test('demo review requires its detail to be opened first',()=>{
 assert.throws(()=>M.apply(M.initial(),'review',{id:a}),/先查看/);
});

test('demo wrong job or greeting cannot be submitted',()=>{
 const s=M.apply(reviewed(),'prepare',{id:a});
 assert.throws(()=>M.apply(s,'send',{jobId:'other',greeting:M.GREETING}),/不一致/);
 assert.throws(()=>M.apply(s,'send',{jobId:M.JOB,greeting:'other'}),/不一致/);
 assert.equal(M.count(s),0);assert.deepEqual(Object.keys(s.delivered),[]);
});

test('demo lost receipt is unresolved and reconciliation does not redeliver',()=>{
 let s=sent(M.apply(reviewed(),'mode',{mode:'lost'}));assert.equal(M.count(s),0);assert.equal(M.pending(s),true);
 s=reviewed(b,s);assert.throws(()=>M.apply(s,'prepare',{id:b}),/结果不明/);
 s=M.apply(s,'reconcile');assert.equal(M.count(s),1);assert.equal(Object.keys(s.delivered).length,1);assert.equal(M.pending(s),false);
});

test('demo restart and reconnect preserve unresolved state and block duplicate sending',()=>{
 let s=sent(M.apply(reviewed(),'mode',{mode:'lost'}));s=JSON.parse(JSON.stringify(s));
 s=M.apply(s,'disconnect');assert.throws(()=>M.apply(s,'reconcile'),/断开/);
 s=M.apply(s,'reconnect');assert.equal(M.pending(s),true);assert.throws(()=>M.apply(s,'prepare',{id:a}),/结果不明/);
});

test('demo stop and validation modes block actions',()=>{
 assert.throws(()=>M.apply(M.apply(reviewed(),'stop'),'prepare',{id:a}),/已停止/);
 assert.throws(()=>M.apply(M.apply(reviewed(),'mode',{mode:'captcha'}),'prepare',{id:a}),/验证/);
});

test('demo tenth verified send requires a different keyword before continuing',()=>{
 let s=M.apply(M.initial(),'nearTen');assert.equal(M.count(s),9);
 s=M.apply(sent(reviewed(a,s)),'dismiss');assert.equal(M.count(s),10);
 s=reviewed(b,s);assert.throws(()=>M.apply(s,'prepare',{id:b}),/更换关键词/);
 assert.throws(()=>M.apply(s,'search',{keyword:s.keyword}),/不同关键词/);
 s=M.apply(s,'search',{keyword:'Java CRM'});assert.equal(M.apply(s,'prepare',{id:b}).modal.type,'job');
});

test('demo pagination changes candidate collection and rejects invalid pages',()=>{
 const s=M.initial();const before=M.pageItems(s).map(p=>p.id).join(',');const after=M.pageItems(M.apply(s,'page',{page:2})).map(p=>p.id).join(',');
 assert.notEqual(before,after);assert.throws(()=>M.apply(s,'page',{page:1.5}),/页码/);
});

test('demo CSP prevents network calls and artifacts contain no service endpoint',()=>{
 const html=fs.readFileSync(new URL('../demo/index.html',import.meta.url),'utf8');assert.match(html,/connect-src 'none'/);assert.match(html,/不会真实发送/);
 for(const filename of ['model.js','app.js']){const source=fs.readFileSync(new URL('../demo/'+filename,import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|new\s+WebSocket|18763|h\.liepin\.com/);}
});
