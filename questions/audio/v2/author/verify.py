import json,math,random,struct,hashlib
from pathlib import Path
import runner
ROOT=runner.ROOT
CASE={'id':'A001','kind':'audio','file':'candidate.json'}
def oracle(samples,rate):
    a=[struct.unpack('f',struct.pack('f',x))[0] for x in samples];out=[];k=0
    while k*rate/16000 < (len(a) if rate==16000 else len(a)-1):
        x=k*rate/16000;l=math.floor(x);v=max(-1,min(1,a[l]+(a[min(l+1,len(a)-1)]-a[l])*(x-l)))
        out.append(math.trunc(v*(32768 if v<0 else 32767)));k+=1
    return out
def feed(a,sizes):
    ops=[];i=0;n=0
    while i<len(a):
        step=sizes[n%len(sizes)];ops.append({'type':'input','samples':a[i:i+step]});i+=step;n+=1
    return ops
def build():
    tests=[]
    def add(path,name,group,rate,samples,sizes,chunk=40,ops=None,start=0,acks=None):
        operations=ops if ops is not None else feed(samples,sizes)+[{'type':'flush','flushId':'end'}]
        request={'path':path,'rate':rate,'operations':operations}
        if chunk is not None:request['chunkMs']=chunk
        tests.append({'name':path+'/'+name,'group':group,'request':request,'expected':oracle(samples,rate),'start':start,'size':max(160,round(16*(chunk if chunk is not None else 40 if path=='worklet' else 100))),'acks':acks if acks is not None else ['end']})
    for path in ['worklet','fallback']:
        for rate in [8000,16000,32000,44100,48000]:
            for sig in ['constant','wave','clipped']:
                a=[.375 if sig=='constant' else .7*math.sin(i*.073) if sig=='wave' else [1.25,-1.25,0,.00001,-.00001,1,-1][i%7] for i in range(1025)]
                for sizes in [[128],[1,127,2,63,257]]:add(path,f'{sig}-{rate}-{sizes}','clipping' if sig=='clipped' else 'continuity',rate,a,sizes)
            for n in [0,1,2,3,41]:add(path,f'short-{rate}-{n}','short',rate,[.375]*n,[1])
        for chunk in [None,20,100]:add(path,'frame-'+str(chunk),'framing',48000,[.25]*6000,[127,256],chunk)
        a=[.65*math.sin(i*.12) for i in range(2049)]
        ops=feed(a[:333],[127,1])+[{'type':'flush','flushId':17},{'type':'flush','flushId':'17'}]+feed(a[333:],[1,128])+[{'type':'flush','flushId':'end'},{'type':'flush','flushId':0}]
        add(path,'drain-and-continue','drain',44100,a,[1],ops=ops,acks=[17,'17','end',0])
        old=[.75]*4096;new=[-.25]*1025;size=640
        reset={'type':'setActive','active':True,'reset':True} if path=='worklet' else {'type':'reset'}
        start=len(oracle(old,44100))//size if path=='worklet' else math.ceil(len(oracle(old,44100))/size)
        ops=feed(old,[128])+[reset]+feed(new,[1,127])+[{'type':'flush','flushId':'end'}]
        add(path,'new-recording','lifecycle',44100,new,[128],ops=ops)
        prior=oracle(old,44100)
        tests[-1]['expected']=(prior[:start*size] if path=='worklet' else prior)+oracle(new,44100)
    path='worklet';a=[.35]*1025
    ops=feed(a[:333],[128])+[{'type':'input','samples':[]},{'type':'setActive','active':False},{'type':'input','samples':[-.9]*199},{'type':'setActive','active':True}]+feed(a[333:],[1,127])+[{'type':'flush','flushId':'end'}]
    add(path,'pause-empty-resume','lifecycle',44100,a,[128],ops=ops)
    return tests
def grade(case,source):
    tests=build();trial=runner.invoke(CASE,source,[t['request'] for t in tests])
    if trial['status']!='ok':return {'status':'execution_error','execution':trial,'task_pass':False}
    if len(trial['output'])!=len(tests):return {'status':'invalid_output','task_pass':False}
    checks=[]
    for t,msgs in zip(tests,trial['output']):
        try:
            frames=[m for m in msgs if m['type']=='pcm16k'];pcm=[v for m in frames for v in m['pcm16k']]
            assert len(pcm)==len(t['expected']),f"sample count {len(pcm)} != {len(t['expected'])}"
            bad=sum(abs(x-y)>1 for x,y in zip(pcm,t['expected']));assert not bad,f'{bad} wrong PCM samples'
            for i,m in enumerate(frames):
                tr=m['trace'];assert tr['chunkIndex']==t['start']+i,'frame index discontinuity'
                assert tr['sampleRate']==16000 and abs(tr['durationMs']-len(m['pcm16k'])/16)<1e-8,'trace mismatch'
                assert math.isfinite(tr['capturedAt']) and math.isfinite(tr['convertedAt']),'invalid time'
                assert 0<len(m['pcm16k'])<=t['size'],'invalid frame length'
            if t['group'] not in ['drain','lifecycle']:
                assert all(len(m['pcm16k'])==t['size'] for m in frames[:-1]),'undersized nonfinal frame'
            if t['group']=='framing':assert frames[0]['trace']['durationMs']==t['size']/16,'configured/default frame not preserved'
            if t['request']['path']=='worklet':
                got=[m['flushId'] for m in msgs if m['type']=='flushed'];assert got==t['acks'] and [type(x) for x in got]==[type(x) for x in t['acks']],'flush ACK mismatch'
                assert msgs[-1]['type']=='flushed','flush must ACK after audio'
                for idx,op in enumerate(t['request']['operations']):
                    if op['type']=='flush':
                        emitted=[m for m in msgs if m['__operation']==idx]
                        assert emitted and emitted[-1]['type']=='flushed','intermediate flush ACK precedes tail'
            checks.append({'name':t['name'],'group':t['group'],'pass':True})
        except (AssertionError,KeyError,TypeError,ValueError) as e:checks.append({'name':t['name'],'group':t['group'],'pass':False,'reason':str(e)})
    groups={g:all(c['pass'] for c in checks if c['group']==g) for g in sorted(set(c['group'] for c in checks))}
    return {'status':'graded','task_pass':all(groups.values()),'groups':groups,'passed':sum(c['pass'] for c in checks),'total':len(checks),'checks':checks,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
if __name__=='__main__':
    runner.verify_runtime();results={}
    for label in ['base','reference']:
        results[label]=grade(CASE,ROOT/'private'/f'{label}.json')
        print(label,{k:v for k,v in results[label].items() if k!='checks'},flush=True)
    (ROOT/'private/validation.json').write_text(json.dumps(results,indent=2))
