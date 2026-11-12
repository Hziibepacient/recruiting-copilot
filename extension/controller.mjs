import {validatePermit} from './acceptance.mjs';
import {DEFAULTS,day,validateConfig,validateDecision,checkBudget,alreadySent,batchUsed,unresolvedAttempts,checkNextBatch,needsKeywordSwitch} from './core.mjs';
import * as snapshotStore from './snapshot-store.mjs';
import {RELEASE,PAGE_PROTOCOL,CLICK_VERSION} from './protocol.mjs';

export function createController({store=snapshotStore}={}){
let busy=false;
let operationDeadline=Infinity;
async function state(){const s=await chrome.storage.local.get(['config','events','queue','run','historyAccount','preparedReview','stop']);if(!s.run?.batchId){s.run={batchId:crypto.randomUUID(),sent:0,keywordIndex:0};await chrome.storage.local.set({run:s.run});}return {release:RELEASE,stop:!!s.stop,preparedReview:s.preparedReview,historyAccount:s.historyAccount,config:s.config||{...DEFAULTS},events:s.events||[],queue:s.queue||[],run:s.run};}
async function bounded(promise,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('页面响应超时')),ms);})]);}finally{clearTimeout(timer);}}

async function page(tabId,m){
 if(Date.now()>=operationDeadline)throw Error('任务已过期，未开始页面操作');
 const t=await chrome.tabs.get(tabId);if(!t.url?.startsWith('https://h.liepin.com/'))throw Error('目标标签页已离开猎聘');
 await chrome.storage.local.set({controllerProgress:{phase:'health',operation:m.type,time:new Date().toISOString()}});
 const health=await bounded(chrome.tabs.sendMessage(tabId,{type:'health'}),Math.max(1,Math.min(15000,operationDeadline-Date.now())));if(health?.data?.protocol!==PAGE_PROTOCOL||health?.data?.clickVersion!==CLICK_VERSION)throw Error('猎聘页面脚本版本不匹配；需要刷新猎聘页');
 await chrome.storage.local.set({controllerProgress:{phase:'request',operation:m.type,health:health.data,time:new Date().toISOString()}});
 const timeout=m.type==='prepare'?35000:m.type==='search'?25000:15000;
 const deadlineAt=Math.min(operationDeadline,Date.now()+timeout-500);
 if(deadlineAt<=Date.now())throw Error('任务已过期，未执行页面操作');
 const r=await bounded(chrome.tabs.sendMessage(tabId,{...m,deadlineAt}),Math.max(1,Math.min(timeout,deadlineAt-Date.now()+300)));if(!r?.ok)throw Error(r?.error||'页面未响应，重新加载猎聘后再试');return r.data;
}
async function event(s,id,status,extra={}){s.events.push({account:s.config.account,jobId:s.config.jobId,candidateId:id,status,batchId:s.run.batchId,day:day(),time:new Date().toISOString(),...extra});await chrome.storage.local.set({events:s.events});}
async function evidence(ids){await store.migrateLegacySnapshots();return store.getSnapshots(ids);}
async function handle(m){
 if(m.type==='run'&&!m._permit)throw Error('发送锁定：缺少一次许可');
 // Keep the bridge response small: detailed snapshots stay in local storage
 // and are independently checked by the operator before a send.
 if(m.type==='state')return state();
 if(m.type==='tabs')return (await chrome.tabs.query({url:'https://h.liepin.com/*'})).map(t=>({id:t.id,title:t.title,url:t.url}));
 if(m.type==='diagnostics'){const data=await chrome.storage.local.get(['controllerProgress','pageProgress','stop']);data.release=RELEASE;data.localStorageBytes=await chrome.storage.local.getBytesInUse?.(null);if(m.tabId){try{const t=await chrome.tabs.get(m.tabId);data.boundTab={id:t.id,url:t.url,title:t.title,status:t.status,discarded:t.discarded,width:t.width,height:t.height};if(t.url?.startsWith('https://h.liepin.com/'))data.pageHealth=await bounded(chrome.tabs.sendMessage(t.id,{type:'health'}));}catch(e){data.boundTab={error:e.message};}}return data;}
 if(m.type==='openSearch'){const t=await chrome.tabs.create({url:'https://h.liepin.com/search/getConditionItem#session',active:true});return {tabId:t.id};}
 if(m.type==='activate'){const t=await chrome.tabs.get(m.tabId);if(!t.url?.startsWith('https://h.liepin.com/'))throw Error('不是猎聘页');if(m.background===true){const w=await chrome.windows.update(t.windowId,{state:'normal',width:1280,height:900,focused:false});return {restored:true,focused:w.focused,width:w.width,height:w.height,state:w.state,windowId:w.id,tabId:t.id};}await chrome.windows.update(t.windowId,{focused:true});await chrome.tabs.update(m.tabId,{active:true});return {activated:true,tabId:m.tabId};}
 if(m.type==='stop'){await chrome.storage.local.set({stop:true});return '已请求停止；正在核验的发送将先完成回执检查';}
 if(busy)throw Error('操作进行中，请先停止或等待');busy=true;operationDeadline=Number.isFinite(m._deadlineAt)?m._deadlineAt:Infinity;
 try{const s=await state();
  if(m.type==='dialogDiagnostics')return await page(m.tabId,{type:'dialogDiagnostics'});
  if(m.type==='reloadSearch'){
   if(!s.stop||unresolvedAttempts(s.events,s.config).length)throw Error('刷新前需停止发送并核验未决');
   const tab=await chrome.tabs.get(m.tabId);
   if(!tab.url?.startsWith('https://h.liepin.com/search/'))throw Error('只允许刷新已绑定搜索页');
   await chrome.storage.local.set({preparedReview:null});await chrome.tabs.reload(m.tabId);
   return {reloaded:true,tabId:m.tabId,requiresRead:true};
  }
  if(m.type==='migrateStorage')return await store.migrateLegacySnapshots();
  if(m.type==='preflight'){
   const p=s.preparedReview;
   if(!p||p.candidateId!==m.id||p.account!==s.config.account||p.batchId!==s.run.batchId)throw Error('缺少当前候选人准备记录');
   const age=Date.now()-Date.parse(p.preparedAt);
   if(!Number.isFinite(age)||age<0||age>600000)throw Error('准备记录过期，请重新准备');
   validateDecision(s.queue.find(d=>d.candidateId===m.id),await evidence([m.id]),s.config);
   if(s.historyAccount!==s.config.account)throw Error('历史去重尚未导入');
   checkBudget(s.events,s.config);
   if(alreadySent(s.events,s.config.account,m.id))throw Error('历史已联系');
   if(batchUsed(s.events,s.config,s.run.batchId)>=s.config.batchLimit||needsKeywordSwitch(s))throw Error('已到批次或换词节点');
   const result=await page(m.tabId,{type:'validatePrepared',id:m.id,usercId:p.usercId,config:s.config});
   if(result.ready!==true||result.candidateId!==m.id||result.usercId!==p.usercId||result.jobId!==s.config.jobId||result.greeting!==s.config.greeting)throw Error('发送前回读不一致');
   return {...result,dryRun:true,submitted:false};
  }
  if(m.type==='resume'){
   checkBudget(s.events,s.config);
   const list=await page(m.tabId,{type:'inspect'});
   if(list.kind!=='list'||!list.pageText.includes('你好，'+s.config.account))throw Error('恢复前需核验同一账号搜索列表');
   await chrome.storage.local.set({stop:false,preparedReview:null});
   return {resumed:true,requiresFreshPrepare:true};
  }
  if(m.type==='nextBatch'){
   const list=await page(m.tabId,{type:'inspect'});
   if(list.kind!=='list')throw Error('请先回到猎聘搜索列表');
   if(!list.pageText.includes('你好，'+s.config.account))throw Error('未核验当前登录账号');
   checkNextBatch(s,list.keyword);
   const keywordCarry=(s.run.keywordCarry||0)+batchUsed(s.events,s.config,s.run.batchId)-(s.run.switchCheckpoint||0);
   const run={...s.run,keywordCarry,batchId:crypto.randomUUID(),sent:0,switchCheckpoint:0,needsKeywordChange:false};
   await chrome.storage.local.set({run,preparedReview:null,queue:[]});
   return {batchId:run.batchId,keyword:run.lastKeyword,sent:0};
  }
  if(m.type==='preview'||m.type==='prepare'){
   await chrome.storage.local.set({preparedReview:null});
   const d=s.queue.find(x=>x.candidateId===m.id);validateDecision(d,await evidence([d?.candidateId]),s.config);
   if(alreadySent(s.events,s.config.account,m.id))throw Error('历史已联系');checkBudget(s.events,s.config);
   if(batchUsed(s.events,s.config,s.run.batchId)>=s.config.batchLimit)throw Error('本批上限已到');
   if(needsKeywordSwitch(s))throw Error('已成功十人，先更换关键词');
   const before=await page(m.tabId,{type:'inspect'});if(before.kind!=='list')throw Error('不在搜索页');s.run.lastKeyword=before.keyword;await chrome.storage.local.set({run:s.run});await chrome.tabs.update(m.tabId,{active:true});const r=await page(m.tabId,{type:m.type,id:m.id,config:s.config});
   if(r.ready){const preparedReview={...r,digest:d.digest,batchId:s.run.batchId,account:s.config.account,preparedAt:new Date().toISOString()};await chrome.storage.local.set({preparedReview});return preparedReview;}return r;
  }
  if(m.type==='search'){
   await chrome.storage.local.set({preparedReview:null});
   if(typeof m.keyword!=='string'||!m.keyword.trim())throw Error('搜索词为空');
   if(Object.hasOwn(m,'page')&&!Number.isInteger(m.page))throw Error('页码无效');
   if(Number.isInteger(m.page)){
    if(needsKeywordSwitch(s)||m.keyword!==s.run.lastKeyword)throw Error('翻页必须保持当前关键词且尚未到换词节点');
    if(!Number.isInteger(m.page)||m.page<2)throw Error('页码无效');
    await chrome.storage.local.set({preparedReview:null});
    await chrome.tabs.update(m.tabId,{active:true});return await page(m.tabId,{type:'search',keyword:m.keyword,page:m.page,config:s.config});
   }
   const mustSwitch=needsKeywordSwitch(s);
   if(mustSwitch&&(!s.run.lastKeyword||m.keyword===s.run.lastKeyword))throw Error('需要更换关键词');
   await chrome.tabs.update(m.tabId,{active:true});const result=await page(m.tabId,{type:'search',keyword:m.keyword,config:s.config});
   if(result.keyword!==m.keyword)throw Error('搜索词回读不一致');
   if(m.keyword!==s.run.lastKeyword||mustSwitch){s.run.keywordCarry=0;s.run.keywordIndex++;s.run.switchCheckpoint=batchUsed(s.events,s.config,s.run.batchId);}
   s.run.lastKeyword=m.keyword;s.run.needsKeywordChange=false;await chrome.storage.local.set({run:s.run});return result;
  }
  if(m.type==='config'){validateConfig(m.value);if(unresolvedAttempts(s.events,s.config).length)throw Error('未明发送尚未核验，不能更换配置');await chrome.storage.local.set({config:m.value,preparedReview:null,queue:[]});return '配置已保存';}
  if(m.type==='openDetail'){
   const list=await page(m.tabId,{type:'inspect'});if(list.kind!=='list'||list.candidates.filter(c=>c.candidateId===m.id).length!==1)throw Error('当前列表无法唯一确认目标');
   const found=(await chrome.tabs.query({url:'https://h.liepin.com/resume/showresumedetail/*'})).filter(t=>new URL(t.url).searchParams.get('res_id_encode')===m.id);
   if(found.length===1){const detail=await page(found[0].id,{type:'inspect'});if(detail.kind!=='detail'||detail.candidateId!==m.id)throw Error('现有详情标签不可读或身份不符');return {tabId:found[0].id,reused:true,complete:detail.complete};}
   const tab=await chrome.tabs.create({url:'https://h.liepin.com/resume/showresumedetail/?res_id_encode='+encodeURIComponent(m.id),active:false});return {tabId:tab.id};
  }
  if(m.type==='read'){const r=await page(m.tabId,{type:'inspect'});if(r.kind==='detail'){await store.migrateLegacySnapshots();await store.saveSnapshot(r);}return r;}
  if(m.type==='import'){if(!Array.isArray(m.value))throw Error('筛选结果应为JSON数组');const records=await evidence(m.value.map(d=>d?.candidateId));for(const d of m.value)validateDecision(d,records,s.config);s.queue=m.value;await chrome.storage.local.set({queue:s.queue,preparedReview:null});return '已导入'+s.queue.length+'份筛选结果';}
  if(m.type==='history'){if(!Array.isArray(m.value)||!m.value.length)throw Error('历史记录须为非空数组');for(const e of m.value){if(e.status!=='verified'||!e.candidateId||e.account!==s.config.account||!/^\d{4}-\d{2}-\d{2}$/.test(e.day))throw Error('仅接受同账号、含日期的成功记录');}s.events.push(...m.value.map(e=>({...e,origin:'historical-import'})));await chrome.storage.local.set({events:s.events,historyAccount:s.config.account});return '已导入历史去重记录';}
  if(m.type==='reconcile'){
   for(const e of unresolvedAttempts(s.events,s.config)){
    if(e.jobId!==s.config.jobId||!e.usercId)throw Error('原发送缺少身份绑定或职位不同，保留未决并人工核验');
    const r=await page(m.tabId,{type:'receipt',id:e.candidateId,usercId:e.usercId,config:s.config});
    if(r.verified!==true||r.candidateId!==e.candidateId||r.usercId!==e.usercId)throw Error('未找到成功回执，保留结果不明状态');
    await event(s,e.candidateId,'verified',{receipt:'续接核验同一行继续沟通',origin:'extension',day:e.day,batchId:e.batchId,jobId:e.jobId,usercId:e.usercId,permitId:e.permitId});
   }return '回执已核验';
  }
  if(m.type==='run'){
   validateConfig(s.config);const used=(await chrome.storage.local.get('usedPermits')).usedPermits||{};
   const p=validatePermit(m,s,used),d=s.queue[0];let usedBatch; 
   try{validateDecision(d,await evidence([d?.candidateId]),s.config);
   if(s.historyAccount!==s.config.account)throw Error('历史去重尚未导入');
   checkBudget(s.events,s.config);usedBatch=batchUsed(s.events,s.config,s.run.batchId);if(usedBatch>=s.config.batchLimit)throw Error('本批上限已到');if(needsKeywordSwitch(s))throw Error('已成功十人，先更换关键词');if(alreadySent(s.events,s.config.account,d.candidateId))throw Error('历史已联系');
   if((await chrome.storage.local.get('stop')).stop)throw Error('已请求停止');
   await page(m.tabId,{type:'validatePrepared',id:d.candidateId,usercId:p.usercId,config:s.config});
   }catch(e){return {notSent:true,submitted:false,phase:'preflight',candidateId:p.candidateId,usercId:p.usercId,error:e.message};}
   used[p.permitId]={commandId:p.commandId,candidateId:p.candidateId,time:new Date().toISOString()};
   s.events.push({account:s.config.account,jobId:s.config.jobId,candidateId:d.candidateId,status:'pending',batchId:s.run.batchId,day:day(),time:new Date().toISOString(),permitId:p.permitId,usercId:p.usercId});
   await chrome.storage.local.set({events:s.events,usedPermits:used});
   if((await chrome.storage.local.get('stop')).stop){await event(s,d.candidateId,'not_sent',{error:'发送前收到停止请求',permitId:p.permitId});return {notSent:true,submitted:false,phase:'preflight',candidateId:p.candidateId,usercId:p.usercId,error:'发送前收到停止请求'};}
   try{
    const result=await page(m.tabId,{type:'send',id:d.candidateId,usercId:p.usercId,config:s.config});
    if(result.notSent===true&&result.verified!==true){await event(s,d.candidateId,'not_sent',{error:result.error,permitId:p.permitId});return {...result,submitted:false,phase:'preflight',candidateId:p.candidateId,usercId:p.usercId};}
    if(result.verified!==true||result.notSent===true||typeof result.receipt!=='string'||!result.receipt.trim()||result.submitted===false||result.candidateId!==p.candidateId||result.usercId!==p.usercId)throw Error('同人回执未知');
    await event(s,d.candidateId,'verified',{receipt:result.receipt,origin:'extension',usercId:p.usercId,permitId:p.permitId});
    s.run.sent=usedBatch+1;s.run.needsKeywordChange=(s.run.keywordCarry||0)+s.run.sent-(s.run.switchCheckpoint||0)>=s.config.switchAfter;await chrome.storage.local.set({run:s.run});return {...result,needsKeywordChange:s.run.needsKeywordChange,batchSent:s.run.sent};
   }catch(e){await event(s,d.candidateId,'uncertain',{error:e.message,usercId:p.usercId,permitId:p.permitId});throw Error('已暂停，须先核验回执：'+e.message);}
  }throw Error('未知请求');
 }finally{busy=false;operationDeadline=Infinity;}
}

return handle;
}
export const handle=createController();
