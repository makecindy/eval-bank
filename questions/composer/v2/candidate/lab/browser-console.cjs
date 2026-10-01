const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),bundle=path.join(root,'tests/browser-module.js');
(async()=>{
 fs.mkdirSync(path.dirname(bundle),{recursive:true});
 const build=cp.spawnSync(path.join(root,'runtime/node'),[path.join(__dirname,'build.cjs'),root,bundle],{cwd:root,env:{...process.env,LAB_BROWSER:'1'},encoding:'utf8',timeout:30000});
 if(build.status!==0)throw Error('BUILD_ERROR '+build.stdout+build.stderr);
 const h=await require('./browser-driver.cjs').create(bundle);
 try{
  const actions=JSON.parse(fs.readFileSync(process.argv[2]||path.join(__dirname,'scene.json'),'utf8'));
  for(const a of actions)console.log(JSON.stringify({action:a,result:await h.run(a),browser:h.version}));
 }finally{await h.close()}
})().catch(e=>{console.error(String(e));process.exitCode=2});
