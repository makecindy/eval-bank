import fs from 'node:fs/promises';
import nodeFs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [root,caseId]=process.argv.slice(2);
const base=await fs.mkdtemp(path.join(process.env.TMPDIR,'remote-v2-'));
process.env.PROJECT_DATA_DIR=path.join(base,'data');
const original=Object.fromEntries(['stat','mkdir','utimes','writeFile','rename','link','rm','readdir'].map(k=>[k,fs[k].bind(fs)]));
let pending=0;
for(const k in original)fs[k]=async(...args)=>{pending++;try{return await original[k](...args)}finally{pending--}};
const tick=()=>new Promise(r=>setImmediate(r));
async function drain(){for(let i=0,quiet=0;i<10000;i++){await tick();if(pending===0){if(++quiet===3)return}else quiet=0;}throw Error('AUTHOR: filesystem never settled')}
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
const guards=[];
function deadline(p,label){return Promise.race([p,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('operation did not settle: '+label)),4000);guards.push(t)})])}
const settled=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error:String(error)}));
const load=p=>import(pathToFileURL(path.join(root,p)));
const c=await load('src/cache/remote-file-cache.ts'), platform=await load('runtime/platform.ts');
const id=(extra={})=>({transport:'device',endpointId:'device',workdir:'/repo',relPath:'a.txt',size:3,mtimeMs:1000.1,...extra});
const fetchFile=(identity,text)=>c.fetchRemoteFileToCache(identity,p=>fs.writeFile(p,text),()=>{});
async function versions(oldLast){
 const entered=gate(),release=gate();const old=id(),fresh=id({mtimeMs:2000});
 const slow=fetchVersion(oldLast?old:fresh,oldLast?'old':'new');
 async function fetchVersion(i,text){return c.fetchRemoteFileToCache(i,async p=>{entered.resolve();await release.promise;await fs.writeFile(p,text)},()=>{})}
 await entered.promise;
 const fast=await fetchFile(oldLast?fresh:old,oldLast?'new':'old');release.resolve();const slowPath=await slow;
 await drain();assert.equal(await fs.readFile(fast,'utf8'),oldLast?'new':'old');assert.equal(await fs.readFile(slowPath,'utf8'),oldLast?'old':'new');
 let calls=0;await c.fetchRemoteFileToCache(old,async()=>{calls++;throw Error('unnecessary redownload')},()=>{});assert.equal(calls,0);
}
async function cancelled(settle){
 const started=gate(),releaseOld=gate(),freshStarted=gate(),releaseFresh=gate();const ac=new AbortController();let tempOld,tempNew,progress=0;
 const first=settled(c.fetchRemoteFileToCache(id(),async(p,report)=>{tempOld=p;await fs.writeFile(p,'old');started.resolve();await releaseOld.promise;report(3,3);if(settle==='reject')throw Error('late failure')},()=>progress++,ac.signal));
 await started.promise;ac.abort();assert.equal((await first).ok,false);
 let calls=0;const retry=settled(c.fetchRemoteFileToCache(id(),async p=>{calls++;tempNew=p;await fs.writeFile(p,'new');freshStarted.resolve();await releaseFresh.promise},()=>{}));
 try{
  await deadline(freshStarted.promise,'retry before abandoned remote resumes');
  releaseOld.resolve();await drain();assert.equal(progress,0,'cancelled progress');assert.equal(await fs.readFile(tempNew,'utf8'),'new','old cleanup touched replacement');
  const joined=settled(c.fetchRemoteFileToCache(id(),async()=>{calls++;throw Error('duplicate transfer')},()=>{}));releaseFresh.resolve();
  const a=await retry,b=await joined;assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(a.value,b.value);assert.equal(calls,1);assert.equal(await fs.readFile(a.value,'utf8'),'new');
  await drain();await assert.rejects(fs.stat(tempOld));
 }finally{releaseOld.resolve();releaseFresh.resolve();await retry;await drain()}
}
async function publish(){
 const reached=gate(),release=gate();let tempOld;const oldAsync=fs.rename,oldLink=fs.link,oldSync=nodeFs.renameSync;
 fs.rename=async(from,to)=>{if(from===tempOld){reached.resolve();await release.promise}return oldAsync(from,to)};
 fs.link=async(from,to)=>{if(from===tempOld){reached.resolve();await release.promise}return oldLink(from,to)};
 nodeFs.renameSync=(from,to)=>{const r=oldSync(from,to);if(from===tempOld)reached.resolve();return r};syncBuiltinESMExports();
 const ac=new AbortController();const first=settled(c.fetchRemoteFileToCache(id(),async p=>{tempOld=p;await fs.writeFile(p,'old')},()=>{},ac.signal));
 try{await deadline(reached.promise,'AUTHOR: publication observability needs adaptation');ac.abort();await first;const result=await deadline(fetchFile(id(),'new'),'replacement publication');const before=await fs.readFile(result,'utf8');release.resolve();await drain();assert.equal(await fs.readFile(result,'utf8'),before,'late publication changed returned bytes')}
 finally{release.resolve();fs.rename=oldAsync;fs.link=oldLink;nodeFs.renameSync=oldSync;syncBuiltinESMExports();await drain()}
}

