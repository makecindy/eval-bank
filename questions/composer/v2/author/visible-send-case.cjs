const assert=require('node:assert/strict'),path=require('node:path');
const id=process.argv[2];
(async()=>{const h=await require('../candidate/lab/browser-driver.cjs').create(path.resolve(process.argv[3]));const trace=[];
try{
await h.run({type:'mount',sessionId:'A',remoteHostId:id==='C02'?'ssh-fixture':undefined});await h.run({type:'set',html:'<p>alpha</p>'});
await h.page.evaluate(()=>{window.sendFrameEvidence=[];const push=lab.sends.push.bind(lab.sends);lab.sends.push=(...rows)=>{const n=push(...rows);requestAnimationFrame(()=>requestAnimationFrame(()=>sendFrameEvidence.push({text:lab.editor.view.dom.textContent,document:lab.editor.getJSON(),payload:rows[0].payload[0],sendCount:lab.sends.length})));return n;};});
await h.run({type:'editorClick'});await h.run({type:'buttonClick'});
await h.page.waitForFunction(()=>sendFrameEvidence.length>0);
const evidence=await h.page.evaluate(()=>sendFrameEvidence);trace.push(...evidence);
assert.equal(evidence.length,1);assert.equal(evidence[0].payload,'alpha','original payload preserved');assert.equal(evidence[0].sendCount,1);assert.equal(evidence[0].text,'','composer clear by completed browser rendering opportunity while send remains pending');
console.log(JSON.stringify({id,pass:true,browser:h.version,trace}));
}catch(e){console.log(JSON.stringify({id,pass:false,error:String(e),trace}));}finally{await h.close();}})().catch(e=>{console.log(JSON.stringify({id,status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
