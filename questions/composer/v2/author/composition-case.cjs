
const assert=require('node:assert/strict');
(async()=>{const h=await require('../candidate/lab/host.cjs').create(process.argv[2]);const trace=[];
const step=async a=>{const s=await h.run(a);trace.push({action:a,snapshot:s});return s};
try{
 await step({type:'mount',sessionId:'A'});await step({type:'set',html:'<p>A first</p>'});await step({type:'focus'});await step({type:'click'});assert.equal(h.lab.sends.length,1);
 assert.equal(h.snapshot().editable,true);await step({type:'type',text:'A next'});await step({type:'flush'});
 await step({type:'switch',sessionId:'B'});await step({type:'set',html:'<p>B first</p>'});await step({type:'focus'});await step({type:'click'});assert.equal(h.lab.sends.length,2);
 await step({type:'type',text:'B next'});await step({type:'flush'});const b=structuredClone(h.snapshot().document);
 await step({type:'settle',index:0,result:false});assert.deepEqual(h.snapshot().document,b,'A rejection changed B draft');
 await step({type:'switch',sessionId:'A'});const a=h.snapshot().text;assert.ok(a.includes('A first')&&a.includes('A next'),'both source and new A drafts remain');assert.ok(!a.includes('B'));
 await step({type:'settle',index:1});assert.equal(h.snapshot().text,a,'B success changed A restored draft');
 await step({type:'focus'});await step({type:'click'});assert.equal(h.lab.sends.length,3);const sent=h.lab.sends[2].payload[0];assert.ok(sent.includes('A first')&&sent.includes('A next'));assert.equal(sent.split('A first').length,2);
 await step({type:'settle',index:2});await step({type:'switch',sessionId:'B'});assert.equal(h.snapshot().text,'B next');
 console.log(JSON.stringify({id:'X01',pass:true,trace}));
}catch(e){console.log(JSON.stringify({id:'X01',pass:false,error:String(e),trace,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{})}))}
finally{await h.close();process.exit(0)}})().catch(e=>{console.log(JSON.stringify({id:'X01',status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
