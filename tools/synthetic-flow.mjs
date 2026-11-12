// Inspectable execution trace of real content.js against a synthetic DOM.
// This does not attach Chrome, access Liepin or send any real message.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {completedDialogFixture} from '../test/fixtures/liepin-page.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const trace=[];
async function step(f,scenario,type){
 const result=await f.run(type);trace.push({scenario,action:type,result,syntheticClicks:f.stats()});return result;
}
const normal=completedDialogFixture();
assert.equal((await step(normal,'normal','prepare')).data.ready,true);
assert.equal(normal.stats().sendClicks,0);
assert.equal((await step(normal,'normal','validatePrepared')).data.ready,true);
assert.equal(normal.stats().sendClicks,0);
assert.equal((await step(normal,'normal','send')).data.verified,true);
assert.equal((await step(normal,'normal','receipt')).data.verified,true);
assert.equal(normal.stats().sendClicks,1);
assert.equal((await step(normal,'normal','send')).data.notSent,true);
assert.equal(normal.stats().sendClicks,1);
const stopped=completedDialogFixture();
await step(stopped,'stopped','prepare');stopped.setStopped(true);
assert.equal((await step(stopped,'stopped','send')).data.notSent,true);
assert.equal(stopped.stats().sendClicks,0);
const unknown=completedDialogFixture({replaceRowAfterClick:true});
await step(unknown,'identity-lost','prepare');
assert.equal((await step(unknown,'identity-lost','send')).ok,false);
assert.equal(unknown.stats().sendClicks,1);
const target=process.argv[2]||path.join(root,'.runtime','test-results','synthetic-flow.json');
await mkdir(path.dirname(target),{recursive:true});
const report={generatedAt:new Date().toISOString(),scope:'Synthetic DOM and stubbed normal controls, production content.js. No real browser, network, candidate or message.',ok:true,trace};
await writeFile(target,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,steps:trace.length,evidence:target,realMessages:0}));
