import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/page-controls.js', import.meta.url), 'utf8');
function fixture(options = {}) {
  let ticks = 0, clicks = 0, scrolls = 0;
  let position = {left: 100, top: 100, width: 120, height: 40};
  const bounds = () => {
    const p = options.rect?.(ticks) || position;
    return {...p, right: p.left + p.width, bottom: p.top + p.height};
  };
  const scope = {contains: el => el === button || el === span};
  const button = {
    tagName: 'BUTTON', className: 'greet', innerText: '立即沟通', isConnected: true, disabled: false,
    classList: {contains: () => false}, getAttribute: () => null,
    getClientRects: () => [bounds()], getBoundingClientRect: bounds,
    contains: el => el === span,
    closest: selector => selector.includes('tr,') ? scope : button,
    scrollIntoView: () => {scrolls++; if (options.scrollTo) position = options.scrollTo;},
    click: () => {clicks++;},
  };
  const span = {...button, tagName: 'SPAN', className: '', contains: () => false,
    closest: selector => selector.includes('tr,') ? scope : button};
  const blocker = {tagName: 'DD', className: 'search-strategy-tip'};
  const context = vm.createContext({
    getComputedStyle: () => ({visibility: 'visible', display: 'block'}),
    innerWidth: 800, innerHeight: 600,
    document: {elementFromPoint: (x, y) => options.hit ? options.hit({x, y, button, blocker}) : span},
    setTimeout: callback => {ticks++; options.tick?.({ticks, button}); callback();},
  });
  vm.runInContext(source, context);
  return {api: context.TTCPageControls, button, span, scope,
    stats: () => ({ticks, clicks, scrolls})};
}

test('uses native control inside the candidate boundary and clicks once after settling', async () => {
  const f = fixture();
  assert.equal(f.api.resolveControl(f.span), f.button);
  await f.api.click(f.span);
  assert.equal(f.stats().clicks, 1);
  assert.ok(f.stats().ticks >= 3);
});
test('does not promote to a native control outside the candidate boundary', () => {
  const f = fixture();
  f.scope.contains = () => false;
  assert.equal(f.api.resolveControl(f.span), f.span);
});
test('waits for delayed layout to settle before clicking', async () => {
  const f = fixture({rect: tick => ({left: 100, top: tick < 4 ? tick * 10 : 100, width: 120, height: 40})});
  await f.api.click(f.button);
  assert.ok(f.stats().ticks >= 6);
  assert.equal(f.stats().clicks, 1);
});
test('moving control times out without marking submission', async () => {
  const f = fixture({rect: tick => ({left: tick, top: 100, width: 120, height: 40})});
  let marked = false;
  await assert.rejects(f.api.click(f.button, () => {marked = true;}), /未稳定/);
  assert.equal(marked, false);
  assert.equal(f.stats().clicks, 0);
});
test('uses a normally visible interior point when only the center is covered', async () => {
  const f = fixture({hit: ({x, y, button, blocker}) => x === 160 && y === 120 ? blocker : button});
  await f.api.click(f.button);
  assert.equal(f.stats().clicks, 1);
});
test('fully covered control remains blocked after normal scrolling', async () => {
  const f = fixture({hit: ({blocker}) => blocker});
  let marked = false;
  await assert.rejects(f.api.click(f.button, () => {marked = true;}), /search-strategy-tip/);
  assert.equal(f.stats().clicks, 0);
  assert.equal(marked, false);
  assert.equal(f.stats().scrolls, 1);
});
test('offscreen control scrolls normally and settles before click', async () => {
  const f = fixture({scrollTo: {left: 100, top: 200, width: 120, height: 40}});
  f.button.getBoundingClientRect = () => f.stats().scrolls ?
    {left: 100, top: 200, width: 120, height: 40, right: 220, bottom: 240} :
    {left: 100, top: 900, width: 120, height: 40, right: 220, bottom: 940};
  await f.api.click(f.button);
  assert.equal(f.stats().clicks, 1);
  assert.equal(f.stats().scrolls, 1);
});
test('stop guard prevents click and submission marker', async () => {
  const f = fixture();
  let marked = false;
  await assert.rejects(f.api.click(f.button, () => {marked = true;}, async () => {throw Error('stop');}), /stop/);
  assert.equal(marked, false);
  assert.equal(f.stats().clicks, 0);
});
test('final synchronous binding validation rejects changes during asynchronous guard', async () => {
  const f = fixture();
  let identity = 'original', marked = false;
  await assert.rejects(f.api.click(f.button, () => {marked = true;}, async () => {
    await Promise.resolve(); identity = 'changed';
  }, () => {if (identity !== 'original') throw Error('identity changed');}), /identity changed/);
  assert.equal(marked, false);
  assert.equal(f.stats().clicks, 0);
});
test('disabled or detached during wait cannot be clicked', async () => {
  for (const field of ['disabled', 'isConnected']) {
    const f = fixture({tick: ({ticks, button}) => {if (ticks === 2) button[field] = field === 'disabled';}});
    await assert.rejects(f.api.click(f.button), /不可见|不可用/);
    assert.equal(f.stats().clicks, 0);
  }
});
test('manifest loads click helper before the content script', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('page-controls.js') >= 0 && scripts.indexOf('page-controls.js') < scripts.indexOf('content.js'));
});


test('deadline expiring during layout settlement prevents submission and click',async()=>{
 const f=fixture();let marked=false;
 const assertActive=()=>{if(f.stats().ticks>=2)throw Error('deadline elapsed');};
 await assert.rejects(f.api.click(f.button,()=>marked=true,async()=>{},()=>{},assertActive),/deadline/);
 assert.equal(marked,false);assert.equal(f.stats().clicks,0);
});

test('deadline expiring during an asynchronous guard is checked before the click',async()=>{
 const f=fixture();let expired=false,marked=false;
 await assert.rejects(f.api.click(f.button,()=>marked=true,async()=>{expired=true;},()=>{},()=>{if(expired)throw Error('deadline elapsed');}),/deadline/);
 assert.equal(marked,false);assert.equal(f.stats().clicks,0);
});


test('deadline is checked again after the conservative submission marker',async()=>{
 const f=fixture();let expired=false;
 await assert.rejects(f.api.click(f.button,()=>{expired=true;},async()=>{},()=>{},()=>{if(expired)throw Error('deadline elapsed');}),/deadline/);
 assert.equal(f.stats().clicks,0);
});
