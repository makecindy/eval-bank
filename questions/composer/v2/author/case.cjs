const assert=require('node:assert/strict'),path=require('node:path');
const id=process.argv[2];const modulePath=path.resolve(process.argv[3]);
(async()=>{
 const host=await require('../candidate/lab/host.cjs').create(modulePath);const {run,snapshot,lab}=host;const trace=[];
 const step=async a=>{const s=await run(a);trace.push({action:a,result:s});return s};
 const setup=async(view='task',html='<p>alpha</p>',remoteHostId)=>{await step({type:'mount',view,sessionId:'A',remoteHostId});await step({type:'set',html});await step({type:'focus'});};
 const click=()=>step({type:'click'});const text=doc=>JSON.stringify(doc||{});
 try{
 if(['C01','C02','C03','C04','C05','C06','C07','C08','C09'].includes(id)){
  await setup('task',id==='C04'?'<p><strong>alpha</strong></p>':'<p>alpha</p>',id==='C02'?'ssh-fixture':undefined);const originalDocument=snapshot().document;await click();assert.equal(lab.sends.length,1,'send reaches backend');assert.equal(lab.sends[0].payload[0],'alpha','original message submitted unchanged');
  if(id==='C01'||id==='C02')assert.equal(lab.sends[0].atCall.text,'','composer empty before bubble/backend acceptance');
  if(id==='C03'){assert.equal(snapshot().editable,true);await step({type:'type',text:'beta'});await step({type:'settle'});assert.equal(snapshot().text,'beta','new input survives success');}
  if(id==='C04'){await step({type:'settle',result:false});assert.match(snapshot().text,/alpha/,'rejected message recoverable');assert.equal(snapshot().text.match(/alpha/g)?.length,1);assert.deepEqual(snapshot().document,originalDocument,'failed send restores original text and formatting without extra paragraphs');}
  if(id==='C05'){assert.equal(snapshot().editable,true);await step({type:'type',text:'beta'});await step({type:'settle',reject:true});assert.match(snapshot().text,/alpha/);assert.match(snapshot().text,/beta/);assert.equal(snapshot().text.match(/alpha/g)?.length,1);}
  if(id==='C06'){await step({type:'type',text:'beta'});assert.equal(snapshot().sendDisabled,true,'pending send remains visibly disabled');await click();assert.equal(lab.sends.length,1,'no duplicate send');}
  if(id==='C07'){await step({type:'switch',sessionId:'B'});await step({type:'set',html:'<p>bravo</p>'});await step({type:'settle',reject:true});assert.equal(snapshot().text,'bravo');const d=text(snapshot().drafts.A);assert.match(d,/alpha/);assert.doesNotMatch(d,/bravo/);}
  if(id==='C08'){await step({type:'switch',sessionId:'B'});await step({type:'switch',sessionId:'A'});await step({type:'type',text:'beta'});assert.equal(snapshot().sendDisabled,true,'return to pending task preserves lock');}
  if(id==='C09'){await step({type:'switch',sessionId:'B'});await step({type:'set',html:'<p>bravo</p>'});await click();assert.equal(lab.sends.length,2);await step({type:'settle',index:0});assert.equal(snapshot().editable,true,'A settling must not lock B typing');assert.equal(snapshot().sendDisabled,true,'B send remains in flight');await step({type:'type',text:'charlie'});await step({type:'settle',index:1});assert.equal(snapshot().text,'charlie');}

 }
 if(['C11','C12','C13','C14'].includes(id)){
  await setup('home',id==='C14'?'<p>alpha</p><p>second line</p>':'<p>alpha</p>');const before=snapshot().document;await click();assert.equal(lab.creates.length,1,'actual homepage initiated creation');
  if(id==='C11'||id==='C14'){if(snapshot().text===''){assert.equal(snapshot().editable,false,'optimistic homepage clear must visibly protect pending creation');assert.equal(snapshot().sendDisabled,true,'pending creation cannot be submitted twice');}else assert.deepEqual(snapshot().document,before,'retained homepage draft must not acquire empty paragraphs or change content');}
  if(id==='C12'){await step({type:'created'});assert.equal(snapshot().text,'');assert.equal(snapshot().navigations.length,1);assert.equal(snapshot().navigations[0][0],'/cc-agent/created');assert.equal(host.pendingFirst.consumePending('created')?.text,'alpha','original message handed off exactly');assert.equal(host.pendingFirst.consumePending('created'),null,'handoff consumed once');}
  if(id==='C13'){await step({type:'created',fail:true});assert.deepEqual(snapshot().document,before,'failed creation preserves exact original draft');assert.equal(snapshot().navigations.length,0);}
 }
 if(id==='C10'){
  await setup();await step({type:'set',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'alpha '},{type:'mentionChip',attrs:{kind:'session',path:'cindy://session/linked?message=anchor',label:'source',title:'source',titled:true}}]}]}});await click();
  assert.ok(lab.hydrationResolvers.length>0,'real message hydration reached localDb');assert.equal(lab.sends.length,0);
  await step({type:'switch',sessionId:'B'});await step({type:'switch',sessionId:'A'});const canType=snapshot().editable;if(canType)await step({type:'type',text:'new-draft-only'});await step({type:'hydrate'});assert.equal(lab.sends.length,1);assert.doesNotMatch(lab.sends[0].payload[0],/new-draft-only/,'new input must not enter original payload');if(canType)assert.match(snapshot().text,/new-draft-only/,'new draft preserved after hydration');
 }
 if(['C15','C16'].includes(id)){
  await setup();await step({type:'voice',text:'spoken preview'});await click();assert.equal(lab.sends.length,0,'voice refinement still pending');
  await step({type:'switch',sessionId:'B'});await step({type:'set',html:'<p>bravo</p>'});await step({type:'voiceFinal',text:'final dictated sentence',submitted:'spoken preview'});assert.equal(lab.sends.length,1);await step({type:'settle',reject:true});
  if(id==='C15'){assert.equal(snapshot().text,'bravo');assert.doesNotMatch(text(snapshot().drafts.A),/bravo/,'A never contains B draft');}
  if(id==='C16')assert.match(text(snapshot().drafts.A),/final dictated sentence/,'failed detached send restores refined dictation');
 }
 console.log(JSON.stringify({id,pass:true,trace,subscriptions:[...lab.subscriptions]}));
 }catch(e){console.log(JSON.stringify({id,pass:false,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),error:String(e),trace,subscriptions:[...lab.subscriptions]}));}
 await host.close();process.exit(0);
})().catch(e=>{console.log(JSON.stringify({id,status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exit(2)});
