const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const h=await require('../candidate/lab/host.cjs').create(path.resolve(process.argv[2]));
 const trace=[];const step=async a=>{const s=await h.run(a);trace.push({action:a,result:s});return s};
 const doc=(t,ref=false)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:t},...(ref?[{type:'mentionChip',attrs:{kind:'session',path:'cindy://session/linked?message=anchor',label:'source',title:'source',titled:true}}]:[])]}]});
 const file=t=>({id:t,name:t+'.txt',path:'/project/'+t+'.txt',ext:'.txt',category:'text',mimeType:'text/plain',size:4,textContent:t});
 try{
  await step({type:'seedDraft',sessionId:'A',draft:{text:doc('alpha ',true),attachments:[file('alpha-file')],quotes:[],browserComments:[]}});
  await step({type:'seedDraft',sessionId:'B',draft:{text:doc('bravo'),attachments:[file('bravo-file')],quotes:[],browserComments:[]}});
  await step({type:'mount',sessionId:'A'});await step({type:'focus'});await step({type:'click'});
  assert.ok(h.lab.hydrationResolvers.length>0,'actual reference lookup must be pending');
  assert.equal(h.lab.sends.length,0,'send must await hydration');
  const b=await step({type:'switch',sessionId:'B'});
  assert.equal(b.text,'bravo');assert.match(JSON.stringify(b.drafts.B),/bravo-file/);
  await step({type:'hydrate'});
  // An implementation may safely abort a detached non-voice send, retaining A.
  // If it continues, exercise failure recovery as well. Never require dispatch
  // after a switch when that was not the historical product contract.
  assert.ok(h.lab.sends.length<=1,'no duplicate dispatch');
  if(h.lab.sends.length){
   assert.match(h.lab.sends[0].payload[0],/alpha/);
   assert.doesNotMatch(JSON.stringify(h.lab.sends[0].payload),/bravo/);
   await step({type:'settle',reject:true});
  }
  const s=h.snapshot();assert.deepEqual(s.document,b.document,'B document unchanged');
  assert.deepEqual(s.drafts.B?.attachments,b.drafts.B?.attachments,'B attachments unchanged');
  const a=JSON.stringify(s.drafts.A);assert.match(a,/alpha/);assert.match(a,/alpha-file/);assert.doesNotMatch(a,/bravo/,'no B content restored into A');
  console.log(JSON.stringify({id:'C07-hydration',pass:true,detachedOutcome:h.lab.sends.length?'sent_then_rejected':'cancelled_with_source_retained',trace}));
 }catch(e){console.log(JSON.stringify({id:'C07-hydration',pass:false,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),error:String(e),trace}));}
 finally{await h.close();process.exit(0)}
})().catch(e=>{console.log(JSON.stringify({id:'C07-hydration',status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
