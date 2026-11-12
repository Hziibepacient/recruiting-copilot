// Synthetic DOM fixture executing the production content script. No browser or network.
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../extension/content.js',import.meta.url),'utf8');
export function completedDialogFixture(options={}){
 let now=1000,stopped=false;
 let listener,dialogVisible=false,contacted=false,selected=false,activeMessage=false,closeClicks=0,sendClicks=0,ids=['candidate-1'];
 const visibleNode=body=>({innerText:body||'',isConnected:true,getClientRects:()=>[{}],querySelectorAll:()=>[],querySelector:()=>null,contains:()=>false,getAttribute:()=>null,classList:{contains:()=>false}});
 const account=visibleNode('你好，DEMO_ACCOUNT'),opener=visibleNode('立即沟通'),close=visibleNode(''),selector=visibleNode('');
 const config={account:'DEMO_ACCOUNT',jobId:'job1',greeting:'默认问候'};
 const choice=visibleNode(config.greeting),selection=visibleNode('Agent 开发专家'),button=visibleNode('立即开聊');
 button.getAttribute=k=>k==='data_info'?encodeURIComponent(JSON.stringify({userc_id_encode:'native1'})):null;
 const option=visibleNode();option.textContent='job1';option.id='option-job1';option.outerHTML='<option/>';
 option.getAttribute=k=>k==='aria-selected'&&selected?'true':null;
 const box={closest:()=>({querySelector:()=>selector}),focus:()=>{},getAttribute:()=>option.id,dispatchEvent:ev=>{if(ev.key==='Enter')selected=true;}};
 selector.dispatchEvent=()=>{};
 const dialog=visibleNode('请选择职位开聊');dialog.getClientRects=()=>dialogVisible?[{}]:[];
 dialog.querySelector=s=>s==='#jobId'?box:s==='.ant-select-selection-item'&&selected?selection:null;
 dialog.querySelectorAll=s=>s==='.li-item'?[choice]:s==='.li-item.li-select-active'?(activeMessage?[choice]:[]):s==='button[type=submit].xpath-job-and-msg-ok-btn-new'?[button]:[close];
 dialog.contains=e=>[close,button,choice,selector].includes(e);
 const row=visibleNode();let currentRow=row;Object.defineProperty(row,'innerText',{get:()=>contacted?'候选人 继续沟通':'候选人 立即沟通'});
 row.classList=['r-candidate-1'];row.classList.contains=v=>row.classList.includes(v);
 row.querySelectorAll=()=>[opener];row.contains=e=>e===opener;
 class Input{get value(){return this._value||'old';}set value(v){this._value=v;}dispatchEvent(){}}
 const input=new Input(),searchButton=visibleNode('搜 索');searchButton.closest=()=>searchButton;
 const document={body:visibleNode('content '.repeat(30)),hasFocus:()=>true,visibilityState:'visible',
  querySelector:s=>s==='#rc_select_1'?input:null,
  querySelectorAll:s=>s==='.ant-spin-spinning'&&now<(options.spinnerUntil||0)?[visibleNode('加载中')]:s==='[role=dialog]'?(dialogVisible?[dialog]:[]):s==='p,a,span,div'?[account]:s==='tr'?ids.map(id=>id==='candidate-1'?currentRow:{classList:['r-'+id]}):s==='[role=option]'?[option]:s==='button,a,span,em'?[searchButton]:[],
 };
 const context=vm.createContext({document,location:{hostname:'h.liepin.com'},HTMLInputElement:Input,Event:class{},MouseEvent:class{},KeyboardEvent:class{constructor(type,args){Object.assign(this,args);}},Date:class extends Date{static now(){return now;}},URL,TextEncoder,setTimeout:fn=>{now+=150;queueMicrotask(fn);},
  innerWidth:1200,innerHeight:800,scrollX:0,scrollY:0,visualViewport:null,
  chrome:{storage:{local:{set:async()=>{},get:async()=>({stop:stopped})}},runtime:{onMessage:{addListener:fn=>listener=fn}}},
  getComputedStyle:()=>({visibility:'visible',display:'block'}),RCPageControls:{resolveControl:e=>e,click:async(el,before=()=>{},guard=async()=>{},validate=()=>{})=>{
   await guard();if(el===button&&options.beforeSend)await options.beforeSend({advance:ms=>now+=ms});validate();before();if(el===opener)dialogVisible=true;else if(el===choice)activeMessage=true;else if(el===button){sendClicks++;contacted=true;now+=options.advanceAfterClick||0;if(options.replaceRowAfterClick)currentRow=Object.create(row);}else if(el===close){closeClicks++;dialogVisible=false;}else if(el===searchButton)ids=['new-candidate'];
  }},
 });
 vm.runInContext(source,context);
 return {run:(type,extra={})=>new Promise(resolve=>listener({type,id:'candidate-1',usercId:'native1',config,keyword:'new',...extra},{},resolve)),changeJob:()=>selection.innerText='用户改选的职位',replaceRow:()=>currentRow=Object.create(row),setStopped:value=>stopped=value,changeAccount:()=>account.innerText='你好，OTHER_FIXTURE',stats:()=>({closeClicks,sendClicks})};
}
