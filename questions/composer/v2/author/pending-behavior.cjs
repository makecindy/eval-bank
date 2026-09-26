/** Sending behavior is independent of the ability to edit while pending. */
const assert=require('node:assert/strict'),path=require('node:path');
const id=process.argv[2];
(async()=>{
 const h=await require('../candidate/lab/browser-driver.cjs').create(path.resolve(process.argv[3]));
 const trace=[],settled=new Set();let handling;
 const read=async()=>{
  if(h.errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+h.errors.join('\n'));
  return h.page.evaluate(()=>({snapshot:h.snapshot(),payloads:lab.sends.map(s=>s.payload[0]),feedback:[...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')].map(e=>e.textContent).filter(Boolean).join('\n')}));
 };
 const step=async action=>{await h.run(action);const r=await read();trace.push({action,...r});return r};
 const click=async()=>{
  const b=h.page.getByRole('button',{name:'Send message',exact:true});
  assert.equal(await b.count(),1,'ENVIRONMENT_UNSUPPORTED: send trigger unavailable');
  const box=await b.boundingBox();assert.ok(box,'ENVIRONMENT_UNSUPPORTED: send trigger has no geometry');
  await h.page.mouse.click(box.x+box.width/2,box.y+box.height/2);await h.page.waitForTimeout(80);
  const r=await read();trace.push({action:{type:'pointerSend'},...r});return r;
 };
 const fill=async text=>{
  assert.equal((await read()).snapshot.editable,true,'editor remains locked after its own send settles');
  await step({type:'editorClick'});await h.page.keyboard.press('Meta+A');await step({type:'keyboardType',text});
  assert.equal((await read()).snapshot.text,text,'fixture typed intended draft');
 };
 const count=(r,text)=>r.payloads.filter(s=>s===text).length;
 const settle=async index=>{assert.ok(!settled.has(index));settled.add(index);return step({type:'settle',index})};
 const drain=async()=>{for(let n=0;n<8;n++){const r=await read(),i=r.payloads.findIndex((_,j)=>!settled.has(j));if(i<0)return;await settle(i)}assert.fail('unexpected repeated submissions')};
 const attempt=async text=>{
  const before=await read();assert.equal(before.snapshot.text,text);const after=await click();
  assert.ok(count(after,text)<=1,'same draft submitted more than once');
  assert.ok(after.payloads.every(s=>['A first','A next','B draft','A final'].includes(s)),'request content corrupted');
  const handled=before.snapshot.sendDisabled||after.snapshot.sendDisabled||count(after,text)===1||after.snapshot.text!==text||!!after.feedback&&after.feedback!==before.feedback;
  assert.ok(handled,'enabled Send silently ignored the user action: neither acceptance nor busy feedback');
  return {mode:'editable',queued:after.snapshot.text!==text&&count(after,text)===0,blocked:count(after,text)===0&&after.snapshot.text===text};
 };
 try{
  await step({type:'mount',sessionId:'A'});await fill('A first');await click();assert.equal(count(await read(),'A first'),1);
  if(id==='C08'){
   await step({type:'switch',sessionId:'B'});await fill('B draft');await click();assert.equal(count(await read(),'B draft'),1,'A must not block B');
   await step({type:'switch',sessionId:'A'});
  }else assert.equal(id,'C06');
  const pending=await read();
  if(pending.snapshot.editable){
   await fill('A next');handling=await attempt('A next');
  }else{
   // Do not inject a draft into a read-only editor. Physically exercise the
   // blocked send, verify no duplicate, then check recovery after settlement.
   const after=await click();
   assert.deepEqual(after.payloads,pending.payloads,'read-only pending click must not duplicate request');
   assert.equal(after.snapshot.text,pending.snapshot.text,'blocked action preserves displayed draft');
   assert.ok(pending.snapshot.sendDisabled||after.snapshot.sendDisabled||!!after.feedback&&after.feedback!==pending.feedback,'read-only composer has enabled silent Send');
   handling={mode:'whole-editor-locked',editableWhilePending:false};
  }
  await click();let r=await read();assert.equal(count(r,'A first'),1);assert.ok(count(r,'A next')<=1);
  await settle(0);
  if(handling.mode==='whole-editor-locked'){
   await fill('A next');await click();assert.equal(count(await read(),'A next'),1,'settlement restores ability to submit');
  }else{
   if(handling.queued)assert.equal(count(await read(),'A next'),1,'accepted queue must eventually submit draft');
   if(handling.blocked){assert.equal((await read()).snapshot.text,'A next','blocked draft remains retryable');await click();assert.equal(count(await read(),'A next'),1,'settlement restores ability to submit')}
  }
  await drain();r=await read();assert.equal(count(r,'A first'),1);assert.equal(count(r,'A next'),1);
  if(id==='C08'){
   assert.equal(count(r,'B draft'),1);await step({type:'switch',sessionId:'B'});assert.equal((await read()).snapshot.text,'','B settles without A content');await step({type:'switch',sessionId:'A'});
  }
  await fill('A final');await click();assert.equal(count(await read(),'A final'),1,'send does not remain permanently blocked');await drain();
  console.log(JSON.stringify({id,pass:true,browser:h.version,handling,trace,boundary:'real Chromium/ChatInput; local onSend acceptance'}));
 }catch(e){console.log(JSON.stringify({id,pass:false,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),error:String(e),browser:h.version,handling,trace}))}
 finally{await h.close()}
})().catch(e=>{console.log(JSON.stringify({id,status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
