import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON,checkCommandDeadline,persistResultOrReport,interruptionResult} from '../extension/transport.mjs';
test('结果回传HTTP失败不当作成功',async()=>{globalThis.fetch=async()=>({ok:false,status:500});await assert.rejects(requestJSON('http://127.0.0.1/result'),/500/);});
test('请求使用超时信号且回读结果',async()=>{globalThis.fetch=async(url,options)=>{assert.ok(options.signal instanceof AbortSignal);return {ok:true,json:async()=>({ok:true})};};assert.deepEqual(await requestJSON('http://127.0.0.1'),{ok:true});});
test('网络失败向上传递',async()=>{globalThis.fetch=async()=>{throw Error('network down');};await assert.rejects(requestJSON('http://127.0.0.1'),/network down/);});
test('已过期或无期限的租约不得开始执行',()=>{
 assert.throws(()=>checkCommandDeadline({expiresAt:10},10000),/已过期/);
 assert.throws(()=>checkCommandDeadline({},10000),/缺少有效期限/);
 assert.doesNotThrow(()=>checkCommandDeadline({expiresAt:10.001},10000));
});
test('结果落盘后等待发送，发送失败不会抹掉结果',async()=>{
 let saved;const storage={set:async x=>{saved=x;},remove:async()=>{throw Error('unexpected removal');}};
 const pending=await persistResultOrReport({id:'a'},{ok:true},storage,async()=>{throw Error('unexpected post');});
 assert.deepEqual(saved.bridgePendingResult,pending);
});
test('存储配额不足时返回保守结果并在服务器确认后才释放标记',async()=>{
 const calls=[];const storage={set:async()=>{throw Error('QUOTA_BYTES');},remove:async keys=>calls.push(['remove',keys])};
 const result=await persistResultOrReport({id:'a'},{ok:true,data:'large'},storage,async p=>calls.push(['post',p]));
 assert.equal(result,null);assert.equal(calls[0][0],'post');assert.equal(calls[0][1].result.ok,false);
 assert.match(calls[0][1].result.error,/核验回执/);assert.equal(calls[1][0],'remove');
});
test('存储和网络同时失败时保留 inflight，禁止伪装为发送成功',async()=>{
 let removed=false;const storage={set:async()=>{throw Error('quota');},remove:async()=>{removed=true;}};
 await assert.rejects(persistResultOrReport({id:'a'},{ok:true},storage,async()=>{throw Error('offline');}),/offline/);
 assert.equal(removed,false);
});
test('服务器存下fallback后响应丢失，恢复时使用相同payload幂等重试',async()=>{
 const storage={set:async()=>{throw Error('quota');},remove:async()=>{throw Error('must remain');}};
 let stored;await assert.rejects(persistResultOrReport({id:'a'},{ok:true},storage,async p=>{stored=p;throw Error('response lost');}),/response lost/);
 assert.deepEqual(interruptionResult('a'),stored);
 const retry=interruptionResult('a');assert.equal(JSON.stringify(retry),JSON.stringify(stored));
});
