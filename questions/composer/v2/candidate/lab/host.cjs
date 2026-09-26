const {JSDOM}=require('../runtime/node_modules/jsdom');
const d=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
for(const k of ['window','document','localStorage','sessionStorage','navigator','HTMLElement','Element','Node','Text','MutationObserver','DOMParser','getComputedStyle','CustomEvent','Event','KeyboardEvent','requestAnimationFrame','cancelAnimationFrame']) Object.defineProperty(globalThis,k,{value:d.window[k],configurable:true});
d.window.Range.prototype.getClientRects=()=>[];d.window.Range.prototype.getBoundingClientRect=()=>({top:0,left:0,bottom:0,right:0,width:0,height:0});
 globalThis.ResizeObserver=class {observe(){} disconnect(){} unobserve(){}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
window.addEventListener('error',e=>{lab.errors.push(String(e.error));});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
globalThis.lab={subscriptions:new Set(),navigate:(...a)=>{lab.navigations.push(a)},navigations:[],sends:[],creates:[]};
const unsupported=new Set();
function api(prefix){return new Proxy({}, {get(_,name){if(name==='crossAgent')return api(prefix+'.crossAgent'); if(name==='plugins')return {getState:async()=>({enabled:[]})}; if(name==='list')return async()=>({hosts:[]}); if(name==='listDevices')return async()=>({devices:[]}); if(name==='listProviders')return async()=>globalThis.lab.catalog; if(name==='listHosts')return async()=>({hosts:[]}); if(name==='getCapabilities')return async()=>({hasFastMode:false,availableModels:[{id:'claude-sonnet-4-6',displayName:'Test',contextWindow:200000,efforts:['medium'],defaultEffort:'medium'}],permissionModes:[{id:'default',displayName:'Ask',description:'Ask before changes'},{id:'acceptEdits',displayName:'Edit',description:'Allow editing'}],effortLevels:[]}); if(name==='listAvailableAgents')return async()=>[]; if(name==='getSessionAgentSwitchIntent')return async()=>null; if(['listDesktopCommands','listAgentCommands','listAgentSkills'].includes(name))return async()=>[]; if(name==='setGlobalShortcut')return async()=>({ok:true}); if(name==='getDataSnapshot')return ()=>({settings:{shortcut:null}}); if(name==='workdirPrefsSync')return ()=>({}); if(name==='listSync')return ()=>({ghosts:[]}); if(name==='then'||name==='schedule')return undefined; if(["deviceLink.onControlTargetChanged", "deviceLink.onPresenceChanged", "deviceLink.onRemotePush", "ghosts.onChanged", "maker.crossAgent.onStep", "maker.onDesktopCommandTriggered", "maker.onPiPackagesChanged", "maker.onSessionCredentialSwitchApplied", "remoteSsh.onStatusChanged", "voiceInput.onDataChanged", "voiceInput.onGlobalShortcutTrigger"].includes(prefix+'.'+String(name)))return ()=>{globalThis.lab.subscriptions.add(prefix+'.'+String(name));return ()=>{}};return (...args)=>{unsupported.add(prefix+'.'+String(name));throw Error('ENVIRONMENT_UNSUPPORTED: '+prefix+'.'+String(name))}}})}
window.electronAPI={localDb:{messages:{aroundClientId:()=>new Promise(r=>lab.hydrationResolvers.push(r))}},onNewMakerWorktreeBranchChanged:()=>()=>{},onNewMakerWorktreePreferenceChanged:()=>()=>{},platform:'darwin',maker:api('maker'),voiceInput:api('voiceInput'),deviceLink:api('deviceLink'),ghosts:api('ghosts'),providers:api('providers'),remoteSsh:api('remoteSsh')};


lab.errors=[];lab.hydrationResolvers=[];lab.voiceListeners=new Set();lab.voice={state:'idle',isBusy:false,isListening:false,draftText:''};lab.stopVoice=()=>new Promise(r=>{lab.voiceResolve=r});

exports.create=async function(modulePath){
 const {React,createRoot,ChatInput,NewMakerDraftRoute,newDraft,useAttachments,providerSnapshots,owner,drafts,pendingFirst}=require(modulePath);
 owner.setDataOwnerGeneration('lab');
 lab.catalog={dataOwnerId:'lab',ownerGeneration:0,providerOrder:['test'],providers:[{id:'test',name:'Test',connected:true,agents:['claude-code'],routing:{'claude-code':{kind:'native'}},models:{'claude-code':[{id:'claude-sonnet-4-6',displayName:'Test',mode:'chat',efforts:['medium']}]}}]};
 providerSnapshots.commitProvidersSnapshot(providerSnapshots.beginProvidersRefresh(),lab.catalog);
 let current={type:'task',sessionId:'A',remoteHostId:undefined};
 let root=createRoot(document.getElementById('root'));
 const snapshot=()=>({document:lab.editor?.getJSON(),text:lab.editor?.getText(),editable:lab.editor?.isEditable,focused:document.activeElement===lab.editor?.view.dom,permissionDisabled:document.querySelector('[aria-label^="Select permission mode:"]')?.disabled,sendDisabled:document.querySelector('[aria-label="Send message"]')?.disabled,navigations:[...lab.navigations],sendCount:lab.sends.length,createCount:lab.creates.length,drafts:Object.fromEntries(['A','B','new-maker-draft'].map(k=>[k,drafts.getDraft(k)]))});
 const makePending=(list,payload)=>new Promise((resolve,reject)=>{list.push({payload,atCall:snapshot(),resolve,reject});});
 lab.createSession=(args)=>makePending(lab.creates,args);
 function Wrapper(){return React.createElement(ChatInput,{sessionId:current.sessionId,initialWorkingDir:'/project',remoteHostId:current.remoteHostId,initialModel:'claude-sonnet-4-6',initialEffort:'medium',vendorKey:'cc',deviceLinkDeviceId:null,onSend:(...args)=>makePending(lab.sends,args),attachmentState:useAttachments(current.sessionId)})}
 const flush=async()=>{await React.act(async()=>{await new Promise(r=>setTimeout(r,25));});};
 const act=async(fn)=>{await React.act(async()=>{await fn();});await flush();};
 const render=async(options={})=>{current={...current,...options};await act(()=>root.render(React.createElement(current.type==='home'?NewMakerDraftRoute:Wrapper)));};
 const run=async(action)=>{
  if(action.type==='seedDraft')await act(()=>drafts.saveDraft(action.sessionId,action.draft));
  else if(action.type==='mount'||action.type==='switch')await render({...action,type:action.view||current.type});
  else if(action.type==='type')await act(()=>{if(!lab.editor.isEditable)throw Error('EDITOR_LOCKED');lab.editor.commands.insertContent(action.html||action.text);});
  else if(action.type==='set')await act(()=>lab.editor.commands.setContent(action.document||action.html));
  else if(action.type==='click')await act(()=>lab.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
  else if(action.type==='settle')await act(()=>{const p=lab.sends[action.index??0];if(!p)throw Error('NO_PENDING_SEND');if(action.reject)p.reject(Error('test send failed'));else p.resolve(action.result??true);});
  else if(action.type==='created')await act(()=>{const p=lab.creates[action.index??0];if(!p)throw Error('NO_PENDING_CREATE');p.resolve(action.fail?null:{...p.payload,id:'created'});});
  else if(action.type==='voice')await act(()=>{lab.voice={state:'listening',isBusy:true,isListening:true,draftText:action.text};for(const f of lab.voiceListeners)f();});
  else if(action.type==='voiceFinal')await act(()=>{lab.voiceSubmitted=action.submitted||'';lab.voiceFinal=action.text;lab.voiceResolve();});
  else if(action.type==='hydrate')await act(()=>{for(const r of lab.hydrationResolvers)r([{clientId:'anchor',role:'user',content:'quoted message'}]);});
  else if(action.type==='focus')await act(()=>lab.editor.commands.focus('end'));
  else if(action.type==='flush')await flush();
  else throw Error('UNKNOWN_ACTION '+action.type);
  if(unsupported.size||lab.errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+JSON.stringify([...unsupported,...lab.errors]));
  return snapshot();
 };
 return {run,snapshot,lab,pendingFirst,close:async()=>{await act(()=>root.unmount());d.window.close();}};
};
