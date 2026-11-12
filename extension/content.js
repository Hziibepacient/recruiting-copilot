(() => {
  let prepared=null;
  let opening=null;
  let openingObserver=null;
  let completedDialog=null;
  let lastClickedAttempt=null;
  let pageBusy=false;
  let pageOperation=null;
  let confirmedSearch=null;
  let operationDeadline=null;
  function ensureDeadline(deadline=operationDeadline){
    if(deadline!==null&&Date.now()>=deadline)throw Error('页面操作期限已过；未继续执行');
  }
  function messageDeadline(m){
    if(m.deadlineAt!==undefined){
      if(!Number.isFinite(m.deadlineAt)||m.deadlineAt<=0)throw Error('页面操作期限无效');
      return m.deadlineAt;
    }
    // Local unit fixtures and legacy direct callers receive a bounded default.
    // The production controller supplies an earlier explicit deadline.
    return Date.now()+(m.type==='prepare'?35000:m.type==='search'?25000:15000)-500;
  }
  const mark=async phase=>{ensureDeadline();await chrome.storage.local.set({pageProgress:{phase,time:new Date().toISOString(),visibility:document.visibilityState,focus:document.hasFocus()}});ensureDeadline();};
  const visible=e=>!!e&&e.isConnected!==false&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).opacity!=='0';
  const text=e=>(e?.innerText||'').trim();
  const wait=async(fn,ms=8000)=>{
    const deadline=operationDeadline,end=Date.now()+ms;
    while(Date.now()<end){
      ensureDeadline(deadline);const value=fn();ensureDeadline(deadline);
      if(value)return value;
      await new Promise(resolve=>setTimeout(resolve,150));
      ensureDeadline(deadline);
    }
    ensureDeadline(deadline);throw Error('页面未响应，请检查猎聘标签页');
  };
  const dialogs=()=>[...document.querySelectorAll('[role=dialog]')].filter(visible);
  function check(){if(location.hostname!=='h.liepin.com'||text(document.body).length<100)throw Error('页面空白或已离开猎聘');if(dialogs().some(d=>/安全验证|滑动验证|操作频繁|访问受限|额度不足/.test(text(d))))throw Error('平台提示验证、限制或额度问题，请人工处理');}
  function account(expected){const a=[...document.querySelectorAll('p,a,span,div')].some(e=>visible(e)&&text(e)==='你好，'+expected);if(!a)throw Error('未核验当前登录账号');}
  const click=(element,before=()=>{},guard=async()=>{},validate=()=>{})=>{
    const deadline=operationDeadline,assertActive=()=>ensureDeadline(deadline);
    assertActive();
    return RCPageControls.click(element,before,async()=>{assertActive();await guard();assertActive();},()=>{assertActive();validate();assertActive();},assertActive);
  };
  async function clickAfterLoading(el,validate){for(let i=0;i<3;i++){await wait(()=>![...document.querySelectorAll('.ant-spin-spinning')].some(visible),8000);try{return await click(el,()=>{},async()=>{},validate);}catch(e){if(!e.message.includes('ant-spin-spinning')||i===2)throw e;}}}
  const exact=(root,label)=>[...root.querySelectorAll('button,a,span,em')].filter(e=>visible(e)&&text(e)===label).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
  const row=id=>{const rs=[...document.querySelectorAll('tr')].filter(e=>e.classList.contains('r-'+id));if(rs.length!==1)throw Error('当前列表无法唯一定位候选人');return rs[0];};
  const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  async function inspect(){
    check();ensureDeadline();
    const id=new URL(location.href).searchParams.get('res_id_encode');
    if(id){
      for(let i=0;i<8;i++){
        ensureDeadline();
        const more=[...document.querySelectorAll('a,button,span,div')]
          .filter(e=>visible(e)&&/^显示其他\d+段[^\n]*$/.test(text(e)))
          .sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
        if(!more)break;
        const before=text(document.body).length;
        await click(more);
        try{await wait(()=>text(document.body).length>before||!visible(more),3000);}catch(e){ensureDeadline();break;}
      }
      ensureDeadline();
      const body=text(document.body);
      const complete=body.includes('教育经历')&&body.includes('工作经历')&&!/显示其他\d+段/.test(body);
      const hash=await digest(body);ensureDeadline();
      return {kind:'detail',candidateId:id,url:location.href,text:body,digest:hash,complete,readScope:'页面正文；附件未读取',capturedAt:new Date().toISOString()};
    }
    return {kind:'list',url:location.href,pageText:text(document.body),keyword:document.querySelector('#rc_select_1')?.value||'',candidates:[...document.querySelectorAll('tr')].map(e=>({
      candidateId:[...e.classList].find(x=>x.startsWith('r-'))?.slice(2),
      nameMarkup:e.querySelector('.new-resume-personal-name')?.outerHTML,
      parentMarkup:e.querySelector('.new-resume-personal-name')?.parentElement?.outerHTML?.slice(0,18000),
      text:text(e),contacted:text(e).includes('继续沟通'),
    })).filter(e=>e.candidateId)};
  }
  // Only normal close controls of positively identified overlays may be used.
  // Never click a recommendation action or remove DOM/masks to reach the list.
  const restrictionPattern=/安全验证|滑动验证|操作频繁|访问受限|额度不足/;
  function closeControl(d){
    const controls=[...d.querySelectorAll('button.ant-modal-close,.ant-modal-close,[aria-label="Close"],[aria-label="关闭"],.ant-notification-notice-close')].filter(visible);
    // The same close button can match several selectors; nested close icons are
    // resolved to their native control before the uniqueness check.
    const unique=[...new Set(controls.map(e=>RCPageControls.resolveControl?.(e)||e))];
    return unique.length===1?unique[0]:null;
  }
  function isCompletedDialog(d){
    if(!completedDialog||completedDialog.dialog!==d||!d.contains(completedDialog.button))return false;
    if(completedDialog.button.getAttribute('data_info')!==completedDialog.target)return false;
    if(text(d.querySelector('.ant-select-selection-item'))!==completedDialog.selected)return false;
    const selectedMessages=[...d.querySelectorAll('.li-item.li-select-active')].filter(visible);
    if(selectedMessages.length!==1||text(selectedMessages[0])!==JSON.parse(completedDialog.config).greeting)return false;
    try{return text(row(completedDialog.id)).includes('继续沟通');}catch{return false;}
  }
  function knownDismissible(d){
    const body=text(d);
    if(restrictionPattern.test(body))return false;
    if(isCompletedDialog(d))return true;
    // A job selection dialog belongs to a possible active/manual send and must
    // never be discarded merely because it contains a success notification.
    if(body.includes('请选择职位开聊')||d.querySelector('#jobId'))return false;
    return body.includes('免费开聊相似候选人')||/已向[^\n]{1,80}发送打招呼语/.test(body);
  }
  async function dismissKnownOverlays(){
    for(let attempt=0;attempt<3;attempt++){
      check();
      const active=dialogs();
      if(!active.length)return {closed:attempt};
      // Nested known dialogs use the innermost match. Unknown dialogs remain a
      // blocker and are never force-dismissed.
      const known=active.filter(knownDismissible).filter(d=>!active.some(other=>other!==d&&d.contains(other)&&knownDismissible(other)));
      if(known.length!==1)throw Error('存在未识别或仍在编辑的弹窗；未执行关闭或发送');
      const d=known[0],close=closeControl(d);
      if(!close)throw Error('已识别提示弹窗，但未找到唯一可见关闭按钮');
      await click(close,()=>{},async()=>{},()=>{
        check();
        if(!visible(d)||!d.contains(close)||!knownDismissible(d)||closeControl(d)!==close)throw Error('弹窗关闭前发生变化');
      });
      await wait(()=>!visible(d),2000);
      if(completedDialog?.dialog===d)completedDialog=null;
    }
    if(dialogs().length)throw Error('弹窗关闭次数达到上限，请检查页面');
    return {closed:3};
  }
  const rowKeys=()=>[...document.querySelectorAll('tr')].map(r=>[...r.classList].find(c=>c.startsWith('r-'))).filter(Boolean);
  const visiblePagers=()=>[...document.querySelectorAll('.ant-pagination')].filter(visible);
  const listLoading=()=>visible(document.querySelector('.ant-spin-spinning'));
  function emptyResult(){
    return [...document.querySelectorAll('.ant-empty-description,.ant-table-placeholder')]
      .some(e=>visible(e)&&/暂无|没有|无结果|无符合/.test(text(e)));
  }
  async function search(m){
    check();account(m.config.account);
    if(Object.hasOwn(m,'page')&&!Number.isInteger(m.page))throw Error('页码无效');
    await dismissKnownOverlays();
    ensureDeadline();
    prepared=null;
    const input=document.querySelector('#rc_select_1');
    if(!input)throw Error('不在搜索页');
    if(Number.isInteger(m.page)){
      if(input.value!==m.keyword)throw Error('翻页前关键词不匹配');
      const beforePagers=visiblePagers();
      if(beforePagers.length!==1)throw Error('搜索页分页器不是唯一可见控件');
      const pager=beforePagers[0],fromPage=Number(pager.querySelector('.ant-pagination-item-active')?.textContent?.trim());
      if(!Number.isInteger(fromPage)||m.page!==fromPage+1)throw Error('只允许顺序翻到下一页');
      const targets=[...pager.querySelectorAll('.ant-pagination-item')].filter(e=>visible(e)&&e.textContent.trim()===String(m.page));
      if(targets.length!==1)throw Error('当前分页器没有唯一可见目标页码');
      const item=targets[0],control=item.querySelector('a')||item,before=rowKeys().join('|');
      let last='',stable=0;
      await click(control,()=>{},async()=>{},()=>{
        check();account(m.config.account);
        if(input.value!==m.keyword)throw Error('等待翻页时关键词发生变化');
        const ps=visiblePagers();
        if(ps.length!==1||ps[0]!==pager)throw Error('分页器发生变化，请重新观察');
        if(Number(pager.querySelector('.ant-pagination-item-active')?.textContent?.trim())!==fromPage)throw Error('当前页码发生变化');
        if(dialogs().length)throw Error('翻页前出现弹窗');
        if(document.querySelector('#rc_select_1')!==input||input.value!==m.keyword)throw Error('关键词输入框已变化');
        if(item.textContent.trim()!==String(m.page)||!item.isConnected||!pager.contains(item)||!visible(control))throw Error('目标页码已变化或不可见');
      });
      await wait(()=>{
        check();account(m.config.account);
        if(document.querySelector('#rc_select_1')!==input||input.value!==m.keyword)throw Error('翻页期间关键词输入框发生变化');
        const ps=visiblePagers();
        if(ps.length!==1)return false;
        const active=Number(ps[0].querySelector('.ant-pagination-item-active')?.textContent?.trim());
        const ids=rowKeys(),signature=ids.join('|');
        if(active!==m.page||listLoading()||dialogs().length||!ids.length||signature===before){last='';stable=0;return false;}
        if(signature===last)stable++;else{last=signature;stable=1;}
        return stable>=3;
      },12000);
      const ids=rowKeys();
      confirmedSearch={keyword:input.value,signature:ids.join('|'),page:m.page};
      return {keyword:input.value,fromPage,page:m.page,candidateIds:ids,candidateCount:ids.length,confirmed:true};
    }
    const previous=rowKeys().join('|'),oldKeyword=input.value;
    // An identical query is an observation, not proof of a newly completed
    // search. Avoid dispatching a duplicate request that could arrive late.
    const currentPagers=visiblePagers();
    const currentPage=currentPagers.length===1?Number(currentPagers[0].querySelector('.ant-pagination-item-active')?.textContent?.trim()):1;
    if(oldKeyword===m.keyword&&confirmedSearch?.keyword===m.keyword&&confirmedSearch.signature===previous&&confirmedSearch.page===currentPage){
      if(listLoading()||dialogs().length)throw Error('当前结果尚未稳定，请稍后重新读取');
      return {keyword:input.value,resultsChanged:false,reusedCurrentResults:true};
    }
    confirmedSearch=null;
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    ensureDeadline();setter.call(input,m.keyword);input.dispatchEvent(new Event('input',{bubbles:true}));
    const searchControl=exact(document,'搜 索');
    let observedLoading=false,last='',stable=0;
    await click(searchControl?.closest('button')||searchControl,()=>{},async()=>{},()=>{
      check();account(m.config.account);
      if(document.querySelector('#rc_select_1')!==input||input.value!==m.keyword||dialogs().length)throw Error('提交搜索前页面条件变化');
    });
    await wait(()=>{
      check();account(m.config.account);
      if(document.querySelector('#rc_select_1')!==input||input.value!==m.keyword)throw Error('搜索期间关键词发生变化');
      if(listLoading()){observedLoading=true;stable=0;return false;}
      if(dialogs().length){stable=0;return false;}
      const ids=rowKeys(),signature=ids.join('|'),pagers=visiblePagers();
      if(pagers.length>1)return false;
      const page=pagers.length?Number(pagers[0].querySelector('.ant-pagination-item-active')?.textContent?.trim()):1;
      const empty=!ids.length&&emptyResult();
      // A reset to page one and a stable changed set (or an observed loading
      // cycle) are required. Keyword text alone never proves fresh results.
      if(page!==1||(!ids.length&&!empty)||(signature===previous&&!observedLoading)){stable=0;return false;}
      const stamp=signature+'|'+empty;
      if(stamp===last)stable++;else{last=stamp;stable=1;}
      return stable>=3;
    },12000);
    confirmedSearch={keyword:input.value,signature:rowKeys().join('|'),page:1};
    return {keyword:input.value,resultsChanged:rowKeys().join('|')!==previous,confirmed:true,page:1,candidateIds:rowKeys()};
  }
  function clearOpening(){opening=null;openingObserver?.disconnect();openingObserver=null;}
  function captureOpening(){
    if(!opening)return;
    if(Date.now()-opening.at>300000){clearOpening();return;}
    const ds=dialogs().filter(d=>text(d).includes('请选择职位开聊'));
    if(ds.length!==1)return;
    const d=ds[0],bs=[...d.querySelectorAll('button[type=submit].xpath-job-and-msg-ok-btn-new')].filter(visible);
    if(bs.length!==1)return;
    const target=bs[0].getAttribute('data_info');
    try{if(!JSON.parse(decodeURIComponent(target)).userc_id_encode)return;}catch{return;}
    if(opening.dialog&&(opening.dialog!==d||opening.button!==bs[0]||opening.target!==target)){clearOpening();return;}
    Object.assign(opening,{dialog:d,button:bs[0],target});
  }
  function resumableOpening(m,r){
    captureOpening();
    return !!opening&&opening.allowResume&&opening.id===m.id&&opening.row===r&&
      opening.config===JSON.stringify(m.config)&&visible(opening.dialog)&&
      opening.dialog.contains(opening.button)&&opening.button.getAttribute('data_info')===opening.target;
  }
  // A manual switch to another candidate invalidates the opening identity.
  document.addEventListener?.('click',e=>{
    if(!opening||!e.isTrusted)return;
    const clickedRow=e.target?.closest?.('tr');
    if(clickedRow&&clickedRow!==opening.row)clearOpening();
    else if(e.target?.closest?.('.ant-modal-close'))clearOpening();
  },true);
  async function openCandidate(m,r){
    const control=exact(r,'立即沟通');
    await click(control,()=>{
      clearOpening();opening={id:m.id,row:r,config:JSON.stringify(m.config),at:Date.now(),allowResume:true};
      if(typeof MutationObserver!=='undefined'){openingObserver=new MutationObserver(captureOpening);openingObserver.observe(document.body,{childList:true,subtree:true,attributes:true});}
    },async()=>{},()=>{
      check();account(m.config.account);
      if(row(m.id)!==r||!r.contains(control)||text(r).includes('继续沟通')||dialogs().length)throw Error('候选人行或弹窗在滚动期间变化，未打开沟通');
    });
    captureOpening();
  }
  async function preview(m){
    check();account(m.config.account);
    await dismissKnownOverlays();
    const r=row(m.id);
    if(text(r).includes('继续沟通'))return {already:true,candidateId:m.id};
    await openCandidate(m,r);
    const d=await wait(()=>dialogs().find(e=>text(e).includes('请选择职位开聊')));
    return {candidateId:m.id,rowText:text(r),dialogText:text(d),dialogMarkup:d.outerHTML};
  }
  async function prepare(m){await mark('prepare-start');check();account(m.config.account);const r=row(m.id);if(text(r).includes('继续沟通')){clearOpening();return {already:true};}const reuse=resumableOpening(m,r);if(!reuse){await dismissKnownOverlays();await mark('open-dialog');await openCandidate(m,r);}const d=reuse?opening.dialog:await wait(()=>dialogs().find(e=>text(e).includes('请选择职位开聊')),20000);captureOpening();if(!opening||opening.id!==m.id||opening.row!==r||opening.dialog!==d)throw Error('开聊窗口身份未绑定，未继续准备');await mark('dialog-open');const box=d.querySelector('#jobId');if(!box)throw Error('找不到职位选择框');const selector=box.closest('.ant-select')?.querySelector('.ant-select-selector');if(!selector)throw Error('职位控件变化');await wait(()=>{check();account(m.config.account);if(row(m.id)!==r||!visible(d)||!d.contains(selector))throw Error('等待加载时窗口变化');return ![...document.querySelectorAll('.ant-spin-spinning')].some(visible);},8000);ensureDeadline();selector.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await clickAfterLoading(selector,()=>{check();account(m.config.account);if(row(m.id)!==r||!visible(d)||!d.contains(selector))throw Error('职位选择前身份或窗口变化');});
    await mark('job-dropdown-open');const option=await wait(()=>{const opts=[...document.querySelectorAll('[role=option]')].filter(e=>e.textContent.trim()===m.config.jobId);return opts.length===1&&opts[0];});
    const labelled=option.id;ensureDeadline();box.focus();let matched=false;for(let i=0;i<30;i++){ensureDeadline();if(box.getAttribute('aria-activedescendant')===labelled){matched=true;break;}box.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true}));await new Promise(r=>setTimeout(r,80));ensureDeadline();}if(!matched)throw Error('无法选中唯一职位ID');ensureDeadline();box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));await wait(()=>d.querySelector('.ant-select-selection-item'));
    await mark('job-chosen');const selected=text(d.querySelector('.ant-select-selection-item'));if(!selected.startsWith('Agent 开发专家'))throw Error('所选职位标签不符');
    await wait(()=>{check();account(m.config.account);if(row(m.id)!==r||!visible(d))throw Error('等待加载时候选人或窗口变化');return ![...document.querySelectorAll('.ant-spin-spinning')].some(visible);},8000);
    const choices=[...d.querySelectorAll('.li-item')].filter(e=>text(e)===m.config.greeting);if(choices.length!==1)throw Error('默认招呼语不一致');await clickAfterLoading(choices[0],()=>{check();account(m.config.account);if(row(m.id)!==r||!visible(d)||!d.contains(choices[0]))throw Error('选择话术时身份或窗口变化');});const active=[...d.querySelectorAll('.li-item.li-select-active')];if(active.length!==1||text(active[0])!==m.config.greeting)throw Error('默认话术选中状态未核实');
    const nativeOption=[...document.querySelectorAll('[role=option]')].filter(o=>o.textContent.trim()===m.config.jobId&&o.getAttribute('aria-selected')==='true');if(nativeOption.length!==1)throw Error('原生职位ID选中状态未核实');
    const buttons=[...d.querySelectorAll('button[type=submit].xpath-job-and-msg-ok-btn-new')].filter(visible);const button=buttons.length===1&&buttons[0];if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'||button.classList.contains('ant-btn-loading'))throw Error('发送按钮不可用');
    const target=button.getAttribute('data_info');if(!target)throw Error('按钮缺少候选人绑定标识');const usercId=JSON.parse(decodeURIComponent(target)).userc_id_encode;if(!usercId)throw Error('无法读取候选人原生标识');
    prepared={id:m.id,config:JSON.stringify(m.config),dialog:d,selected,button,target,usercId,row:r};
    clearOpening();await mark('prepared-ready');return {ready:true,candidateId:m.id,jobId:m.config.jobId,selected,greeting:text(active[0]),target,usercId,selectionMarkup:d.querySelector('.ant-select-selection-item').outerHTML,optionMarkup:nativeOption[0].outerHTML};}
  function validatePrepared(m){
    check();account(m.config.account);const r=row(m.id);if(text(r).includes('继续沟通'))throw Error('目标已联系，请核回执');
    const ds=dialogs().filter(e=>text(e).includes('请选择职位开聊'));if(ds.length!==1)throw Error('发送弹窗已变化');const d=ds[0];
    const buttons=[...d.querySelectorAll('button[type=submit].xpath-job-and-msg-ok-btn-new')].filter(visible);const button=buttons.length===1&&buttons[0];
    if(!prepared||prepared.id!==m.id||prepared.dialog!==d||prepared.row!==r||prepared.config!==JSON.stringify(m.config)||prepared.selected!==text(d.querySelector('.ant-select-selection-item'))||prepared.button!==button)throw Error('候选人或职位发生变化');
    if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'||button.classList.contains('ant-btn-loading'))throw Error('发送按钮不可用');
    const target=button.getAttribute('data_info'),usercId=JSON.parse(decodeURIComponent(target)).userc_id_encode;
    if(target!==prepared.target||usercId!==prepared.usercId||usercId!==m.usercId)throw Error('候选人原生标识不一致');
    const opts=[...document.querySelectorAll('[role=option]')].filter(o=>o.getAttribute('aria-selected')==='true');
    if(opts.length!==1||opts[0].textContent.trim()!==m.config.jobId)throw Error('已选职位ID变化');
    const choices=[...d.querySelectorAll('.li-item.li-select-active')].filter(visible);
    if(choices.length!==1||text(choices[0])!==m.config.greeting)throw Error('已选默认话术变化');
    return {ready:true,candidateId:m.id,usercId,jobId:m.config.jobId,greeting:text(choices[0])};
  }
  function clickedReceipt(m,attempt){
    check();account(m.config.account);
    if(!attempt||attempt.id!==m.id||attempt.usercId!==m.usercId||attempt.config!==JSON.stringify(m.config))throw Error('当前页面缺少原发送绑定，保留未决并人工核验');
    const current=row(m.id);
    if(current!==attempt.row||attempt.button.getAttribute('data_info')!==attempt.target)throw Error('回执身份绑定已变化，保留未决并人工核验');
    return text(current).includes('继续沟通');
  }
  async function send(m){let clicked=false;try{
    if((await chrome.storage.local.get('stop')).stop)throw Error('已请求停止，未点击发送');
    ensureDeadline();validatePrepared(m);const completed={...prepared};const button=prepared.button;
    await click(button,()=>{lastClickedAttempt=completed;prepared=null;clicked=true;},async()=>{
      if((await chrome.storage.local.get('stop')).stop)throw Error('已请求停止，未点击发送');
    },()=>validatePrepared(m));
    await wait(()=>clickedReceipt(m,completed),10000);
    completedDialog=completed;
    return {verified:true,candidateId:m.id,usercId:m.usercId,receipt:'同一候选人行变为继续沟通'};
  }catch(e){if(!clicked)return {notSent:true,error:e.message};throw e;}}
  async function dispatch(m){
    if(m.type==='health')return {
      protocol:6,clickVersion:RCPageControls.version,
      viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,visualWidth:visualViewport?.width,visualHeight:visualViewport?.height,scale:visualViewport?.scale},
      visibility:document.visibilityState,focus:document.hasFocus(),
      pageBusy,pageOperation,capabilities:['inspect','detailLink','prepare','send','receipt','search'],
    };
    if(m.type==='dialogDiagnostics')return [...document.querySelectorAll('[role=dialog]')].map(d=>({titlePresent:text(d).includes('请选择职位开聊'),connected:d.isConnected,rectCount:d.getClientRects().length,opacity:getComputedStyle(d).opacity,visibility:getComputedStyle(d).visibility,display:getComputedStyle(d).display,accepted:visible(d)}));
    if(m.type==='detailOpen'){
      check();await dismissKnownOverlays();
      const target=row(m.id).querySelector('.detail-resume-card-wrap');
      if(!target)throw Error('未找到候选人姓名控件');
      await click(target);return {clicked:true};
    }
    if(m.type==='detailLink'){
      check();const r=row(m.id);
      const links=[...r.querySelectorAll('a[href]')].map(a=>new URL(a.href,location.href))
        .filter(u=>u.hostname==='h.liepin.com'&&u.searchParams.get('res_id_encode')===m.id);
      if(!links.length)throw Error('没有可核验的详情链接');
      return {url:links[0].href};
    }
    if(m.type==='validatePrepared')return validatePrepared(m);
    if(m.type==='preview')return preview(m);
    if(m.type==='inspect')return inspect();
    if(m.type==='prepare')return prepare(m);
    if(m.type==='send')return send(m);
    if(m.type==='receipt'){
      const attempt=lastClickedAttempt;
      const verified=clickedReceipt(m,attempt);
      if(verified)completedDialog=attempt;
      return {verified,candidateId:m.id,usercId:attempt?.usercId};
    }
    if(m.type==='search')return search(m);
    throw Error('未知操作');
  }
  chrome.runtime.onMessage.addListener((m,_,reply)=>{
    // A caller timeout does not cancel JavaScript in this page. Keep the lock
    // until the original operation settles; never start a second mutation.
    let deadline;
    try{deadline=messageDeadline(m);ensureDeadline(deadline);}catch(e){reply({ok:false,error:e.message});return false;}
    const exclusive=!['health','receipt'].includes(m.type);
    if(exclusive&&pageBusy){reply({ok:false,error:'上一次页面操作仍在进行；未重复执行'});return false;}
    if(exclusive){pageBusy=true;pageOperation=m.type;operationDeadline=deadline;}
    const finish=response=>{
      if(exclusive){pageBusy=false;pageOperation=null;operationDeadline=null;}
      reply(response);
    };
    dispatch(m).then(data=>finish({ok:true,data}),e=>finish({ok:false,error:e.message}));
    return true;
  });
})();
