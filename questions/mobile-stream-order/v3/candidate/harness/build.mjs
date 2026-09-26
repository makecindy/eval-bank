import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import esbuild from '../runtime/node_modules/esbuild/lib/main.js';
const harness=path.dirname(fileURLToPath(import.meta.url));
const home=path.dirname(harness);
export async function build(sourceRoot=home, output=path.join(sourceRoot,'.build/model.mjs')) {
 const aliases=JSON.parse(fs.readFileSync(path.join(harness,'aliases.json'),'utf8'));
 const result=await esbuild.build({stdin:{contents:`export {HistoryViewController,HistoryViewHandoff,projectHistoryView,renderHistoryView} from '@cindy/maker-shared/message-window';export {buildMobileHistoryRenderItems} from '@/session/mobileHistoryRender';export {buildMobileMessageRenderItems} from '@/session/messageRenderModel';`,resolveDir:sourceRoot,sourcefile:'adapter-entry.ts'},bundle:true,platform:'node',format:'esm',outfile:output,metafile:true,plugins:[{name:'offline-source',setup(b){b.onResolve({filter:/^(@cindy\/|@\/)/},a=>{
 let p;
 if(a.path==='@/i18n') p=path.join(home,'stubs/i18n.ts');
 else if(a.path==='@/device-link/remoteStatus') p=path.join(home,'stubs/remoteStatus.ts');
 else if(a.path==='@cindy/device-link') p=path.join(sourceRoot,'packages/device-link/src/allowlist.ts');
 else if(a.path.startsWith('@cindy/maker-shared/')) p=path.join(sourceRoot,'packages/maker-shared',aliases['./'+a.path.split('/').slice(2).join('/')]);
 else if(a.path.startsWith('@/')) p=path.join(sourceRoot,'apps/mobile/src',a.path.slice(2));
 else throw new Error('Unsupported import '+a.path);
 for(const q of [p,p+'.ts',p+'.tsx',p+'/index.ts']) if(fs.existsSync(q)&&fs.statSync(q).isFile()) return {path:q};
 throw new Error('Missing source '+p);
});}}]});
 fs.writeFileSync(output+'.meta.json',JSON.stringify(result.metafile,null,2));
 return output;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) console.log(await build(path.resolve(process.argv[2]||home),process.argv[3]?path.resolve(process.argv[3]):undefined));
