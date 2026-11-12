(() => {
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0';
  const text = el => (el?.innerText || '').trim();
  function resolveControl(el) {
    const control = el?.closest('button,a,[role="button"]');
    const scope = el?.closest('tr,[role="dialog"]') || el;
    return control && scope?.contains(control) && visible(control) && text(control) === text(el) ? control : el;
  }
  const disabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('ant-btn-loading');
  async function settle(el, assertActive) {
    let last, stable = 0;
    for (let i = 0; i < 16; i++) {
      assertActive();
      await new Promise(resolve => setTimeout(resolve, 40));
      assertActive();
      if (!visible(el)) throw Error('控件已离开页面或不可见');
      const r = el.getBoundingClientRect();
      const current = [r.left, r.top, r.width, r.height];
      stable = last && current.every((n, j) => Math.abs(n - last[j]) < 0.5) ? stable + 1 : 0;
      if (stable >= 2) return;
      last = current;
    }
    throw Error('控件位置未稳定，未点击');
  }
  function hit(el) {
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    if (right <= left || bottom <= top) return {ok: false, blocker: 'viewport outside'};
    let blocker;
    for (const y of [0.5, 0.25, 0.75]) for (const x of [0.5, 0.25, 0.75]) {
      const target = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y);
      if (target && (target === el || el.contains(target))) return {ok: true};
      blocker ||= target && target.tagName + '.' + target.className;
    }
    return {ok: false, blocker: blocker || 'viewport outside'};
  }
  async function click(element, before = () => {}, guard = async () => {}, validate = () => {}, assertActive = () => {}) {
    assertActive();
    const el = resolveControl(element);
    if (!visible(el) || disabled(el)) throw Error('控件不可见或不可用');
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
      el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
    }
    await settle(el, assertActive);
    if (!hit(el).ok) {
      // A normal scroll can move a control clear of a sticky header. Never hide an overlay.
      el.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
      await settle(el, assertActive);
    }
    assertActive();
    await guard();
    assertActive();
    validate();
    if (!visible(el) || disabled(el)) throw Error('控件已变化或不可用，未点击');
    const result = hit(el);
    if (!result.ok) {
      const bounds = el.getBoundingClientRect();
      throw Error('控件被遮挡：' + el.tagName + '.' + el.className + '；覆盖：' + result.blocker +
        '；位置：' + JSON.stringify([bounds.left, bounds.top, bounds.width, bounds.height]) +
        '；视口：' + JSON.stringify([innerWidth, innerHeight]));
    }
    // No asynchronous work between the final guard/hit test and the single click.
    assertActive();
    before();
    assertActive();
    el.click();
  }
  globalThis.TTCPageControls = Object.freeze({version:1, click, resolveControl});
})();
