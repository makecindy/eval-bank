"""Behavior scoring v3. New executions of archived source; no inference calls.
Old inputs/oracle/adapter and old scores remain immutable.
"""
import json,sys,math,hashlib,datetime
from pathlib import Path
import runner,verify
ITEMS=[('A01','采样数量与末端边界'),('A02','连续信号插值数值'),('A03','PCM量化与正负削波'),('A04','回调分块不变性'),('A05','帧长、序号与trace'),('A06','排空、续送与回执'),('A07','新一轮录音隔离及stop/reset'),('A08','暂停、恢复与空回调')]
def pcm(msgs):return [v for m in msgs if m.get('type')=='pcm16k' for v in m['pcm16k']]
def values(actual,expected):
 # A01 alone owns length. Compare every aligned, available sample here.
 # Empty output when nonempty expected cannot vacuously pass numeric checks.
 return (not expected or bool(actual)) and all(isinstance(a,(int,float)) and math.isfinite(a) and abs(a-e)<=1 for a,e in zip(actual,expected))
def evaluate(tests,outputs):
 if len(tests)!=len(outputs):raise ValueError('Missing outputs')
 checks={k:[] for k,_ in ITEMS}
 def add(k,name,ok,detail=''):checks[k].append({'case':name,'passed':bool(ok),'detail':detail})
 by={t['name']:(t,m) for t,m in zip(tests,outputs)}
 for t,msgs in zip(tests,outputs):
  name=t['name'];group=t['group'];a=pcm(msgs);e=t['expected'];frames=[m for m in msgs if m.get('type')=='pcm16k']
  if group in ['continuity','clipping','short']:
   add('A01',name,len(a)==len(e),f'{len(a)} vs {len(e)}')
  if group in ['continuity','short'] and e:add('A02',name,values(a,e),'Aligned available samples only; count owned by A01')
  if group=='clipping':add('A03',name,values(a,e) and all(-32768<=v<=32767 for v in a))
  if group in ['continuity','clipping'] and name.endswith('-[128]'):
   other=by[name.removesuffix('-[128]')+'-[1, 127, 2, 63, 257]'][1]
   add('A04',name,a==pcm(other),'Same source signal under two callback layouts')
  if group=='framing':
   ok=bool(frames)
   for i,m in enumerate(frames):
    tr=m['trace'];n=len(m['pcm16k']);ok=ok and tr['chunkIndex']==i and tr['sampleRate']==16000 and abs(tr['durationMs']-n/16)<1e-8 and math.isfinite(tr['capturedAt']) and math.isfinite(tr['convertedAt']) and 0<n<=t['size']
   ok=ok and all(len(m['pcm16k'])==t['size'] for m in frames[:-1]) and len(frames[0]['pcm16k'])==t['size']
   add('A05',name,ok)
  if group=='drain':
   # Compare with same candidate and same input callbacks, without intermediate drains.
   other=by[name+'/undrained-control'][1]
   ok=a==pcm(other)
   if t['request']['path']=='worklet':
    acks=[m['flushId'] for m in msgs if m.get('type')=='flushed'];ok=ok and acks==t['acks'] and list(map(type,acks))==list(map(type,t['acks']))
    for idx,op in enumerate(t['request']['operations']):
     if op['type']=='flush':
      emitted=[m for m in msgs if m['__operation']==idx];ok=ok and bool(emitted) and emitted[-1]['type']=='flushed'
   add('A06',name,ok)
  if group=='short' and not e and t['request']['path']=='worklet':
   acks=[m['flushId'] for m in msgs if m.get('type')=='flushed'];add('A06',name+'/empty-ack',acks==t['acks'] and list(map(type,acks))==list(map(type,t['acks'])))
  if group=='lifecycle':
   add('A08' if 'pause-empty' in name else 'A07',name,len(a)==len(e) and values(a,e))
 rows=[{'id':k,'name':n,'passed':all(t['passed'] for t in checks[k]),'subchecks':checks[k]} for k,n in ITEMS]
 assert all(x['subchecks'] for x in rows)
 return {'version':'audio-behavior-v3','passed':sum(x['passed'] for x in rows),'total':len(rows),'items':rows,'score':100*sum(x['passed'] for x in rows)/len(rows)}
def build():
 tests=verify.build()
 for t in list(tests):
  if t['group']=='drain':
   c=json.loads(json.dumps(t));c['name']+='/undrained-control';c['group']='control';c['request']['operations']=[x for x in t['request']['operations'] if x['type']!='flush']+[{'type':'flush','flushId':'end'}];tests.append(c)
 return tests
