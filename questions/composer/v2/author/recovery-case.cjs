const assert = require('node:assert/strict');
const path = require('node:path');
const p = text => ({type:'paragraph',content:[{type:'text',text}]});
const fixture = {type:'doc',content:[
  {type:'paragraph',content:[{type:'text',text:'alpha'},{type:'hardBreak'},{type:'text',text:'continuation'}]},
  {type:'bulletList',content:[{type:'listItem',content:[p('first item')]},{type:'listItem',content:[p('second item')]}]},
  {type:'paragraph',content:[{type:'text',text:'before '},{type:'composerQuote',attrs:{text:'quoted evidence',sourcePath:'example.ts',startLine:2,endLine:3}},{type:'text',text:' after'}]},
]};
(async () => {
  const h=await require('../candidate/lab/host.cjs').create(path.resolve(process.argv[2]));
  const trace=[]; let original;
  const step=async action=>{const result=await h.run(action);trace.push({action,result,payloads:h.lab.sends.map(s=>s.payload)});return result};
  try {
    await step({type:'mount',sessionId:'A'});
    original=(await step({type:'set',document:fixture})).document;
    const types=[];const visit=n=>{types.push(n.type);for(const child of n.content||[])visit(child)};visit(original);
    for(const type of ['hardBreak','bulletList','listItem','composerQuote'])
      assert.ok(types.includes(type),'supported schema fixture lost '+type);
    await step({type:'focus'});await step({type:'click'});
    assert.equal(h.lab.sends.length,1);
    assert.equal((h.lab.sends[0].payload[0].match(/alpha/g)||[]).length,1);
    await step({type:'settle',result:false});
    assert.deepEqual(h.snapshot().document,original,'false restores full supported structure without extra paragraphs');
    assert.equal((h.snapshot().text.match(/alpha/g)||[]).length,1);
    console.log(JSON.stringify({id:'C04',pass:true,fixtureTypes:types,trace}));
  } catch(e) {
    console.log(JSON.stringify({id:'C04',pass:false,...(String(e).includes('ENVIRONMENT_UNSUPPORTED')?{status:'ENVIRONMENT_UNSUPPORTED'}:{}),error:String(e),original,trace}));
  } finally {await h.close();process.exit(0);}
})().catch(e=>{console.log(JSON.stringify({id:'C04',status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}));process.exitCode=2});
