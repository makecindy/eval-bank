import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
fs.mkdirSync(path.join(root,'tests'),{recursive:true});
const p=path.join(root,'tests/environment-probe.txt');fs.writeFileSync(p,'probe');if(fs.readFileSync(p,'utf8')!=='probe')throw Error('probe mismatch');fs.unlinkSync(p);
const r=spawnSync(path.join(root,'runtime/esbuild'),['--version'],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
console.log(JSON.stringify({writeRead:true,node:process.version,esbuild:r.stdout.trim(),root,arch:process.arch,platform:process.platform}));
