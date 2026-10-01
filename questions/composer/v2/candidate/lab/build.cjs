const path=require('node:path'), fs=require('node:fs');
const esbuild=require('../runtime/node_modules/esbuild');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const labRoot=path.resolve(__dirname,'..');
const browser=process.env.LAB_BROWSER==='1';
const components=['ImageLightbox','ImageHoverPreview','TextLightbox','AttachmentTypeThumb','FullAccessConfirmContent','ModelSelector','ExtraDirsButton','NewGoalDialog','PlanModeIndicator','PendingQueuePanel','FolderPickerPopover','SlashCommandPalette','AtMentionPanel','ToolPayloadLightbox','VoiceInputStatusNotice','VoiceInputPointerHintLayer','CreateWorkerPopover','ThemeBrandLockup','WorktreeChipsRow','DeviceSwitcherPill','AddRemoteProjectDialog','ConnectProviderCard','InheritedSubscriptionNotice','PromotionalGrantNotice','AgentSelect','TopRightChipStack'];
const shims={
 '@/contexts/WorktreeContext':"export const useRefreshWorktrees=()=>()=>{};",
 '@/hooks/useCCSessions':"export const useCCSessions=()=>({createSession:(...a)=>globalThis.lab.createSession(...a),error:null});",

 'react-router-dom':"export const useNavigate=()=>globalThis.lab.navigate;export const useLocation=()=>({pathname:'/cc-agent/new',state:null});export const useOutletContext=()=>({});export const Link=(p)=>p.children;",
 '@/voice-input/useVoiceInput':"import {useSyncExternalStore} from 'react';export const useVoiceInput=(editor)=>{const v=useSyncExternalStore(cb=>{lab.voiceListeners.add(cb);return ()=>lab.voiceListeners.delete(cb)},()=>lab.voice);globalThis.lab.editor=editor;return {...v,stop:()=>lab.stopVoice(),start:async()=>{},cancel:()=>{},getLastSubmittedText:()=>lab.voiceSubmitted||'',getLastRefinement:()=>({refinedText:lab.voiceFinal||''})}}",
 '@/components/ui/confirm-dialog-provider':"export const useConfirmDialog=()=>({confirm:async()=>true});",
 '@/contexts/AuthContext':"export const useAuth=()=>({user:{id:'lab'},dataOwnerId:'lab',isAuthenticated:true,loading:false});",
};
const uiNames=new Set(components);
function resolveTs(p){for(const ext of ['', '.ts','.tsx','.js','/index.ts','/index.tsx'])if(fs.existsSync(p+ext)&&fs.statSync(p+ext).isFile())return p+ext;throw Error('unresolved '+p)}
const plugin={name:'lab-boundaries',setup(b){
 b.onLoad({filter:/\.(ts|tsx)$/,namespace:'file'},a=>{if(!process.argv[4])return;const f=path.join(process.argv[4],path.relative(root,a.path));if(fs.existsSync(f))return {contents:fs.readFileSync(f,'utf8'),loader:a.path.endsWith('.tsx')?'tsx':'ts',resolveDir:path.dirname(a.path)};});
 b.onResolve({filter:/./},args=>{
 if(shims[args.path])return {path:args.path,namespace:'lab-shim'};
 const name=path.basename(args.path).replace(/\.[^.]+$/,'');
 if(uiNames.has(name))return {path:name,namespace:'lab-ui'};
 if(args.path.startsWith('@/')) return {path:resolveTs(path.resolve(root,'apps/desktop/src/renderer',args.path.slice(2)))};
 if(args.path.startsWith('@cindy/')){
 const [scope,pkg,...sub]=args.path.split('/');const p=path.join(root,'packages',pkg,'package.json');
 if(fs.existsSync(p)){const meta=JSON.parse(fs.readFileSync(p));let ex=meta.exports?.[sub.length?'./'+sub.join('/') : '.']; if(typeof ex==='object')ex=ex.import||ex.default; if(typeof ex==='string')return {path:path.resolve(path.dirname(p),ex)};}
 }
 });
 b.onLoad({filter:/.*/,namespace:'lab-shim'},args=>({contents:shims[args.path],loader:'jsx',resolveDir:root}));
 b.onLoad({filter:/.*/,namespace:'lab-ui'},args=>{
 const imports=[];for(const file of ['ChatInput.tsx','../../features/cc-agent/NewMakerDraftRoute.tsx']){
 const s=fs.readFileSync(path.resolve(root,'apps/desktop/src/renderer/components/new-chat',file),'utf8');
 for(const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) if(path.basename(m[2])===args.path)for(let n of m[1].split(',')){n=n.trim();if(!n||n.startsWith('type '))continue;imports.push(n.split(/\s+as\s+/)[0]);}
 }
 const names=[...new Set(imports)];
 return {contents:names.map(n=>`export const ${n} = ${/^[A-Z]/.test(n)?'(props)=>props.children??null':'()=>undefined'};`).join('\n'),loader:'jsx'};
 });
}};
esbuild.build({stdin:{contents:fs.readFileSync(path.join(labRoot,'lab/entry.tsx'),'utf8'),resolveDir:path.join(root,'lab'),loader:'tsx'},outfile:process.argv[3]||path.join(root,'tests/module.cjs'),metafile:true,define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},bundle:true,platform:browser?'browser':'node',format:browser?'iife':'cjs',globalName:browser?'ComposerModule':undefined,jsx:'automatic',nodePaths:[path.join(labRoot,'runtime/node_modules')],loader:{'.svg':'dataurl','.png':'dataurl','.css':'empty'},plugins:[plugin],logLevel:'silent'}).then(result=>fs.writeFileSync((process.argv[3]||path.join(root,'tests/module.cjs'))+'.meta.json',JSON.stringify(result.metafile))).catch(e=>{console.log(e.errors?.map(x=>x.text+' @ '+x.location?.file+':'+x.location?.line).join('\n')||e);process.exitCode=1});
