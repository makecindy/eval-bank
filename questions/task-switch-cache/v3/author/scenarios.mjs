import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,id]=process.argv.slice(2), url=f=>pathToFileURL(path.join(root,f)).href;
globalThis.__projectionCalls=0;globalThis.__counts={projection:0,files:0,markdown:0};
const m=await import(url('src/entry.js'));
const p=await import(url('src/apps/desktop/src/renderer/components/chat/MessageStream.js'));
const ref=await import('../reference/src/entry.js');
const parseCounts=new Map(),originalParse=JSON.parse;
JSON.parse=function(s,...a){parseCounts.set(s,(parseCounts.get(s)||0)+1);return originalParse.call(this,s,...a)};
const parses=s=>parseCounts.get(s)||0, stats=()=>({...globalThis.__counts});
const M=32*1024*1024;
const u=(key='u',content='request')=>({clientId:key,role:'user',content});
const tc=(key='t',name='Write',input={file_path:'one.md',content:'hi'})=>({clientId:key,role:'tool_use',content:'tool',toolUseId:key,toolName:name,toolInput:input});
const tr=(key='t',content='ok')=>({clientId:key+'-result',role:'tool_result',toolUseId:key,content});
const a=(text,key='a',stream=false)=>({clientId:key,role:'assistant',content:text,isStreaming:stream});
const eq=(...v)=>assert.deepEqual(...v);
function checked(...args){const out=m.buildCachedRenderItems(...args);eq(out,ref.buildRenderItems(...args));return out}
function hot(...args){const n=stats().projection;const out=checked(...args);assert.equal(stats().projection,n,'hot history rebuilt');return out}
function paths(out){return out.items.flatMap(i=>i.files?.map(f=>f.path)||[])}
function images(out){return out.items.filter(i=>i.type==='tool_media').flatMap(i=>(i.items||[]).filter(x=>x.kind==='image').map(x=>x.url))}
function padded(n,key){const s=JSON.stringify({xdt_card_id:key,pad:''});return s.slice(0,-2)+' '.repeat(n-s.length)+s.slice(-2)}
function ledger(){assert(Array.isArray(p.recentRenderProjections),'OBSERVABILITY: projection storage changed');return p.recentRenderProjections.reduce((s,e)=>{assert(Array.isArray(e.dependencies?.[0]),'OBSERVABILITY: projection dependencies changed');return s+e.dependencies[0].reduce((n,r)=>n+r.content.length,0)},0)}
function fileCase(changedIndex){const start=u(),tool=tc(),result=tr(),tail=a('done');const rows=[start,tool,result,tail];const old=checked(rows,undefined,undefined,{workingDir:'/workspace'});assert(paths(old).includes('/workspace/one.md'));
 const next=rows.slice();next[changedIndex]=changedIndex===1?tc('t','Write',{file_path:'two.md',content:'hi'}):tr('t','Error: write failed');
 const expected=ref.buildRenderItems(next,undefined,undefined,{workingDir:'/workspace'});assert.notDeepEqual(old,expected,'AUTHOR: fixture has no difference');eq(m.buildCachedRenderItems(next,undefined,undefined,{workingDir:'/workspace'}),expected);hot(next,undefined,undefined,{workingDir:'/workspace'});}
