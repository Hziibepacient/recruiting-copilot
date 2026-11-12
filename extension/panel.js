import {handle} from './controller.mjs';
import {day,batchUsed,unresolvedAttempts,needsKeywordSwitch} from './core.mjs';
const $=id=>document.getElementById(id);
let refreshing=false;
async function refresh(){
 if(refreshing)return;refreshing=true;
 try{
  const s=await handle({type:'state'});
  $('todayCount').textContent=new Set(s.events.filter(e=>e.account===s.config.account&&e.status==='verified'&&e.day===day()).map(e=>e.candidateId)).size;
  $('unknownCount').textContent=unresolvedAttempts(s.events,s.config).length;
  $('batchCount').textContent=batchUsed(s.events,s.config,s.run.batchId);
  $('keyword').textContent=s.run.lastKeyword||'尚未确认';
  $('runState').textContent=s.stop?'已停止；恢复前需核验':'等待已审核任务';
  $('nextStep').textContent=unresolvedAttempts(s.events,s.config).length?'先核验未明回执':needsKeywordSwitch(s)?'已到换词节点，先搜索另一个关键词':'可继续读取与审核下一人';
  const d=await handle({type:'diagnostics'});
  // No candidate text, native IDs, credentials or raw queue in this diagnostic view.
  $('result').textContent=JSON.stringify({release:s.release,localStorageBytes:d.localStorageBytes,controller:d.controllerProgress,page:d.pageProgress,stopped:!!d.stop},null,2);
 }catch(e){$('status').textContent='读取状态失败：'+e.message;}
 finally{refreshing=false;}
}
$('refresh').onclick=refresh;
$('advanced').onclick=()=>{$('result').hidden=!$('result').hidden;};
refresh();setInterval(refresh,5000);
