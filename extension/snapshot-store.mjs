// Complete candidate snapshots live outside chrome.storage.local's small quota.
// The caller must serialize legacy migration with all snapshot writers.
const DATABASE='recruiting-liepin-snapshots';
const STORE='snapshots';

function reason(error){return error?.message||error?.name||String(error||'unknown error');}
function snapshotValid(s){return s&&typeof s.candidateId==='string'&&s.candidateId.length>0;}
function newer(incoming,existing,fresh=false){
 if(!existing)return true;
 const a=Date.parse(incoming.capturedAt),b=Date.parse(existing.capturedAt);
 // A freshly read, dated record supersedes an undated existing record.
 if(fresh&&Number.isFinite(a)&&!Number.isFinite(b))return true;
 // For migration, ambiguous dates retain the existing IDB record.
 return Number.isFinite(a)&&Number.isFinite(b)&&a>b;
}

export function createSnapshotStore({indexedDB=globalThis.indexedDB,storage=globalThis.chrome?.storage?.local,dbName=DATABASE}={}){
 if(!indexedDB||!storage)throw Error('快照存储不可用');
 function open(){return new Promise((resolve,reject)=>{
  let request,done=false;
  try{request=indexedDB.open(dbName,1);}catch(e){reject(Error('打开快照数据库失败：'+reason(e)));return;}
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'candidateId'});};
  request.onblocked=()=>{if(!done){done=true;reject(Error('快照数据库被其他页面占用'));}};
  request.onerror=()=>{if(!done){done=true;reject(Error('打开快照数据库失败：'+reason(request.error)));}};
  request.onsuccess=()=>{if(done){request.result.close();return;}done=true;resolve(request.result);};
 });}
 async function write(records,{fresh=false}={}){
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   let tx;
   try{tx=db.transaction(STORE,'readwrite');const store=tx.objectStore(STORE);
    for(const item of records){const req=store.get(item.candidateId);req.onsuccess=()=>{if(newer(item,req.result,fresh))store.put(item);};}
   }catch(e){try{tx?.abort();}catch{} reject(Error('保存快照失败：'+reason(e)));return;}
   tx.oncomplete=()=>resolve();
   tx.onabort=()=>reject(Error('保存快照事务失败：'+reason(tx.error)));
   tx.onerror=()=>{}; // abort is authoritative; do not report a partial success
  });}finally{db.close();}
 }
 async function saveSnapshot(snapshot){
  if(!snapshotValid(snapshot))throw Error('快照缺少候选人标识');
  if(typeof snapshot.capturedAt!=='string'||!Number.isFinite(Date.parse(snapshot.capturedAt)))throw Error('新快照缺少有效采集时间');
  await write([snapshot],{fresh:true});
 }
 async function getSnapshots(ids){
  if(!Array.isArray(ids)||ids.some(x=>typeof x!=='string'||!x))throw Error('候选人标识无效');
  if(!ids.length)return {};
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   let tx;const result={};
   try{tx=db.transaction(STORE,'readonly');const store=tx.objectStore(STORE);
    for(const id of new Set(ids)){const req=store.get(id);req.onsuccess=()=>{if(req.result)result[id]=req.result;};}
   }catch(e){try{tx?.abort();}catch{} reject(Error('读取快照失败：'+reason(e)));return;}
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(Error('读取快照事务失败：'+reason(tx.error)));tx.onerror=()=>{};
  });}finally{db.close();}
 }
 async function migrateLegacySnapshots(){
  const legacy=(await storage.get('snapshots')).snapshots;
  if(legacy===undefined)return {migrated:0};
  if(!legacy||Array.isArray(legacy)||typeof legacy!=='object')throw Error('旧快照数据格式无效，已保留');
  const entries=Object.entries(legacy);
  for(const [id,value] of entries)if(!snapshotValid(value)||id!==value.candidateId)throw Error('旧快照标识不一致，已保留');
  await write(entries.map(([,value])=>value));
  // Verify the exact legacy set is unchanged before removal. The caller must
  // ensure old extension pages cannot write concurrently (no CAS in Chrome storage).
  const latest=(await storage.get('snapshots')).snapshots;
  if(JSON.stringify(latest)!==JSON.stringify(legacy))throw Error('旧快照迁移期间发生变化，已保留；请重试');
  await storage.remove('snapshots');
  return {migrated:entries.length};
 }
 return {saveSnapshot,getSnapshots,migrateLegacySnapshots};
}

let singleton;
function defaultStore(){return singleton||=createSnapshotStore();}
export const saveSnapshot=s=>defaultStore().saveSnapshot(s);
export const getSnapshots=ids=>defaultStore().getSnapshots(ids);
export const migrateLegacySnapshots=()=>defaultStore().migrateLegacySnapshots();
