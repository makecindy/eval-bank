const assert=require('node:assert/strict'),path=require('node:path');
const id=process.argv[2];
(async()=>{
 const h=await require('../candidate/lab/browser-driver.cjs').create(path.resolve(process.argv[3]));
 const trace=[];const step=async a=>{const s=await h.run(a);trace.push({action:a,result:s});return s};
 try{
  await step({type:'mount',sessionId:'A'});await step({type:'set',html:'<p>alpha</p>'});
  const permission=h.page.getByRole('button',{name:/^Select permission mode:/});
  if(id==='C06-permission'){
   assert.equal(await permission.count(),1,'real permission trigger mounted');
   assert.equal(await permission.isDisabled(),false,'permission usable before send');
   await permission.click();await h.page.waitForTimeout(100);
   assert.ok(await h.page.getByRole('option').count()>0,'real permission options reachable');
   await h.page.keyboard.press('Escape');await h.page.waitForTimeout(100);
  }
  await step({type:'editorClick'});await step({type:'buttonClick'});
  const pending=await h.page.evaluate(()=>({s:h.snapshot(),payload:lab.sends[0]?.payload}));
  assert.equal(pending.s.sendCount,1,'send entered pending backend');
  assert.equal(pending.payload[0],'alpha','first message preserved');
  if(id==='C17'){
   assert.equal(pending.s.text,'','original composer cleared');
   await step({type:'keyboardType',text:'next sentence'});
   assert.equal((await h.page.evaluate(()=>h.snapshot())).text,'next sentence','keyboard input without refocusing enters next draft');
   assert.equal((await h.page.evaluate(()=>h.snapshot())).sendCount,1);
   // Settlement preservation belongs to C03, not the focus score.
   await step({type:'settle'});
  }else if(id==='C06-permission'){
   assert.equal(pending.s.editable,true,'typing may continue');
   assert.equal(await permission.isDisabled(),true,'permission must remain disabled while send pending');
   const box=await permission.boundingBox();assert.ok(box);
   await h.page.mouse.click(box.x+box.width/2,box.y+box.height/2);await h.page.waitForTimeout(100);
   assert.equal(await h.page.getByRole('option').count(),0,'disabled permission must not open options');
   await step({type:'settle'});
   assert.equal(await permission.isDisabled(),false,'permission becomes usable after settlement');
   await permission.click();await h.page.waitForTimeout(100);
   assert.ok(await h.page.getByRole('option').count()>0,'permission not permanently disabled');
  }else throw Error('unknown case '+id);
  console.log(JSON.stringify({id,pass:true,browser:h.version,trace}));
 }catch(e){console.log(JSON.stringify({id,pass:false,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),error:String(e),browser:h.version,trace}));}
 finally{await h.close()}
})().catch(e=>{console.log(JSON.stringify({id,status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
