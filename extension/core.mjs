import {SCOPE} from './scope.mjs';
export const DEFAULTS = Object.freeze({...SCOPE,jobTitle:'Agent 开发专家（Java 后端 / AI 应用）',batchLimit:20,dailyLimit:60,switchAfter:10,keywords:['Java,Agent','智能体 后端','Agent 平台']});
export const day = (date=new Date()) => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function validateDecision(d, snapshots, config) {
  if (!d || !['CRM','通用'].includes(d.direction)) throw Error('缺少方向');
  if(typeof d.candidateId!=='string'||!Object.hasOwn(snapshots,d.candidateId))throw Error('无对应简历');
  const s=snapshots[d.candidateId];
  if (!s || !s.complete || s.digest!==d.digest) throw Error('简历未读完整或材料版本不一致');
  if(d.account!==config.account || d.jobId!==config.jobId) throw Error('账号或职位不一致');
  // AI-assisted development is a scoring/preference item, not a universal
  // hard gate for outreach in the current Xiaoman workflow.
  const gates=['education','backend','expected_city','agent','delivery'];
  if(d.direction==='CRM') gates.push('java');
  for(const k of gates){const g=d.gates?.[k];if(g?.state!=='pass'||typeof g.quote!=='string'||g.quote.length<4||!s.text.includes(g.quote))throw Error('门槛缺证据：'+k);}
  if(d.approved!==true)throw Error('尚未确认筛选通过');
  return d;
}
export function unresolvedAttempts(events, config) {
  const unresolved=new Map();
  for(const e of events){
    if(e.account!==config.account||e.origin==='historical-import')continue;
    const key=e.permitId||[e.account,e.candidateId,e.batchId||'legacy'].join('|');
    if(['pending','uncertain'].includes(e.status))unresolved.set(key,e);
    else if(['verified','not_sent','failed'].includes(e.status)){
      const pending=unresolved.get(key);
      if(pending&&(!pending.time||(e.time&&e.time>=pending.time)))unresolved.delete(key);
    }
  }
  return [...unresolved.values()];
}
export function checkBudget(events, config, today=day()) {
  if(unresolvedAttempts(events,config).length)throw Error('存在发送结果不明记录，先核回执');
  const used=new Set(events.filter(e=>e.account===config.account&&e.day===today&&e.status==='verified').map(e=>e.candidateId)).size;
  if(used>=config.dailyLimit)throw Error('今日额度上限已到');
  return used;
}
export function batchUsed(events,config,batchId){return new Set(events.filter(e=>e.account===config.account&&e.batchId===batchId&&e.origin==='extension'&&e.status==='verified').map(e=>e.candidateId)).size;}
export function needsKeywordSwitch(s) {
  const count=batchUsed(s.events,s.config,s.run.batchId);
  const checkpoint=Number.isInteger(s.run.switchCheckpoint)?s.run.switchCheckpoint:0;
  if(checkpoint<0||checkpoint>count)throw Error('换词记录异常');
  const carry=s.run.keywordCarry??0;
  if(!Number.isInteger(carry)||carry<0||carry>=s.config.switchAfter)throw Error('跨批换词计数异常');
  return !!s.run.needsKeywordChange||carry+count-checkpoint>=s.config.switchAfter;
}
export function checkNextBatch(s, currentKeyword) {
  validateConfig(s.config);
  if(s.historyAccount!==s.config.account)throw Error('历史去重尚未导入');
  checkBudget(s.events,s.config);
  if(!s.run?.batchId||batchUsed(s.events,s.config,s.run.batchId)<s.config.batchLimit)throw Error('本批尚未完成');
  if(needsKeywordSwitch(s))throw Error('先更换关键词');
  if(!s.run.lastKeyword||currentKeyword!==s.run.lastKeyword)throw Error('当前搜索词与已确认的关键词不一致');
}
export function alreadySent(events, account, id){return events.some(e=>e.account===account&&e.candidateId===id&&e.status==='verified');}
export function validateConfig(c){
  if(!c.account?.trim()||!/^\d+$/.test(c.jobId)||!c.jobTitle?.trim()||!c.greeting?.trim())throw Error('账号、职位、文案不能为空');
  if(!Number.isInteger(c.batchLimit)||c.batchLimit<1||c.batchLimit>20||!Number.isInteger(c.dailyLimit)||c.dailyLimit<1||c.dailyLimit>60||c.switchAfter!==10)throw Error('本批1—20人，每日1—60人，每10个成功切词');
  if(!Array.isArray(c.keywords)||!c.keywords.length||c.keywords.some(x=>typeof x!=='string'||!x.trim()))throw Error('关键词不能为空');
  return c;
}
