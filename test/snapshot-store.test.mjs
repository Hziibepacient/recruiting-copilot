import test from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshotStore} from '../extension/snapshot-store.mjs';

// Deterministic transactional IDB double. Writes become visible only on commit.
function fakeDB({failWrite=false,blocked=false}={}){
 const records=new Map();let closes=0;
 const api={records,get closes(){return closes;},open(){
  const req={};setTimeout(()=>{
   if(blocked){req.onblocked?.();return;}
   const db={objectStoreNames:{contains:()=>true},close(){closes++;},transaction(name,mode){
    const staged=new Map(records);let pending=0,aborted=false,ended=false;
    const tx={error:null,abort(){if(ended||aborted)return;aborted=true;this.error=Error('abort');setTimeout(()=>this.onabort?.(),0);},objectStore(){return {
     get(id){const r={};pending++;setTimeout(()=>{if(aborted)return;r.result=staged.get(id);r.onsuccess?.();pending--;finish();},0);return r;},
     put(value){pending++;setTimeout(()=>{if(aborted)return;if(failWrite){tx.error=Error('QuotaExceededError');aborted=true;tx.onabort?.();return;}staged.set(value.candidateId,value);pending--;finish();},0);}
    };}};
    function finish(){if(!pending&&!aborted&&!ended){ended=true;setTimeout(()=>{if(mode==='readwrite'){records.clear();for(const [k,v] of staged)records.set(k,v);}tx.oncomplete?.();},0);}}
    setTimeout(finish,0);return tx;
   }};req.result=db;req.onsuccess?.();
  },0);return req;
 }};return api;
}
function local(initial={}){let values={...initial};return {async get(key){return {[key]:values[key]};},async remove(key){delete values[key];},get data(){return values;}};}
const s=(candidateId,date,text='text')=>({candidateId,capturedAt:date,text});
test('单个候选人提交后读取，旧版本不会覆盖新版本',async()=>{
 const db=fakeDB(),st=createSnapshotStore({indexedDB:db,storage:local()});
 await st.saveSnapshot(s('a','2026-10-29T02:00:00Z','new'));await st.saveSnapshot(s('a','2026-10-28T02:00:00Z','old'));
 assert.equal((await st.getSnapshots(['a'])).a.text,'new');assert.equal(db.closes,3);
});
test('新读取的有效时间快照替换 IDB 中无时间旧记录',async()=>{
 const db=fakeDB(),st=createSnapshotStore({indexedDB:db,storage:local()});db.records.set('a',s('a',null,'unknown'));
 await st.saveSnapshot(s('a','2026-10-29T02:00:00Z','fresh'));assert.equal((await st.getSnapshots(['a'])).a.text,'fresh');
});
test('新读取的快照没有有效采集时间时拒绝保存',async()=>{
 const db=fakeDB(),st=createSnapshotStore({indexedDB:db,storage:local()});
 await assert.rejects(st.saveSnapshot(s('a',null)),/有效采集时间/);await assert.rejects(st.saveSnapshot(s('a','invalid')),/有效采集时间/);assert.equal(db.records.size,0);
});
test('迁移成功后仅清旧快照，保留队列与事件并可重复调用',async()=>{
 const db=fakeDB(),storage=local({snapshots:{a:s('a','2026-10-28T02:00:00Z')},events:[1],queue:[2]});
 const st=createSnapshotStore({indexedDB:db,storage});assert.deepEqual(await st.migrateLegacySnapshots(),{migrated:1});
 assert.equal(storage.data.snapshots,undefined);assert.deepEqual(storage.data.events,[1]);assert.deepEqual(storage.data.queue,[2]);
 assert.deepEqual(await st.migrateLegacySnapshots(),{migrated:0});assert.ok((await st.getSnapshots(['a'])).a);
});
test('迁移事务失败不删除原始快照',async()=>{
 const legacy={a:s('a','2026-10-28T02:00:00Z')},db=fakeDB({failWrite:true}),storage=local({snapshots:legacy});
 const st=createSnapshotStore({indexedDB:db,storage});await assert.rejects(st.migrateLegacySnapshots(),/事务失败/);
 assert.deepEqual(storage.data.snapshots,legacy);assert.equal(db.records.size,0);assert.equal(db.closes,1);
});
test('迁移旧记录不能覆盖较新或时间不明的 IDB 快照',async()=>{
 const db=fakeDB(),storage=local({snapshots:{a:s('a','2026-10-28T02:00:00Z','old'),b:s('b','2026-10-28T02:00:00Z','old')}});
 db.records.set('a',s('a','2026-10-29T02:00:00Z','new'));db.records.set('b',s('b',null,'unknown'));
 await createSnapshotStore({indexedDB:db,storage}).migrateLegacySnapshots();assert.equal(db.records.get('a').text,'new');assert.equal(db.records.get('b').text,'unknown');
});
test('旧快照在迁移中改变时不会移除',async()=>{
 const db=fakeDB(),original={a:s('a','2026-10-28T02:00:00Z')};let calls=0,removed=false;
 const storage={async get(){calls++;return {snapshots:calls===1?original:{...original,b:s('b','2026-10-29T00:00:00Z')}};},async remove(){removed=true;}};
 await assert.rejects(createSnapshotStore({indexedDB:db,storage}).migrateLegacySnapshots(),/发生变化/);assert.equal(removed,false);
});
test('删除旧字段失败后可以安全重试',async()=>{
 const db=fakeDB(),legacy={a:s('a','2026-10-28T02:00:00Z')};let removed=false,fail=true;
 const storage={async get(){return {snapshots:removed?undefined:legacy};},async remove(){if(fail)throw Error('storage offline');removed=true;}};
 const st=createSnapshotStore({indexedDB:db,storage});await assert.rejects(st.migrateLegacySnapshots(),/storage offline/);
 assert.equal(removed,false);assert.ok(db.records.get('a'));fail=false;
 await st.migrateLegacySnapshots();assert.equal(removed,true);assert.ok(db.records.get('a'));
});
test('数据库 blocked 显示明确错误',async()=>{
 await assert.rejects(createSnapshotStore({indexedDB:fakeDB({blocked:true}),storage:local()}).getSnapshots(['a']),/其他页面占用/);
});
