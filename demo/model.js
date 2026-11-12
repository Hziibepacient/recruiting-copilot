(function (root) {
  'use strict';
  const VERSION = 1;
  const JOB = 'DEMO_AGENT_JOB';
  const GREETING = '你好，我们有一个企业 Agent 应用开发机会，希望进一步交流。';
  const KEYWORDS = ['Agent 平台', 'Java CRM', '任务编排'];
  const samples = Array.from({length: 18}, (_, index) => {
    const letter = String.fromCharCode(65 + index);
    const direction = index % 2 ? '通用' : 'CRM';
    const missing = index === 2;
    const fail = index === 5;
    return {
      id: 'demo-person-' + letter.toLowerCase(), name: '演示候选人 ' + letter, direction,
      summary: direction === 'CRM' ? '企业客户管理系统与工具调用集成' : '任务编排、检索与共享 Agent 能力',
      history: [
        '演示企业甲：负责企业业务后端的接口设计、权限控制和线上交付。',
        direction === 'CRM' ? '演示企业乙：将工具调用接入客户管理系统，处理业务权限与失败重试。' : '演示企业乙：负责多步骤任务执行、检索与任务状态追踪。'
      ],
      gates: [
        {label: '教育背景', state: fail ? 'fail' : 'pass', quote: fail ? '演示学历资料显示：专科起点。' : '演示学历资料显示：统招本科起点。'},
        {label: '后端经历', state: 'pass', quote: '演示履历包含 6 年实际后端开发经历。'},
        {label: '求职地区', state: 'pass', quote: '演示求职意向：深圳。'},
        {label: 'Agent 项目', state: missing ? 'unknown' : 'pass', quote: missing ? '仅列出框架名称，未说明本人实现内容。' : '本人开发工具调用和任务编排，接入业务系统并完成上线。'},
        {label: '工程交付', state: missing ? 'unknown' : 'pass', quote: missing ? '缺少上线、测试或交付说明。' : '增加失败处理、日志追踪及回归检查，并随版本上线。'},
        ...(direction === 'CRM' ? [{label: 'Java 经历', state: 'pass', quote: '演示项目使用 Java 编写业务服务和接口。'}] : [])
      ]
    };
  });
  function initial() {
    return {version: VERSION, keyword: KEYWORDS[0], page: 1, selected: null, read: {}, decisions: {},
      receipts: {}, delivered: {}, events: [], connected: true, stopped: false, mode: 'normal',
      modal: null, switchCheckpoint: 0, baseline: 0};
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function sample(id) { const person = samples.find(p => p.id === id); if (!person) throw Error('没有该演示候选人'); return person; }
  function count(s) { return s.baseline + Object.values(s.receipts).filter(x => x === 'verified').length; }
  function pending(s) { return Object.values(s.receipts).some(x => x === 'uncertain'); }
  function log(s, action, outcome) { s.events.unshift({time: new Date().toLocaleTimeString('zh-CN', {hour12: false}), action, outcome}); s.events = s.events.slice(0, 40); }
  function guard(s) {
    if (!s.connected) throw Error('演示连接已断开。请点“恢复演示连接”；没有执行发送。');
    if (s.stopped) throw Error('演示已停止。请恢复演示后继续。');
    if (s.mode === 'captcha') throw Error('演示验证提示阻断操作。请切回“正常”场景；不会自动绕过验证。');
  }
  function apply(original, action, payload = {}) {
    const s = copy(original);
    switch (action) {
      case 'read':
        guard(s); sample(payload.id); s.selected = payload.id; s.read[payload.id] = true;
        log(s, '读取演示详情', sample(payload.id).name); break;
      case 'review': {
        guard(s); const p = sample(payload.id);
        if (!s.read[p.id]) throw Error('请先查看该人的演示详情。');
        const approved = p.gates.every(g => g.state === 'pass');
        s.decisions[p.id] = {approved, source: '预置演示规则', direction: p.direction};
        log(s, '载入预置审核结果', approved ? '全部演示门槛有证据，进入演示队列' : '证据不足或门槛不符，暂不进入队列'); break;
      }
      case 'prepare': {
        guard(s); const p = sample(payload.id);
        if (pending(s)) throw Error('有结果不明的演示发送，请先核验回执，不重复发送。');
        if (s.receipts[p.id]) throw Error('该演示候选人已有联系记录，已去重。');
        if (!s.decisions[p.id]?.approved) throw Error('该演示候选人尚未通过预置审核。');
        if (count(s) >= 60) throw Error('达到演示日上限 60。');
        if (count(s) - s.switchCheckpoint >= 10) throw Error('已确认 10 次演示发送，请先更换关键词。');
        if (s.modal) throw Error('先通过关闭按钮处理上一个演示提示。');
        s.modal = {type: 'job', candidateId: p.id, jobId: JOB, greeting: GREETING};
        log(s, '准备演示发送', '绑定同一人、演示职位和完整默认文案'); break;
      }
      case 'send': {
        guard(s); const m = s.modal;
        if (!m || m.type !== 'job') throw Error('未准备演示发送。');
        if (payload.jobId !== JOB || payload.greeting !== GREETING) throw Error('演示职位或默认文案不一致，未发送。');
        if (s.receipts[m.candidateId] || pending(s)) throw Error('已有发送或未明回执，禁止重放。');
        s.delivered[m.candidateId] = true;
        const lost = s.mode === 'lost';
        s.receipts[m.candidateId] = lost ? 'uncertain' : 'verified';
        s.modal = lost ? null : {type: 'suggestion'};
        log(s, '执行一次模拟发送', lost ? '模拟平台已处理，但回执丢失：标为结果不明，停止新增' : '同一演示候选人变为“继续沟通”：计入已确认'); break;
      }
      case 'dismiss':
        if (!s.modal) break;
        log(s, '点击演示窗口关闭按钮', s.modal.type === 'suggestion' ? '只关闭相似候选人提示，不联系推荐人' : '取消演示职位选择，没有发送');
        s.modal = null; break;
      case 'reconcile': {
        guard(s); let resolved = 0;
        for (const [id, status] of Object.entries(s.receipts)) if (status === 'uncertain' && s.delivered[id]) {s.receipts[id] = 'verified'; resolved++;}
        log(s, '核验模拟平台回执', resolved ? '核验原候选人状态后确认成功，没有再次发送' : '没有待核验的演示记录'); break;
      }
      case 'search':
        guard(s);
        if (pending(s)) throw Error('先核验结果不明的发送，再继续搜索。');
        if (s.modal) throw Error('先关闭当前演示窗口。');
        if (!KEYWORDS.includes(payload.keyword)) throw Error('请选择一个预置演示关键词。');
        if (count(s) - s.switchCheckpoint >= 10 && payload.keyword === s.keyword) throw Error('已到换词节点，请选择不同关键词。');
        if (payload.keyword !== s.keyword) s.switchCheckpoint = count(s);
        s.keyword = payload.keyword; s.page = 1;
        log(s, '提交演示搜索', '核对关键词、页码与当前候选人集合'); break;
      case 'page':
        guard(s); if (s.modal) throw Error('先关闭当前演示窗口。');
        if (pending(s)) throw Error('先核验结果不明的发送。');
        if (!Number.isInteger(payload.page) || payload.page < 1 || payload.page > Math.ceil(samples.length / 6)) throw Error('演示页码无效');
        s.page = payload.page; log(s, '演示翻页', '页码与候选人集合一起切换'); break;
      case 'mode': if (!['normal', 'lost', 'captcha'].includes(payload.mode)) throw Error('未知演示故障场景'); s.mode = payload.mode; log(s, '设置故障场景', payload.mode === 'lost' ? '模拟回执丢失' : payload.mode === 'captcha' ? '模拟安全验证阻断' : '正常'); break;
      case 'disconnect': s.connected = false; log(s, '断开演示连接', '本地进度保留，没有清空去重记录'); break;
      case 'reconnect': s.connected = true; log(s, '恢复演示连接', pending(s) ? '有未明结果，先核验再继续' : '从现有演示记录续接'); break;
      case 'stop': s.stopped = true; log(s, '停止演示', '保留进度，后续发送被阻断'); break;
      case 'resume': s.stopped = false; log(s, '恢复演示', '恢复后仍检查去重、回执与额度'); break;
      case 'nearTen': {
        const fresh = initial(); fresh.baseline = 9; log(fresh, '载入边界演示场景', '预置 9 条虚构成功记录，完成下一条后要求换词'); return fresh;
      }
      default: throw Error('未知演示操作');
    }
    return s;
  }
  function pageItems(s) {
    const offset = KEYWORDS.indexOf(s.keyword) * 3;
    const ordered = samples.slice(offset).concat(samples.slice(0, offset));
    return ordered.slice((s.page - 1) * 6, s.page * 6);
  }
  root.RecruitingDemo = Object.freeze({VERSION, JOB, GREETING, KEYWORDS, samples, initial, apply, count, pending, pageItems, sample});
})(globalThis);
