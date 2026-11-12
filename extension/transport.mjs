export async function requestJSON(url,options={},timeout=8000){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});
 if(!response.ok)throw Error('连接HTTP '+response.status);
 return response.json();
}

// A leased command can arrive after its caller has timed out. Never begin it
// after its deadline, including a run whose permit was already consumed.
export function checkCommandDeadline(job,now=Date.now()){
 if(!Number.isFinite(job?.expiresAt))throw Error('任务缺少有效期限，未执行');
 if(job.expiresAt*1000<=now)throw Error('任务已过期，未执行');
}
export function interruptionResult(id){
 return {id,result:{ok:false,error:'操作中断或结果无法持久化；涉及发送时必须先核验回执，不自动重试。'}};
}

// Persist normally so a lost POST is retried with exactly the same payload.
// If storage rejects the payload, post a small conservative result instead.
// The inflight marker is removed only after the server has acknowledged it.
export async function persistResultOrReport(job,result,storage,post){
 const pending={id:job.id,result};
 try{await storage.set({bridgePendingResult:pending});return pending;}
 catch(e){
  const fallback=interruptionResult(job.id);
  await post(fallback);
  await storage.remove(['bridgePendingResult','bridgeInflight']);
  return null;
 }
}
