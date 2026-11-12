(function () {
  'use strict';
  const M = TTCDemo, STORAGE = 'ttc-offline-demo-v1';
  const $ = id => document.getElementById(id);
  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    state = saved?.version === M.VERSION && Array.isArray(saved.events) && saved.receipts && saved.delivered && saved.decisions ? saved : M.initial();
  } catch { state = M.initial(); }
  function node(tag, value, className) {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  function button(label, action, className = 'quiet') {
    const el = node('button', label, className); el.type = 'button'; el.onclick = action; return el;
  }
  function notify(message, error = false) { $('notice').textContent = message; $('notice').className = 'notice' + (error ? ' error' : ''); }
  function save() { try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch { notify('浏览器禁止本地演示存储；本次仍可操作，但刷新后不会保留进度。', true); } }
  function act(action, payload) {
    try {
      state = M.apply(state, action, payload); save(); render();
      const last = state.events[0]; if (last) notify(last.action + '：' + last.outcome);
    } catch (error) { notify(error.message, true); }
  }
  function renderList() {
    $('listTitle').textContent = state.keyword;
    $('pageText').textContent = '第 ' + state.page + ' / 3 页';
    $('candidates').replaceChildren();
    for (const p of M.pageItems(state)) {
      const item = node('article', undefined, 'candidate' + (state.selected === p.id ? ' selected' : ''));
      const info = node('div', undefined, 'candidate-info');
      const title = node('div', p.name, 'candidate-name'); title.append(node('span', p.direction, 'tag')); info.append(title, node('p', p.summary));
      if (state.receipts[p.id]) info.append(node('span', state.receipts[p.id] === 'verified' ? '继续沟通 · 演示已确认' : '结果不明 · 先核验，不重发', 'candidate-state' + (state.receipts[p.id] === 'uncertain' ? ' unknown' : '')));
      else if (state.decisions[p.id]) info.append(node('span', state.decisions[p.id].approved ? '预置审核已通过' : '暂不联系 · 预置证据不足或不符', 'candidate-state' + (state.decisions[p.id].approved ? '' : ' unknown')));
      item.append(info, button('查看详情', () => act('read', {id: p.id}))); $('candidates').append(item);
    }
    $('previous').disabled = state.page === 1; $('next').disabled = state.page === 3;
  }
  function renderDetail() {
    const target = $('detailContent'); target.replaceChildren();
    $('detailEmpty').hidden = !!state.selected; target.hidden = !state.selected;
    if (!state.selected) return;
    const p = M.sample(state.selected);
    target.append(node('h3', p.name), node('p', p.direction + ' 方向 · 全部为虚构演示材料', 'detail-subtitle'));
    const history = node('ul', undefined, 'history'); for (const line of p.history) history.append(node('li', line)); target.append(history);
    const table = node('table', undefined, 'evidence'); table.setAttribute('aria-label', '预置门槛与证据');
    const body = node('tbody');
    for (const gate of p.gates) {
      const tr = node('tr'), label = gate.state === 'pass' ? '有证据' : gate.state === 'fail' ? '不符合' : '待核实';
      const th = node('th', gate.label); th.scope = 'row';
      tr.append(th, node('td', label, gate.state), node('td', gate.quote)); body.append(tr);
    }
    table.append(body); target.append(table);
    target.append(node('p', '这份判断来自预置样本。生产项目由外部助手或人工理解简历，扩展负责证据绑定与执行约束。', 'detail-label'));
    const actions = node('div', undefined, 'detail-actions');
    actions.append(button('载入预置审核结果', () => act('review', {id: p.id})));
    const prepare = button('准备模拟打招呼', () => act('prepare', {id: p.id}), '');
    prepare.disabled = !state.decisions[p.id]?.approved || !!state.receipts[p.id]; actions.append(prepare); target.append(actions);
  }
  function renderModal() {
    const dialog = $('modal'), target = $('modalContent');
    const kind = state.mode === 'captcha' ? 'captcha' : state.modal?.type;
    if (!kind) { if (dialog.open) dialog.close(); return; }
    target.replaceChildren();
    if (kind === 'job') {
      $('modalTitle').textContent = '请选择演示职位开聊';
      target.append(node('p', '目标：' + M.sample(state.modal.candidateId).name + '。本窗口只修改本页演示状态。', 'modal-note'));
      const label = node('label', '演示职位'), select = node('select'); select.id = 'demoJob';
      for (const [value, title] of [[M.JOB, '演示企业 Agent 应用开发'], ['DEMO_OTHER_JOB', '演示其他职位（会阻断发送）']]) {const option = node('option', title); option.value = value; select.append(option);}
      label.append(select); target.append(label, node('div', M.GREETING, 'greeting'));
      target.append(node('p', '核对同一候选人、职位和完整默认文案后，只执行一次模拟发送。', 'modal-note'));
      const actions = node('div', undefined, 'modal-actions');
      actions.append(button('确认模拟发送', () => act('send', {jobId: select.value, greeting: M.GREETING}), ''), button('取消', () => act('dismiss'))); target.append(actions);
    } else if (kind === 'suggestion') {
      $('modalTitle').textContent = '免费开聊相似候选人（演示）';
      target.append(node('div', '这里模拟发送后的干扰提示。\n工具只识别并关闭，不联系额外候选人。', 'suggestion-placeholder'));
      const actions = node('div', undefined, 'modal-actions'); actions.append(button('演示识别并关闭', () => act('dismiss'), '')); target.append(actions);
    } else {
      $('modalTitle').textContent = '安全验证提示（演示）';
      target.append(node('p', '系统遇到验证时停止操作。这个夹具不含真实验证码，也不实现验证绕过。', 'modal-note'));
      target.append(button('结束验证演示', () => act('mode', {mode: 'normal'}), ''));
    }
    if (!dialog.open) dialog.showModal();
  }
  function render() {
    $('connection').textContent = state.connected ? '本地演示连接正常' : '演示连接已断开';
    $('connection').className = 'status' + (state.connected ? '' : ' unknown');
    $('connectionButton').textContent = state.connected ? '演示断线' : '恢复演示连接';
    $('stopButton').textContent = state.stopped ? '恢复演示' : '停止演示';
    $('verified').textContent = String(M.count(state));
    $('keyword').value = state.keyword; $('mode').value = state.mode;
    $('reconcile').disabled = !M.pending(state);
    renderList(); renderDetail(); renderModal();
    const events = $('events'); events.replaceChildren();
    if (!state.events.length) events.append(node('li', '尚无演示操作记录。', 'empty-event'));
    for (const e of state.events) {const li = node('li'); li.append(node('time', e.time), node('span', e.action), node('span', e.outcome)); events.append(li);}
  }
  for (const keyword of M.KEYWORDS) {const option = node('option', keyword); option.value = keyword; $('keyword').append(option);}
  $('search').onclick = () => act('search', {keyword: $('keyword').value});
  $('mode').onchange = () => act('mode', {mode: $('mode').value});
  $('connectionButton').onclick = () => act(state.connected ? 'disconnect' : 'reconnect');
  $('stopButton').onclick = () => act(state.stopped ? 'resume' : 'stop');
  $('reconcile').onclick = () => act('reconcile');
  $('previous').onclick = () => act('page', {page: state.page - 1});
  $('next').onclick = () => act('page', {page: state.page + 1});
  $('nearTen').onclick = () => act('nearTen');
  $('reset').onclick = () => {state = M.initial(); save(); render(); notify('演示已重置；未修改生产扩展或任何真实台账。');};
  const closeModal = () => state.mode === 'captcha' ? act('mode', {mode: 'normal'}) : act('dismiss');
  $('closeModal').onclick = closeModal;
  $('modal').addEventListener('cancel', event => {event.preventDefault(); closeModal();});
  render();
  if (state.events.length) notify('已恢复本机虚构演示进度。需要从头演示时点击“重置演示”。');
})();
