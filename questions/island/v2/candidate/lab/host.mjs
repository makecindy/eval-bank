import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createDesktop({root=defaultRoot,now=1000,readyAt=8000}={}) {
  const build=path.join(root,'tests/lab-build');fs.mkdirSync(build,{recursive:true});
  const run=args=>{const r=spawnSync(path.join(root,'runtime/esbuild'),args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout;};
  const shared=JSON.parse(fs.readFileSync(path.join(root,'packages/maker-shared/package.json')));
  const stateCode=run(['apps/desktop/src/main/agent-island/state.ts','--bundle','--platform=node','--format=cjs','--alias:@cindy/maker-core=./packages/maker-core/src/agents/shared/network-error.ts',...Object.entries(shared.exports).map(([k,v])=>'--alias:@cindy/maker-shared'+(k==='.'?'':k.slice(1))+'=./packages/maker-shared/'+v)]);
  const serviceCode=run(['apps/desktop/src/main/agent-island/service.ts','--platform=node','--format=cjs']);
  fs.writeFileSync(path.join(build,'state.cjs'),stateCode);fs.writeFileSync(path.join(build,'service.cjs'),serviceCode);
  let clock=now, last=null, pending=null;
  const trace=[];
  const record=(kind,data={})=>trace.push({at:clock,kind,...data});
  const evaluate=(code,require)=>{const m={exports:{}};vm.runInNewContext(code,{module:m,exports:m.exports,require,Date:class extends Date{static now(){return clock;}},console,Map,Set,URL,Math,JSON,Number,String,Boolean,Array,Object,RegExp},{timeout:2000});return m.exports;};
  const S=evaluate(stateCode,n=>{throw Error('Unsupported state dependency: '+n);});
  const state=S.createAgentIslandState();
  const unsupported=n=>new Proxy(function(){throw Error('Unsupported native dependency invoked: '+n);},{get:(_,k)=>k==='then'?undefined:unsupported(n+'.'+String(k))});
  const log={info(){},warn(){},error(){},debug(){}};
  const C=evaluate(serviceCode,n=> n==='./state.js'?S:n==='../deepLink.js'?{openMainWindowSession:id=>{record('window.open',{sessionId:id,renderer:clock>=readyAt?'ready':'loading',display:last?.mode});pending=id;}}:n==='../logger.js'?{createLogger:()=>log}:new Proxy({},{get:(_,k)=>unsupported(n+'.'+String(k))})).AgentIslandService;
  const service=Object.create(C.prototype);service.state=state;
  service.playConfiguredSound=name=>record('audio',{name});
  service.publish=()=>{last=structuredClone(S.buildAgentIslandDisplayState(state,clock));record('display.publish',{mode:last.mode,sessionId:last.currentSessionId,policy:last.displayPolicy});};
  const publish=()=>service.publish();
  const deliver=()=>{if(pending && clock>=readyAt){const id=pending;pending=null;record('renderer.route',{sessionId:id});S.setAgentIslandAppFocused(state,true,clock);S.setAgentIslandVisibleSession(state,id,clock);publish();}};
  function act(op){
    if(op.at!==undefined){if(!Number.isFinite(op.at)||op.at<clock)throw Error('time must be monotonic');clock=op.at;}
    const id=op.id??'task-1';
    switch(op.type){
      case 'complete':case 'running':case 'error': {
        const event=op.type==='complete'?{type:'done',source:'codex',data:{result:'done'}}:op.type==='running'?{type:'status',source:'codex',data:{isRunning:true,status:'Running'}}:{type:'error',source:'claude-code',data:{message:'operation failed',isTerminal:true}};
        record('agent.event',{sessionId:id,event:event.type});S.applyAgentIslandEvent(state,{sessionId:id},event,clock);publish();break;}
      case 'click':record('input.click',{sessionId:id});service.focusSession(id);break;
      case 'advance':deliver();publish();break;
      case 'expand':S.requestAgentIslandManualExpand(state);publish();break;
      case 'outside':S.dismissAgentIslandActiveReveal(state,clock);publish();break;
      case 'pointer':S.setAgentIslandPointerZones(state,{menuBar:!!op.menuBar,panel:!!op.panel},clock);publish();break;
      case 'route':record('renderer.route',{sessionId:id});S.setAgentIslandVisibleSession(state,id,clock);publish();break;
      case 'focused':S.setAgentIslandAppFocused(state,!!op.value,clock);publish();break;
      case 'read':S.acknowledgeAgentIslandSessionRead(state,id,clock,{source:'explicit'});publish();break;
      case 'reload':readyAt=op.readyAt;pending=null;record('window.reload',{readyAt});break;
      case 'status':break;
      default:throw Error('Unknown action '+op.type);
    }
    return inspect();
  }
  function inspect(){return {at:clock,renderer:clock>=readyAt?'ready':'loading',display:last,sessions:[...state.sessions].map(([id,s])=>({id,phase:s.phase,unread:s.unread})),pendingNavigation:pending};}
  publish();return {act,inspect,trace};
}
