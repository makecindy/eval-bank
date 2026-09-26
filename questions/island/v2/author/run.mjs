import {createDesktop} from '../candidate/lab/host.mjs';
const root=process.argv[2];
if(!root)throw Error('candidate root required');
const tests=[];
const eq=(a,b)=>{if(a!==b)throw Error(`got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);};
const setup=(running=false)=>{const d=createDesktop({root,now:900,readyAt:80000});d.act({type:running?'running':'complete',id:'a',at:1000});if(running)d.act({type:'expand'});d.act({type:'advance',at:1100});eq(d.inspect().display.mode,'expanded');return d;};
const mode=d=>d.inspect().display.mode;
const act=(d,type,at,id='a',extra={})=>d.act({type,at,id,...extra});
function test(group,name,fn){try{fn();tests.push({group,name,pass:true});}catch(e){tests.push({group,name,pass:false,error:e.message});}}
test('immediate','early notification click',()=>{const d=setup();act(d,'click',1200);eq(mode(d),'compact');});
test('immediate','notification click after minimum dwell',()=>{const d=setup();act(d,'click',2400);eq(mode(d),'compact');});
test('unread','no navigation acknowledgement preserves unread',()=>{const d=setup();act(d,'click',1200);act(d,'advance',62000);eq(mode(d),'compact');eq(d.inspect().sessions.find(s=>s.id==='a').unread,true);});
test('unread','explicit read acknowledgement clears unread',()=>{const d=setup();act(d,'click',1200);act(d,'focused',1500,'a',{value:true});act(d,'route',1600);act(d,'read',1700);eq(d.inspect().display.pillSnapshot.unreadCompletedCount,0);});
test('stack','click does not rotate another previous notification',()=>{const d=setup();act(d,'complete',1150,'b');act(d,'click',1200,'b');for(const t of [1201,2000,10000]){act(d,'advance',t);eq(mode(d),'compact');}eq(d.inspect().sessions.every(s=>s.unread),true);});
test('stack','remaining pointer does not re-open',()=>{const d=setup();act(d,'pointer',1150,'a',{panel:true});act(d,'click',1200);act(d,'pointer',1210,'a',{menuBar:true});act(d,'advance',2000);eq(mode(d),'compact');});
test('late_ack','old route must preserve subsequent manual expansion',()=>{const d=setup();act(d,'click',1200);act(d,'expand',2200);eq(mode(d),'expanded');act(d,'route',3200);eq(mode(d),'expanded');});
test('late_ack','old route must preserve newer same-task error',()=>{const d=setup();act(d,'click',1200);act(d,'running',2000);act(d,'error',2100);eq(mode(d),'expanded');act(d,'route',3200);eq(mode(d),'expanded');});
test('regression','empty click remains a no-op',()=>{const d=setup();act(d,'click',1200,' ');eq(mode(d),'expanded');eq(d.trace.filter(t=>t.kind==='window.open').length,0);});
test('regression','running-row navigation retains current behavior',()=>{const d=setup(true);act(d,'click',1200);eq(mode(d),'expanded');act(d,'route',1250);eq(mode(d),'compact');});
test('regression','outside-click minimum dwell remains unchanged',()=>{const d=setup();act(d,'outside',1500);eq(mode(d),'expanded');});
test('service','published snapshot at navigation handoff is compact',()=>{const d=setup();act(d,'click',1200);const opens=d.trace.filter(t=>t.kind==='window.open');eq(opens.length,1);eq(opens[0].sessionId,'a');eq(opens[0].display,'compact');});

test('composition','stack manual navigation and newer error',()=>{
 const d=setup();act(d,'complete',1150,'b');act(d,'pointer',1160,'a',{panel:true});
 act(d,'click',1200,'a');eq(mode(d),'compact');
 act(d,'expand',2000);act(d,'route',2100,'a');eq(mode(d),'expanded');
 act(d,'running',2200,'a');act(d,'error',2300,'a');act(d,'route',2400,'a');eq(mode(d),'expanded');
 act(d,'click',2500,'a');eq(mode(d),'compact');act(d,'advance',8000);eq(mode(d),'compact');
 eq(d.inspect().sessions.find(s=>s.id==='b').unread,true);
 for(const o of d.trace.filter(t=>t.kind==='window.open'))eq(o.display,'compact');
});
test('composition','two notification actions and stale route keep new reveal',()=>{
 const d=setup();act(d,'click',1200,'a');act(d,'complete',2000,'b');eq(mode(d),'expanded');
 act(d,'route',2100,'a');eq(mode(d),'expanded');act(d,'outside',2200,'b');eq(mode(d),'expanded');
 act(d,'click',2300,'b');eq(mode(d),'compact');act(d,'route',2400,'b');
 eq(d.inspect().sessions.find(s=>s.id==='a').unread,true);eq(d.inspect().sessions.find(s=>s.id==='b').unread,true);
});

const groups=Object.fromEntries([...new Set(tests.map(t=>t.group))].map(g=>[g,tests.filter(t=>t.group===g).every(t=>t.pass)]));
console.log(JSON.stringify({version:6,passed:tests.filter(t=>t.pass).length,total:tests.length,task_pass:tests.every(t=>t.pass),groups,tests},null,2));
