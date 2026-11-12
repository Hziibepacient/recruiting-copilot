import {handle} from './controller.mjs';
import {requestJSON,checkCommandDeadline,persistResultOrReport,interruptionResult} from './transport.mjs';
const connection=document.getElementById('connection');
document.getElementById('assistantStop').onclick=async()=>{try{document.getElementById('status').textContent=await handle({type:'stop'});}catch(e){document.getElementById('status').textContent='停止请求未保存：'+e.message;}};

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function loop(){
 // Page operations validate protocol individually; startup must not reload user tabs.
 let config,failures=0;
 for(;;){
  try{
   config ||= await requestJSON(chrome.runtime.getURL('bridge-config.json'));
   const headers={Authorization:'Bearer '+config.token,'X-TTC-Client':'direct-1'};
   // Persist results before posting; retry only the identical result, never the action.
   let pending=(await chrome.storage.local.get('bridgePendingResult')).bridgePendingResult;
   const inflight=(await chrome.storage.local.get('bridgeInflight')).bridgeInflight;
   if(!pending&&inflight){pending=interruptionResult(inflight.id);await chrome.storage.local.set({bridgePendingResult:pending});}
   if(!pending){
    const job=await requestJSON(config.url+'/next',{headers});
    connection.textContent='本机连接正常 · 等待助手任务';document.getElementById('connectionHelp').textContent='已连接本机任务桥。收到任务后逐条执行，发送结果不明时停止。';failures=0;
    if(job){
     await chrome.storage.local.set({bridgeInflight:{id:job.id,type:job.command.type}});
     let result;
     try{checkCommandDeadline(job);result={ok:true,data:await handle({...job.command,_deadlineAt:job.expiresAt*1000})};}catch(e){result={ok:false,error:e.message};}
     pending=await persistResultOrReport(job,result,chrome.storage.local,
      fallback=>requestJSON(config.url+'/result',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(fallback)}));
     if(!pending)connection.textContent='操作结果未能保存，已要求核验';
    }
   }
   if(pending){
    await requestJSON(config.url+'/result',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(pending)});
    await chrome.storage.local.remove(['bridgePendingResult','bridgeInflight']);
    document.getElementById('status').textContent=pending.result.ok?'结果已回传':'操作停止：'+pending.result.error;
   }
  }catch(e){failures++;connection.textContent='连接未就绪 · '+e.name+' · '+e.message;document.getElementById('connectionHelp').textContent=config?'请检查本机服务是否运行（python bridge.py status）。网络恢复后会重连；已发操作不会自动重做。':'请先在项目目录运行 python bridge.py status 生成本机配置；配置不随公开安装包分发。';}
  await delay(failures?Math.min(8000,1000*2**Math.min(failures,3)):1000);
 }
}
async function start(){
 try{
  connection.textContent='等待唯一控制权；已有助手页面时请使用原页面';
  await navigator.locks.request('ttc-liepin-controller',loop);
 }catch(e){connection.textContent='初始化失败：'+e.name+' · '+e.message;}
}
start();
