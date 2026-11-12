// Outreach scope remains fixed; each reviewed candidate gets a separate permit.
import {SCOPE} from './scope.mjs';
export {SCOPE};
export function validatePermit(m,s,used,now=Date.now()){
 const p=m._permit;
 if(!p||p.state!=='consumed'||!p.permitId||p.permitId!==m.permitId||p.commandId!==m._commandId)throw Error('发送锁定：缺少已消费的一次许可');
 if(!Number.isFinite(p.expiresAt)||p.expiresAt*1000<=now)throw Error('发送许可过期');
 if(used[p.permitId])throw Error('发送许可已使用，禁止重试');
 for(const [k,v] of Object.entries(SCOPE))if(p[k]!==v)throw Error('发送许可范围不符：'+k);
 if(!/^[A-Za-z0-9]{15,80}$/.test(p.candidateId)||!/^[a-f0-9]{32}$/.test(p.usercId)||!/^[a-f0-9]{64}$/.test(p.digest))throw Error('发送许可身份或材料格式不符');
 if(p.batchId!==s.run.batchId)throw Error('发送许可批次不符');
 for(const k of ['candidateId','usercId','digest','batchId','jobId','greeting'])if(p[k]!==s.preparedReview?.[k])throw Error('发送许可与本次准备不符：'+k);
 if(m.candidateId!==p.candidateId||s.config.account!==p.account||s.config.jobId!==p.jobId||s.config.greeting!==p.greeting)throw Error('发送配置与许可不一致');
 if(s.queue.length!==1||s.queue[0].candidateId!==p.candidateId||s.queue[0].digest!==p.digest)throw Error('许可只能发送已审核的一人');
 return p;
}
