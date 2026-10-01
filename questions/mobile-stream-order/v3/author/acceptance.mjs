import assert from 'node:assert/strict';
export const formalItems=['C01','C02','C03','C04'];
const stamp=n=>new Date(Date.UTC(2026,6,21,10,0,n)).toISOString();
const row=(id,text,second=2,meta=null,role='assistant')=>({id:'db-'+id,clientId:id,sessionId:'exercise',role,content:text,createdAt:stamp(second),toolUseId:null,agentMeta:meta});
const flatten=items=>items.flatMap(x=>x.type==='message'?[x.message]:x.type==='subagent_group'?flatten(x.childItems):x.type==='work_group'?flatten(x.children):[]);
const groups=items=>items.flatMap(x=>x.type==='subagent_group'?[x,...groups(x.childItems)]:x.type==='work_group'?groups(x.children):[]);
export async function assess(api,{publicOnly=false}={}) {
 const results=[];
 async function scenario(item,name,run){
  let events=[];const views=[];const segments=[];
  const phase=(nextItem,nextName)=>{segments.push({item,name,events});item=nextItem;name=nextName;events=[];};
  const check=(event,actual,expected)=>{try{assert.deepEqual(actual,expected);events.push({event,pass:true,actual,expected});}catch(e){events.push({event,pass:false,actual,expected,error:e.message});}};
  const open=async(history)=>{
   const box={history};
   const view=new api.HistoryViewController({page:async()=>({version:1,items:api.projectHistoryView(box.history,false),nextCursor:null,hasMore:false}),details:async()=>{throw Error('Unexpected deferred detail read');},expanded:async()=>{}});
   views.push(view);await view.refresh();
   const handoff=new api.HistoryViewHandoff(m=>m.agentMeta?.isStreaming===true);
   const render=(raw,streaming=true)=>{
    const before=structuredClone({raw,history:box.history});
    const state=handoff.reconcile(view.getSnapshot(),raw);
    const items=api.buildMobileHistoryRenderItems({view,snapshot:view.getSnapshot(),messages:state.messages,pendingHandoff:state.pending,streaming,sessionId:'exercise'});
    check('input data unchanged', {raw,history:box.history},before);
    const sourceById=new Map(raw.map(m=>[m.clientId,m]));
    for(const m of box.history) sourceById.set(m.clientId,m);
    for(const m of flatten(items)) {
     const original=sourceById.get(m.source.clientId);
     check('source timestamp retained: '+m.source.clientId,m.source.createdAt,original?.createdAt);
    }
    return {items,messages:flatten(items),pending:[...state.pending]};
   };
   return {box,view,handoff,render};
  };
  try{await run({check,open,phase});}catch(e){events.push({event:'scenario exception',pass:false,error:e.stack});}
  finally{for(const view of views)view.setActive(false);}
  segments.push({item,name,events});
  results.push(...segments.map(s=>({...s,pass:s.events.length>0&&s.events.every(x=>x.pass)})));
 }
 // Event ledger is authored from visible paragraph identities, never from timestamp sorting.
 await scenario('C01','single-tail-history-recovery',async({check,open,phase})=>{
  const q=row('question','Describe the route',0,null,'user');
  let a=row('harbor','Start at the harbor.',4),b=row('bridge','Then cross',4,{isStreaming:true});
  const x=await open([q,a]);
  const observe=(name,raw,expected,streaming=true)=>{
   const out=x.render(raw,streaming);
   check(name,out.messages.map(m=>[m.source.clientId,m.body]),expected);
   return out;
  };
  observe('first streamed paragraph follows displayed paragraph',[a,b],[['question',q.content],['harbor',a.content],['bridge',b.content]]);
  x.box.history=[q,{...a,createdAt:stamp(27),rowid:901}];
  x.view.setNetworkAvailable(false);x.view.setNetworkAvailable(true);await x.view.refresh();
  let out=observe('recovery retains visible order',[a,b],[['question',q.content],['harbor',a.content],['bridge',b.content]]);
  check('tail remains actively streaming',out.messages.find(m=>m.source.clientId==='bridge')?.isStreaming,true);
  check('provisional timestamp not fabricated',out.messages.find(m=>m.source.clientId==='bridge')?.source.createdAt,b.createdAt);
  b={...b,content:'Then cross the stone bridge.'};
  observe('delta stays with original paragraph',[a,b],[['question',q.content],['harbor',a.content],['bridge',b.content]]);
  phase('C02','multiple-paragraph-persistence');
  b={...b,agentMeta:null};const c=row('orchard','Finish at the orchard.',5,{isStreaming:true});
  observe('next paragraph starts after finalized tail',[a,b,c],[['question',q.content],['harbor',a.content],['bridge',b.content],['orchard',c.content]]);
  b={...b,createdAt:stamp(35),rowid:902};
  out=observe('durable push reorders raw store before page catches up',[a,c,b],[['question',q.content],['harbor',a.content],['bridge',b.content],['orchard',c.content]]);
  check('finalized paragraph not streaming',!!out.messages.find(m=>m.source.clientId==='bridge')?.isStreaming,false);
  x.box.history=[...x.box.history,b];await x.view.refresh();
  observe('partial history handoff neither loses nor repeats prose',[a,c,b],[['question',q.content],['harbor',a.content],['bridge',b.content],['orchard',c.content]]);
  const done={...c,agentMeta:null,createdAt:stamp(41),rowid:903};x.box.history.push(done);await x.view.refresh();
  out=observe('all history takes over once',[a,b,done],[['question',q.content],['harbor',a.content],['bridge',b.content],['orchard',done.content]],false);
  check('handoff released after all bodies persisted',out.pending,[]);
 });
 if(publicOnly)return {results};
 await scenario('C01','legacy-raw-entry-compatibility',async({check})=>{
  const raw=[row('late','late',30),row('early','early',10),row('mid','middle',20)];const before=structuredClone(raw);
  check('legacy caller still receives chronological body order',flatten(api.buildMobileMessageRenderItems(raw)).map(m=>m.body),['early','middle','late']);
  check('legacy input unchanged',raw,before);
 });
 for(const status of ['pending','blocked']) await scenario('C03','shared-local-anchor-'+status,async({check,open})=>{
  const known=row('stored','Already visible',20);
  let alpha=row('alpha','First new paragraph',21,{isStreaming:true});
  const beta=row('beta','Second new paragraph',22,{isStreaming:true});
  const locals=['before','between','after'].map((id)=>({...row('local-'+id,'User note '+id,0,null,'user'),[status==='pending'?'isPendingPersist':'blockedByGhost']:true}));
  const x=await open([known]);
  const observe=(name,raw,expected)=>{
   const before=structuredClone(raw);const state=x.handoff.reconcile(x.view.getSnapshot(),raw);
   // Existing shared consumer contract: local UI rows come from raw store. Mobile handoff drops these.
   // Observe actual shared renderer's output contract before consumer-specific grouping.
   const output=api.renderHistoryView({view:x.view,snapshot:x.view.getSnapshot(),liveMessages:raw,pendingHandoff:state.pending,streaming:true,isLive:m=>m.agentMeta?.isStreaming===true,isLocalUser:m=>m.isPendingPersist===true||m.blockedByGhost===true,build:rows=>[...rows],structure:{children:()=>undefined,sourceIds:m=>[m.clientId],placeholder:()=>{throw Error('unexpected placeholder')},rebuild:x=>x}});
   check(name,output.map(m=>[m.clientId,m.content,m.createdAt]),expected.map(m=>[m.clientId,m.content,m.createdAt]));check('shared local source unchanged',raw,before);
  };
  const expected=[known,locals[0],alpha,locals[1],beta,locals[2]];
  observe('local notes in observed slots',expected,expected);
  alpha={...alpha,createdAt:stamp(39),rowid:44,agentMeta:null};
  observe('clock-updated store retains local context slots',[known,locals[0],beta,locals[1],alpha,locals[2]],[known,locals[0],alpha,locals[1],beta,locals[2]]);
  observe('removing a local note does not resurrect it',[known,beta,locals[1],alpha,locals[2]],[known,alpha,locals[1],beta,locals[2]]);
 });
 for(const depth of [1,3,8]) await scenario('C04','nested-recovery-depth-'+depth,async({check,open})=>{
  const parents=Array.from({length:depth},(_,i)=>({...row('call-'+i,{toolName:'Agent',toolUseId:'job-'+i,input:{description:'Research branch '+i}},i+1,i?{parentUuid:'job-'+(i-1)}:null,'tool_use'),toolUseId:'job-'+i}));
  const parent='job-'+(depth-1), alternate=depth>5?'job-'+(depth-2):parent;
  let one=row('north','North trail is open.',24,{parentUuid:parent});
  let two=row('east','East trail',25,{parentUuid:alternate,isStreaming:true});
  const three=row('south','South trail is sheltered.',26,{parentUuid:parent,isStreaming:true});
  const x=await open([...parents,one]);
  const observe=(name,raw,expected)=>{
   const out=x.render(raw);
   check(name,out.messages.map(m=>[m.source.clientId,m.body]),expected.map(m=>[m.clientId,m.content]));
   check('subagent card remains present',groups(out.items).length>=Math.min(depth,2),true);
   if(depth<=3){
    const paths=[];
    const walk=(items,ancestors=[])=>{for(const item of items){
     if(item.type==='message')paths.push([item.message.source.clientId,ancestors]);
     else if(item.type==='subagent_group')walk(item.childItems,[...ancestors,item.header.description]);
     else if(item.type==='work_group')walk(item.children,ancestors);
    }};walk(out.items);
    check('paragraphs remain in their owning nested cards',paths,expected.map(m=>[m.clientId,Array.from({length:depth},(_,i)=>'Research branch '+i)]));
   }
   return out;
  };
  observe('first nested paragraph visible',[...parents,one,two],[one,two]);
  x.box.history=[...parents,{...one,createdAt:stamp(38),rowid:601}];await x.view.refresh();
  observe('nested history recovery',[...parents,one,two],[one,two]);
  two={...two,content:'East trail crosses a stream.'};
  observe('nested content delta',[...parents,one,two],[one,two]);
  two={...two,agentMeta:{parentUuid:alternate}};
  observe('nested third paragraph',[...parents,one,two,three],[one,two,three]);
  two={...two,createdAt:stamp(44),rowid:602};
  const out=observe('nested persisted push before history',[...parents,one,three,two],[one,two,three]);
  check('nested live tail remains visible and streaming',out.messages.find(m=>m.source.clientId==='south')?.isStreaming,true);
  const final={...three,createdAt:stamp(48),rowid:603,agentMeta:{parentUuid:parent}};
  x.box.history.push(two,final);await x.view.refresh();
  const end=observe('nested completed history handoff',[...parents,one,two,final],[one,two,final]);
  check('nested handoff released',end.pending,[]);
 });

 for(const seed of [3,17,29]) await scenario('C02','successive-persistence-and-reconnect-'+seed,async({check,open})=>{
  const question=row('q'+seed,'Route?',0,null,'user');const x=await open([question]);let raw=[],expected=[question];
  for(let i=0;i<5;i++){
   const id='p'+seed+'-'+i;let message=row(id,'paragraph '+i,2,{isStreaming:true});raw.push(message);expected.push(message);
   let out=x.render(raw);check('new tail '+i,out.messages.map(m=>m.source.clientId),expected.map(m=>m.clientId));
   message={...message,content:message.content+' delta'};raw=raw.map(m=>m.clientId===id?message:m);expected[expected.length-1]=message;
   out=x.render(raw);check('delta attached '+i,out.messages.find(m=>m.source.clientId===id)?.body,message.content);
   const durable={...message,agentMeta:null,createdAt:stamp(30+((seed+i*7)%25)),rowid:seed*100+i};
   raw=raw.map(m=>m.clientId===id?durable:m);expected[expected.length-1]=durable;
   // DB transport may reorder raw arrivals; display identity already observed.
   raw=[...raw].reverse();out=x.render(raw);check('push before page '+i,out.messages.map(m=>[m.source.clientId,m.body]),expected.map(m=>[m.clientId,m.content]));
   x.box.history=[...expected];x.view.setNetworkAvailable(false);x.view.setNetworkAvailable(true);await x.view.refresh();
   out=x.render(raw,false);check('page takes over once '+i,out.messages.map(m=>[m.source.clientId,m.body]),expected.map(m=>[m.clientId,m.content]));check('no live residue '+i,out.pending,[]);
   raw=[...expected.slice(1)];
  }
 });

 const items=formalItems.map(id=>({id,pass:results.some(x=>x.item===id)&&results.filter(x=>x.item===id).every(x=>x.pass)}));
 return {items,passed:items.filter(x=>x.pass).length,total:items.length,results};
}
