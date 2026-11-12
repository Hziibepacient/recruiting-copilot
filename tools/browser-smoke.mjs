// Isolated, local-only IndexedDB smoke test. Never attaches to the user's Chrome.
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const executablePath=process.env.SMOKE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const source=await readFile(path.join(root,'extension/snapshot-store.mjs'));
let outage=false;
const server=http.createServer((req,res)=>{
 if(req.url==='/next'&&req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':req.headers.origin||'null','access-control-allow-headers':'Authorization, X-TTC-Client','access-control-allow-methods':'GET, OPTIONS'});res.end();return;}
 if(req.url==='/next'){res.writeHead(outage?503:200,{'content-type':'application/json','access-control-allow-origin':req.headers.origin||'null'});res.end('null');return;}
 if(req.url==='/snapshot-store.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(source);return;}
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><meta charset="utf-8"><title>isolated snapshot smoke</title>');return;}
 res.writeHead(404);res.end();
});
await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).on('error',reject));
let browser;const checks=[];
try{
 browser=await chromium.launch({executablePath,headless:true});
 const context=await browser.newContext();const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const result=await page.evaluate(async()=>{
  const {createSnapshotStore}=await import('/snapshot-store.mjs');
  let data={snapshots:{a:{candidateId:'a',capturedAt:'2026-01-01T00:00:00Z',text:'legacy'}},events:[1],queue:[2]};
  const storage={async get(k){return {[k]:data[k]};},async remove(k){delete data[k];}};
  let complete=false;const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);tx.addEventListener('complete',()=>{complete=true;});return tx;};
  const store=createSnapshotStore({indexedDB,storage,dbName:'smoke-success'});
  const migration=await store.migrateLegacySnapshots();const migrationCommitted=complete;
  await store.saveSnapshot({candidateId:'b',capturedAt:'2026-01-02T00:00:00Z',text:'latest'});
  await store.saveSnapshot({candidateId:'b',capturedAt:'2026-01-01T00:00:00Z',text:'older'});
  data.snapshots={u:{candidateId:'u',text:'undated'}};await store.migrateLegacySnapshots();
  await store.saveSnapshot({candidateId:'u',capturedAt:'2026-01-03T00:00:00Z',text:'fresh'});
  let invalidRejected=false;try{await store.saveSnapshot({candidateId:'u',capturedAt:'invalid'});}catch{invalidRejected=true;}
  const got=await store.getSnapshots(['a','b']);
  const fresh=(await store.getSnapshots(['u'])).u.text;
  IDBDatabase.prototype.transaction=original;
  // Force a real transaction abort after the put request has been issued.
  const origPut=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(...args){const req=origPut.apply(this,args);this.transaction.abort();return req;};
  const failData={snapshots:{c:{candidateId:'c',capturedAt:'2026-01-01T00:00:00Z',text:'must remain'}}};
  const failStorage={async get(k){return {[k]:failData[k]};},async remove(k){delete failData[k];}};
  const failing=createSnapshotStore({indexedDB,storage:failStorage,dbName:'smoke-abort'});
  let abortRejected=false;try{await failing.migrateLegacySnapshots();}catch{abortRejected=true;}
  IDBObjectStore.prototype.put=origPut;
  const rollback=(await failing.getSnapshots(['c'])).c===undefined;
  return {migration,migrationCommitted,got,fresh,invalidRejected,legacyRemoved:!('snapshots' in data),events:data.events,queue:data.queue,abortRejected,rollback,legacyKept:!!failData.snapshots};
 });
 assert.equal(result.migration.migrated,1);assert.equal(result.migrationCommitted,true);assert.equal(result.legacyRemoved,true);
 assert.deepEqual(result.events,[1]);assert.deepEqual(result.queue,[2]);assert.equal(result.got.a.text,'legacy');assert.equal(result.got.b.text,'latest');
 assert.equal(result.fresh,'fresh');assert.equal(result.invalidRejected,true);
 assert.equal(result.abortRejected,true);assert.equal(result.rollback,true);assert.equal(result.legacyKept,true);
 checks.push('transaction-complete','legacy-migration','retain-events-queue','newest-snapshot','fresh-replaces-undated','invalid-capture-rejected','abort-preserves-legacy','atomic-rollback');
 await page.reload();
 const after=await page.evaluate(async()=>{const {createSnapshotStore}=await import('/snapshot-store.mjs');return createSnapshotStore({indexedDB,storage:{get:async()=>({}),remove:async()=>{}},dbName:'smoke-success'}).getSnapshots(['a','b']);});
 assert.equal(after.a.text,'legacy');assert.equal(after.b.text,'latest');assert.deepEqual(errors,[]);checks.push('reload-persistence','no-page-errors');
 await context.close();
 // Try the real extension from an isolated copy and a fresh profile. The copy
 // receives a fake token and the fixture port, never the user's bridge config.
 const tmpRoot=path.join(root,'test-tmp');await mkdir(tmpRoot,{recursive:true});
 const isolated=await mkdtemp(path.join(tmpRoot,'mv3-smoke-'));let extensionResult,extensionContext;
 try{
  const ext=path.join(isolated,'extension'),profile=path.join(isolated,'profile');
  await cp(path.join(root,'extension'),ext,{recursive:true,filter:src=>path.basename(src)!=='bridge-config.json'});
  const manifestPath=path.join(ext,'manifest.json');const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.host_permissions=['http://127.0.0.1/*'];await writeFile(manifestPath,JSON.stringify(manifest));
  await writeFile(path.join(ext,'bridge-config.json'),JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,token:'isolated-test-token'}));
  extensionContext=await chromium.launchPersistentContext(profile,{executablePath,headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  let worker=extensionContext.serviceWorkers()[0];if(!worker)worker=await extensionContext.waitForEvent('serviceworker',{timeout:5000});
  const extPage=await extensionContext.newPage(),extErrors=[];extPage.on('pageerror',e=>extErrors.push(e.message));
  await extPage.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await extPage.waitForFunction(()=>document.getElementById('connection')?.textContent.includes('本机连接正常'),null,{timeout:8000});
  outage=true;
  await extPage.waitForFunction(()=>document.getElementById('connection')?.textContent.includes('连接未就绪'),null,{timeout:10000});
  const help=await extPage.locator('#connectionHelp').innerText();assert.match(help,/网络恢复后会重连/);
  outage=false;
  await extPage.waitForFunction(()=>document.getElementById('connection')?.textContent.includes('本机连接正常'),null,{timeout:12000});
  await extPage.locator('#assistantStop').click();
  await extPage.waitForFunction(async()=>!!(await chrome.storage.local.get('stop')).stop,null,{timeout:5000});
  await extPage.reload();
  await extPage.waitForFunction(()=>document.getElementById('runState')?.textContent.includes('已停止'),null,{timeout:8000});
  assert.equal(await extPage.evaluate(async()=>(await chrome.storage.local.get('stop')).stop),true);
  assert.deepEqual(extErrors,[]);extensionResult={ok:true,version:manifest.version,checks:['isolated-extension-loaded','local-fixture-connection','disconnect-message','automatic-reconnect','stop-persists-after-reload','no-page-errors']};
 }catch(e){extensionResult={ok:false,error:String(e.message||e).split('\n')[0]};}
 finally{
  await extensionContext?.close();
  const relative=path.relative(tmpRoot,isolated);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(isolated).startsWith('mv3-smoke-'))throw Error('Unsafe temporary cleanup path');
  await rm(isolated,{recursive:true,force:true});
 }
 if(!extensionResult.ok)process.exitCode=1;
 const report={ok:extensionResult.ok,browser:path.basename(executablePath),scope:'isolated headless Chromium, temporary browser context, loopback fixture only',checks,extension:extensionResult,checkedAt:new Date().toISOString()};
 await mkdir(path.join(root,'docs'),{recursive:true});await writeFile(path.join(root,'docs/browser-smoke.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(e){console.error('browser smoke failed:',e.stack||e);process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