function mediaRows(body,stream=false){return [u(),tc('t','image_tool',{}),tr('t',JSON.stringify({xdt_image_urls:['cindy-media://a.png','cindy-media://b.png']})),a(body,'a',stream)]}
function ghost(key,ghostId='art'){return tc(key,'mcp__cindy__ghost_call',{ghost_id:ghostId,tool:'draw'})}
function snapshot(lives){return {version:1,liveCards:lives,byCallId:new Map(lives.map(x=>[x.callId,{status:'ready',ghostId:x.ghostId,html:'<p>ok</p>',height:100}]))}}
function live(callId,toolUseId,ghostId='art'){return {callId,toolUseId,ghostId}}
function cards(out){return out.items.filter(i=>i.type==='ghost_card').map(i=>({callId:i.callId,toolUseId:i.toolCall.toolUseId}))}
m.setDataOwnerGeneration('test',1);ref.setDataOwnerGeneration('ref',1);
const tests={
 V01core(){fileCase(1)},
 V01edge(){fileCase(2)},
 V01guard(){const head=u(),tool=tc(),result=tr();const rows=[head,tool,result,a('one','tail',true)];checked(rows,undefined,undefined,{workingDir:'/first'});const first=stats().files;assert(first>0,'OBSERVABILITY: file counter');
  const next=[head,tool,result,a('two','tail',true)];checked(next,undefined,undefined,{workingDir:'/first'}); // tail itself changes: now warm identical slices on another outer array
  const n=stats().files;checked([...next],undefined,undefined,{workingDir:'/first'});assert.equal(stats().files,n,'unchanged inner slice recollected');
  assert(paths(checked(next,undefined,undefined,{workingDir:'/second'})).includes('/second/one.md'));hot(next,undefined,undefined,{workingDir:'/second'});},
 V02core(){const cache=new Map(),r=mediaRows('![A](cindy-media://a.png)');eq(images(checked(r,undefined,undefined,{markdownImageTargetCache:cache})),['cindy-media://b.png']);
  const next=r.slice();next[3]=a('![B](cindy-media://b.png)');eq(images(checked(next,undefined,undefined,{markdownImageTargetCache:cache})),['cindy-media://a.png']);},
 V02edge(){const cache=new Map(),r=mediaRows('![A](cindy-media://a.png)');checked(r,undefined,undefined,{markdownImageTargetCache:cache});const next=r.slice();next[3]=a('revised: no image');eq(images(checked(next,undefined,undefined,{markdownImageTargetCache:cache})),['cindy-media://a.png','cindy-media://b.png']);},
 V02guard(){const cache=new Map(),r=mediaRows('![A](cindy-media://a.png)');checked(r,undefined,undefined,{markdownImageTargetCache:cache});const n=stats().markdown;
  checked([...r],undefined,undefined,{markdownImageTargetCache:cache});assert.equal(stats().markdown,n,'stable completed message reparsed');hot(r,undefined,undefined,{markdownImageTargetCache:new Map()});},
 V03core(){const r=mediaRows('![A](cindy-media://a.png)',true);eq(images(checked(r)),['cindy-media://a.png','cindy-media://b.png']);},
 V03edge(){const r=mediaRows('![A](cindy-media://a.png)',true);checked(r);const next=r.slice();next[3]=a('![A](cindy-media://a.png)');eq(images(checked(next)),['cindy-media://b.png']);
  const again=next.slice();again[3]=a('![A](cindy-media://a.png)', 'a',true);eq(images(checked(again)),['cindy-media://a.png','cindy-media://b.png']);},
 V03guard(){const r=mediaRows('![A](cindy-media://a.png)');eq(images(checked(r)),['cindy-media://b.png']);const next=[...r,u('next'),tc('new','image_tool',{}),tr('new','{"xdt_image_url":"cindy-media://a.png"}')];assert(images(checked(next)).includes('cindy-media://a.png'),'earlier turn hides later image');},
 V04core(){const r=[u(),ghost('current')],s=snapshot([live('card-other','other')]);eq(cards(checked(r,undefined,s)),[]);},
 V04edge(){const r=[u(),ghost('first'),ghost('second')],s=snapshot([live('card-second','second')]);eq(cards(checked(r,undefined,s)),[{callId:'card-second',toolUseId:'second'}]);},
 V04guard(){const r=[u(),ghost('first'),ghost('second')],s=snapshot([live('legacy',null),live('exact','second')]);const out=checked(r,undefined,s);eq(cards(out),[{callId:'legacy',toolUseId:'first'},{callId:'exact',toolUseId:'second'}]);hot(r,undefined,s);const s2=snapshot([live('alien',null,'another-plugin')]);eq(cards(checked([u(),ghost('third')],undefined,s2)),[]);},
 V05core(){const text='{"xdt_card_id":"account"}',r=[u()];m.extractGhostCardId(text);checked(r);const n=stats().projection,pp=parses(text);m.setDataOwnerGeneration('test',2);checked(r);m.extractGhostCardId(text);assert.equal(stats().projection,n+1,'old owner history reused');assert.equal(parses(text),pp+1,'old owner metadata reused');},
 V05edge(){const text='{"xdt_card_id":"account"}',r=[u()];for(const [o,g]of[['A',1],['B',1],['A',2]]){const n=stats().projection,pp=parses(text);m.setDataOwnerGeneration(o,g);checked(r);m.extractGhostCardId(text);assert.equal(stats().projection,n+1);assert.equal(parses(text),pp+1)}},
 V05guard(){const text='{"xdt_card_id":"same"}',r=[u()];m.setDataOwnerGeneration('same',7);m.extractGhostCardId(text);checked(r);const n=stats();m.setDataOwnerGeneration('same',7);hot(r);m.extractGhostCardId(text);assert.equal(parses(text),1);eq(stats(),n)},
 V06core(){const s=padded(8*1024*1024,'large');for(let i=0;i<5;i++)assert.equal(m.extractGhostCardId(s),'large');m.extractGhostCardId('{"xdt_card_id":"small"}');assert.equal(m.extractGhostCardId(s),'large');assert.equal(parses(s),1,'hot reads falsely consumed retention budget');},
 V06edge(){const s=padded(6*1024*1024,'six'),t=padded(6*1024*1024,'other');for(let i=0;i<6;i++)m.extractGhostCardId(s);m.extractGhostCardId(t);m.extractGhostCardId(s);m.extractGhostCardId(t);assert.equal(parses(s),1);assert.equal(parses(t),1);},
 V06guard(){const s=padded(M+1,'oversize');m.extractGhostCardId(s);m.extractGhostCardId(s);assert.equal(parses(s),2);for(let i=0;i<513;i++)m.extractGhostCardId(JSON.stringify({xdt_card_id:String(i)}));const first='{"xdt_card_id":"0"}';m.extractGhostCardId(first);assert.equal(parses(first),2);},
 V07core(){for(let i=0;i<2;i++){const text='😀'.repeat(10*1024*1024),r=[u('large'+i,text)];assert.equal(m.buildCachedRenderItems(r).items[0].message.content,text);assert(ledger()<=M,'retained UTF16 exceeds budget')}},
 V07edge(){const exact=[u('exact','😀'.repeat(M/2))];checked(exact);hot(exact);assert.equal(ledger(),M);const over=[u('over','😀'.repeat(M/2+1))],before=stats().projection;for(let i=0;i<2;i++)assert.equal(m.buildCachedRenderItems(over).items[0].message.content.length,M+2);assert.equal(stats().projection,before+2,'oversize retained');assert(ledger()<=M)},
 V07guard(){const r=[u('ascii','a'.repeat(M))];checked(r);hot(r);const tasks=['a','b','c','d'].map(x=>[u(x)]);for(const t of tasks)checked(t);assert(ledger()<=M);assert(p.recentRenderProjections.length<=3,'OBSERVABILITY: capacity');const n=stats().projection;checked(tasks[0]);assert.equal(stats().projection,n+1)},
 R01(){for(const s of ['','ordinary','{"irrelevant":1}']){eq(m.extractToolResultMedia(s),[]);assert.equal(m.extractGhostCardId(s),null);assert.equal(parses(s),0)}},
 R02(){const s='{"xdt_image_urls":["cindy-media://a.png","cindy-media://b.png"]}';const one=m.extractToolResultMedia(s);one.pop();assert.equal(m.extractToolResultMedia(s).length,2);assert.equal(parses(s),1)},
 R03(){const r=[Object.freeze(u()),Object.freeze(a('hello'))];Object.freeze(r);eq(checked(r),ref.buildRenderItems(r));hot(r);},
 R04(){const s='{ invalid xdt_card_id';m.extractGhostCardId(s);m.extractAnchorCardId(s);eq(m.extractToolResultMedia(s),[]);assert.equal(parses(s),1);eq(checked([]),ref.buildRenderItems([]));}
};
try{assert(tests[id],'AUTHOR: unknown scenario');await tests[id]();console.log(JSON.stringify({id,pass:true,counts:stats()}))}
catch(e){console.log(JSON.stringify({id,pass:false,error:e.message,stack:e.stack,counts:stats()}));process.exitCode=1}