const oldHash=(i,withEndpoint)=>createHash('sha256').update([platform.activeOwnerScopeKey(),i.transport,...(withEndpoint?[i.endpointId]:[]),i.workdir,i.relPath].join('\n')).digest('hex').slice(0,20);
async function legacy(){
 const dir=c.getRemoteFileCacheRoot();await fs.mkdir(dir,{recursive:true});const i=id({mtimeMs:1000});
 const old=path.join(dir,`${oldHash(i,true)}-3-1000-a.txt`);await fs.writeFile(old,'old');
 assert.equal(await c.findStaleCached(i),old,'identifiable old format remains offline-readable');
 let calls=0;const current=await c.fetchRemoteFileToCache(i,async p=>{calls++;await fs.writeFile(p,'new')},()=>{});
 assert.equal(calls,1,'legacy rounded timestamp cannot be an exact online hit');assert.equal(await fs.readFile(current,'utf8'),'new');assert.equal(await fs.readFile(old,'utf8'),'old');
 const unknown=id({relPath:'unknown.txt'}),orphan=path.join(dir,`${oldHash(unknown,false)}-3-1000-unknown.txt`);await fs.writeFile(orphan,'old');
 for(const endpointId of ['A','B'])assert.equal(await c.findStaleCached({...unknown,endpointId}),null,'unowned old data must not be assigned to a device');
 await c.sweepCacheOnStartup();assert.equal(await fs.readFile(orphan,'utf8'),'old','unowned data need not be deleted');
}
async function completedPart(){const i=id({relPath:'Report.part'});const p=await fetchFile(i,'new');await drain();assert.equal(await c.findStaleCached(i),p);await c.sweepCacheOnStartup();assert.equal(await fs.readFile(p,'utf8'),'new');}
async function sourceTuple(){
 const a=id({endpointId:'one\ntwo',workdir:'three'}),b=id({endpointId:'one',workdir:'two\nthree'});
 const pa=await fetchFile(a,'one'),pb=await fetchFile(b,'two');assert.notEqual(pa,pb);assert.equal(await fs.readFile(pb,'utf8'),'two');
}
async function inlineIntegrity(){const i=id({relPath:'inline.txt',size:4});await c.putCachedContent(i,'短');
 let calls=0;const p=await c.fetchRemoteFileToCache(i,async dest=>{calls++;await fs.writeFile(dest,'good')},()=>{});assert.equal(calls,1);assert.equal(await fs.readFile(p,'utf8'),'good');
 const j=id({relPath:'other.txt',size:3});await c.putCachedContent(j,'toolong');assert.equal(await c.findStaleCached(j),null,'invalid inline bytes must not become offline content');
}
async function unicode(kind){for(const stem of ['文'.repeat(90),'😀'.repeat(90),'文😀'.repeat(50)]){
 const i=id({relPath:stem+'.txt'});let result;
 if(kind==='download')result=await fetchFile(i,'new');
 else if(kind==='write'){await c.putCachedContent(i,'new');result=await c.fetchRemoteFileToCache(i,async()=>{throw Error('write-through missed')},()=>{})}
 else result=await c.stageLocalFileToCache({ownerId:'demo-owner',suggestedName:stem+'.txt',expectedSize:3n,copyTo:p=>fs.writeFile(p,'new')});
 assert.equal(await fs.readFile(result,'utf8'),'new');assert(Buffer.byteLength(path.basename(result))<=255);assert.equal(path.extname(result),kind==='stage'?'.bin':'.txt');assert(!path.basename(result).includes('\uFFFD'));
 }}
const tests={
 V01core:()=>versions(true),V01edge:()=>versions(false),
 async V01guard(){const dir=c.getRemoteFileCacheRoot();await fs.mkdir(dir,{recursive:true});for(let i=0;i<3;i++){const p=path.join(dir,`sparse-${i}`);const f=await fs.open(p,'w');await f.truncate(1536*1024*1024);await f.close();await fs.utimes(p,1000+i,1000+i)}await c.sweepCacheOnStartup();await assert.rejects(fs.stat(path.join(dir,'sparse-0')));assert.equal((await fs.stat(path.join(dir,'sparse-1'))).size,1536*1024*1024);assert.equal((await fs.stat(path.join(dir,'sparse-2'))).size,1536*1024*1024)},
 V02core:()=>cancelled('resolve'),async V02edge(){await cancelled('reject');await drain();process.env.PROJECT_DATA_DIR=path.join(base,'publish');await publish()},
 async V02guard(){const ac=new AbortController();ac.abort();let calls=0;await assert.rejects(c.fetchRemoteFileToCache(id({relPath:'pre-aborted'}),async()=>{calls++},()=>{},ac.signal));await drain();assert.equal(calls,0)},
 async V03core(){await c.putCachedContent(id(),'old');let calls=0;const p=await c.fetchRemoteFileToCache(id({mtimeMs:1000.2}),async dest=>{calls++;await fs.writeFile(dest,'new')},()=>{});assert.equal(calls,1);assert.equal(await fs.readFile(p,'utf8'),'new')},
 async V03edge(){await legacy();await sourceTuple()},
 async V03guard(){const i=id();await c.putCachedContent(i,'one');let calls=0;const p=await c.fetchRemoteFileToCache(i,async()=>{calls++;throw Error('exact hit missed')},()=>{});assert.equal(calls,0);assert.equal(await fs.readFile(p,'utf8'),'one');await assert.rejects(fetchFile(id({relPath:'bad'}),'x'),/size mismatch/);await inlineIntegrity()},
 V04core:()=>unicode('download'),V04edge:()=>unicode('write'),async V04guard(){await unicode('stage');await completedPart();const p=await fetchFile(id({relPath:'Report\u0001.PNG'}),'new');assert.ok(path.basename(p).endsWith('Report_.PNG'));},
};
try{await tests[caseId]();await drain();console.log(JSON.stringify({id:caseId,pass:true}))}
catch(e){console.log(JSON.stringify({id:caseId,pass:false,error:String(e),environment_invalid:String(e).includes('AUTHOR:')}));process.exitCode=1}
finally{for(const t of guards)clearTimeout(t);await drain().catch(()=>{});await original.rm(base,{recursive:true,force:true})}
