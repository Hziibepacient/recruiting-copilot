// Local account/job binding is deliberately absent from the public repository.
export const DEMO_SCOPE=Object.freeze({account:'DEMO_ACCOUNT',jobId:'10000000',greeting:'你好~我这里有个职位很适合你，待遇优厚，了解一下吗？期待回复！'});
let scope=DEMO_SCOPE;
if(globalThis.chrome?.runtime?.getURL){
 let response;
 try{response=await fetch(chrome.runtime.getURL('outreach-scope.json'));}catch{/* Public demo has no local account file. */}
 if(response?.ok){
  const value=await response.json();
  if(typeof value.account!=='string'||!value.account.trim()||typeof value.jobId!=='string'||!/^\d+$/.test(value.jobId)||typeof value.greeting!=='string'||!value.greeting.trim())throw Error('本机授权范围配置无效');
  scope={account:value.account,jobId:value.jobId,greeting:value.greeting};
 }
}
export const SCOPE=Object.freeze(scope);
