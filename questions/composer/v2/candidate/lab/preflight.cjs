const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const cwd = fs.realpathSync(process.cwd());
const fail = (reason) => { console.error(JSON.stringify({ok:false,status:'ENVIRONMENT_BLOCKED',reason,root,cwd}));process.exit(2); };
if (cwd !== root) fail('CWD_MISMATCH: run must start in the candidate root');
const mode = process.argv[2];
if (!['--prepare','--verify'].includes(mode)) fail('Usage: preflight.cjs --prepare | --verify');
const dir = path.join(root, 'tests', 'environment-preflight');
const marker = path.join(dir, 'probe.cjs');
const manifestPath = path.join(dir, 'manifest.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
if (mode === '--prepare') {
  fs.mkdirSync(dir,{recursive:true});
  const id=crypto.randomUUID();
  const original=`module.exports = { runId: ${JSON.stringify(id)}, value: 1 };\n`;
  fs.writeFileSync(marker,original);
  if(fs.readFileSync(marker,'utf8')!==original) fail('READBACK_MISMATCH');
  fs.writeFileSync(manifestPath,JSON.stringify({runId:id,root,beforeSha256:sha(original),preparedAt:new Date().toISOString()},null,2));
  console.log(JSON.stringify({ok:true,phase:'prepared',root,cwd,runId:id,editFile:marker,instruction:'Read this file, then use your editing tool to change value: 1 to value: 2. Read it back; run --verify. Do not edit runId or manifest.'}));
  process.exit(0);
}
if(!fs.existsSync(manifestPath)||!fs.existsSync(marker)) fail('PREPARE_REQUIRED');
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(m.root!==root) fail('PROBE_ROOT_MISMATCH');
const source=fs.readFileSync(marker,'utf8');
if(sha(source)===m.beforeSha256) fail('EDIT_NOT_OBSERVED: probe source has not changed');
const code=`const p=require(${JSON.stringify(marker)});console.log(JSON.stringify({probe:p,cwd:process.cwd(),file:${JSON.stringify(marker)}}));`;
const exec=cp.spawnSync(path.join(root,'runtime/node'),['-e',code],{cwd:root,encoding:'utf8',timeout:10000});
if(exec.status!==0) fail('EDITED_PROBE_EXECUTION_FAILED: '+exec.stderr);
let actual;try {actual=JSON.parse(exec.stdout)} catch {fail('INVALID_PROBE_OUTPUT')}
if(actual.probe.runId!==m.runId||actual.probe.value!==2||fs.realpathSync(actual.cwd)!==root) fail('EDITED_OUTPUT_MISMATCH');
const build=cp.spawnSync(path.join(root,'runtime/node'),[path.join(__dirname,'build.cjs')],{cwd:root,encoding:'utf8',timeout:30000});
const browser=build.status===0?cp.spawnSync(path.join(root,'runtime/node'),[path.join(__dirname,'browser-console.cjs')],{cwd:root,encoding:'utf8',timeout:30000}):{status:2,stdout:'',stderr:'build failed'};
const result={browser:browser.status===0,ok:build.status===0 && browser.status===0,phase:'verified',runId:m.runId,root,cwd,readWriteEditExecuteReadback:build.status===0 && browser.status===0,beforeSha256:m.beforeSha256,afterSha256:sha(source),executedProbe:actual,build:build.status===0,node:process.version,verifiedAt:new Date().toISOString(),boundary:'This proves the edited local file executes. Host session cwd and actual editor tool path must also be checked externally.'};
fs.writeFileSync(path.join(dir,`receipt-${m.runId}.json`),JSON.stringify({...result,browserOutput:{status:browser.status,stdout:browser.stdout,stderr:browser.stderr},buildOutput:{status:build.status,stdout:build.stdout,stderr:build.stderr}},null,2));
console.log(JSON.stringify(result));process.exit(result.ok?0:2);
