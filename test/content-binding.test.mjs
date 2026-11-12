import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

test('preview and prepare reject a virtual row reused for another candidate during scrolling', async () => {
  for (const type of ['preview', 'prepare']) {
    let listener, identity = 'original', clicks = 0;
    const control = {innerText: '立即沟通', getClientRects: () => [{}], querySelectorAll: () => []};
    const row = {innerText: '候选人 立即沟通', classList: {contains: key => key === 'r-' + identity},
      querySelectorAll: () => [control], contains: node => node === control};
    const account = {innerText: '你好，DEMO_ACCOUNT', getClientRects: () => [{}]};
    const context = vm.createContext({
      chrome: {storage: {local: {set: async () => {}}}, runtime: {onMessage: {addListener: fn => {listener = fn;}}}},
      location: {hostname: 'h.liepin.com'},
      document: {hasFocus: () => true, visibilityState: 'visible', body: {innerText: 'body'.repeat(50)}, querySelectorAll: selector =>
        selector === 'tr' ? [row] : selector === '[role=dialog]' ? [] : [account]},
      getComputedStyle: () => ({visibility: 'visible', display: 'block'}),
      TTCPageControls: {click: async (target, before, guard, validate) => {
        await guard(); identity = 'other'; validate(); before(); clicks++;
      }},
      Date, URL, TextEncoder,
    });
    vm.runInContext(source, context);
    const response = await new Promise(resolve => listener({type, id: 'original', config: {account: 'DEMO_ACCOUNT'}}, {}, resolve));
    assert.equal(response.ok, false);
    assert.match(response.error, /无法唯一定位候选人|候选人行/);
    assert.equal(clicks, 0);
  }
});
