/** Independent processes compare A pending/success/rejection while B is active. */
const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process');
const project=s=>({document:s.document,text:s.text,editable:s.editable,sendDisabled:s.sendDisabled,permissionDisabled:s.permissionDisabled});
async function branch(mode,bundle){
 const h=await require('../candidate/lab/host.cjs').create(bundle);const trace=[];
 const step=async action=>{const result=await h.run(action);trace.push({action,result,payloads:h.lab.sends.map(s=>s.payload[0])});return result};
 try{
  await step({type:'mount',sessionId:'A'});await step({type:'set',html:'<p>A original</p>'});await step({type:'focus'});await step({type:'click'});
  assert.equal(h.lab.sends.length,1);
  await step({type:'switch',sessionId:'B'});assert.equal(h.snapshot().editable,true,'A must not block fresh B');
  await step({type:'set',html:'<p>B original</p>'});await step({type:'focus'});await step({type:'click'});assert.equal(h.lab.sends.length,2);
  if(h.snapshot().editable)await step({type:'type',text:'B next'});
  await step({type:'flush'});const before=project(h.snapshot());
  if(mode==='held')await step({type:'flush'});
  else await step({type:'settle',index:0,...(mode==='rejected'?{reject:true}:{})});
  const after=project(h.snapshot());
  assert.deepEqual(after,before,'settling A changed B state');
  // B must recover based on B's settlement, even in the counterfactual where
  // A is still unresolved. B's own draft preservation is scored elsewhere.
  await step({type:'settle',index:1});assert.equal(h.snapshot().editable,true,'B remains blocked after its own settlement');
  await step({type:'set',html:'<p>B final</p>'});await step({type:'focus'});await step({type:'click'});
  assert.equal(h.lab.sends.length,3);assert.equal(h.lab.sends[2].payload[0],'B final');
  await step({type:'settle',index:2});
  return {branch:mode,pass:true,before,after,final:project(h.snapshot()),bPayloads:h.lab.sends.slice(1).map(s=>s.payload[0]),trace};
 }catch(e){return {branch:mode,pass:false,error:String(e),...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),trace}}
 finally{await h.close()}
}
(async()=>{
 const mode=process.argv[2],bundle=path.resolve(process.argv[3]);
 if(mode!=='C09'){console.log(JSON.stringify(await branch(mode,bundle)));process.exit(0)}
 const branches=[];
 for(const name of ['held','accepted','rejected']){
  const command=[process.execPath,__filename,name,bundle],startedAt=new Date().toISOString(),started=Date.now();
  const p=cp.spawnSync(command[0],command.slice(1),{encoding:'utf8',timeout:15000});
  const line=p.stdout?.split('\n').find(s=>s.startsWith('{"branch"'));
  const evidence={command,startedAt,seconds:(Date.now()-started)/1000,stderr:p.stderr,exitCode:p.status,signal:p.signal};
  branches.push(line&&p.status===0?{...JSON.parse(line),...evidence}:{branch:name,status:'ENVIRONMENT_UNSUPPORTED',error:String(p.error||p.stderr||'child did not return a successful result'),stdout:p.stdout,...evidence});
 }
 try{
  for(const b of branches){if(b.status==='ENVIRONMENT_UNSUPPORTED')throw Error('ENVIRONMENT_UNSUPPORTED '+b.error);assert.equal(b.pass,true,b.error)}
  for(const b of branches.slice(1)){
   assert.deepEqual(b.before,branches[0].before,'counterfactual initial B states differ');
   assert.deepEqual(b.after,branches[0].after,'A outcome interferes with B');
   assert.deepEqual(b.final,branches[0].final,'B final state depends on A settlement');
   assert.deepEqual(b.bPayloads,branches[0].bPayloads,'B requests depend on A settlement');
  }
  console.log(JSON.stringify({id:'C09',pass:true,branches}));
 }catch(e){console.log(JSON.stringify({id:'C09',pass:false,error:String(e),...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),branches}))}
})().catch(e=>{console.log(JSON.stringify({id:'C09',status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
