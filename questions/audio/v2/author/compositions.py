import math
import verify as v
def signal(n):return [round(.72*math.sin(i*.17)+.19*math.cos(i*.053),5) for i in range(n)]
def lifecycle(path,pause=False):
 ops=[]
 for epoch in range(5):
  for j,n in enumerate([1,2,17,640,3,129,1,37]):
   ops.append({'type':'input','samples':signal(n) if epoch%2==0 else [-x for x in signal(n)]})
   if j in [1,4,7]:ops += [{'type':'flush','flushId':j},{'type':'flush','flushId':str(j)}]
   if pause and j in [2,5]:ops += [{'type':'setActive','active':False},{'type':'input','samples':[.99]*13},{'type':'input','samples':[]},{'type':'setActive','active':True}]
  ops += [{'type':'input','samples':[.37]*13},{'type':'setActive','active':True,'reset':True} if path=='worklet' else {'type':'reset'}]
 ops += [{'type':'input','samples':[-.42]*53},{'type':'flush','flushId':'final'}]
 return {'path':path,'rate':44100,'chunkMs':20,'operations':ops}
def golden(req):
 source=[];pending=[];emitted=[];produced=0;active=True;frame=max(160,round(req.get("chunkMs",40)*16))
 for op in req['operations']:
  if op['type']=='input' and active:
   source+=op['samples'];full=v.oracle(source,req['rate']);pending+=full[produced:];produced=len(full)
   while len(pending)>=frame:emitted+=pending[:frame];pending=pending[frame:]
  elif op['type']=='flush' and active:emitted+=pending;pending=[]
  elif op['type']=='reset' or op.get('reset'):
   if req['path']=='fallback':emitted+=pending
   source=[];pending=[];produced=0;active=op.get('active',True)
  elif op['type']=='setActive':active=op['active']
 return emitted


def assess(payload):
 import runner
 checks=[]
 for path in ['worklet','fallback']:
  for rate in [8000,16000,44100,48000]:
   for frame in [20,40,100]:
    req=lifecycle(path,path=='worklet');req.update(rate=rate,chunkMs=frame)
    result=runner.invoke(v.CASE,payload,[req],timeout=15)
    if result['status']!='ok':raise RuntimeError(str(result))
    msgs=result['output'][0];actual=[x for m in msgs if m.get('type')=='pcm16k' for x in m['pcm16k']];expected=golden(req)
    frames=[m for m in msgs if m.get('type')=='pcm16k']
    checks.append({'item':'A05','case':f'{path}-{rate}-{frame}-trace-across-epochs','passed':all(m['trace']['chunkIndex']==i and m['trace']['sampleRate']==16000 and abs(m['trace']['durationMs']-len(m['pcm16k'])/16)<1e-8 and 0<len(m['pcm16k'])<=frame*16 for i,m in enumerate(frames))})
    ok=len(actual)==len(expected) and all(abs(a-b)<=1 for a,b in zip(actual,expected))
    checks.append({'item':'A07','case':f'{path}-{rate}-{frame}-epochs','passed':ok,'actualCount':len(actual),'expectedCount':len(expected)})
    if path=='worklet':
     want=[o['flushId'] for o in req['operations'] if o['type']=='flush'];got=[m['flushId'] for m in msgs if m.get('type')=='flushed']
     checks.append({'item':'A06','case':f'{path}-{rate}-{frame}-ack','passed':want==got and list(map(type,want))==list(map(type,got))})
 # Preserve previous long-recording checks as well as new lifecycle compositions.
 import json,hashlib
 from pathlib import Path
 expectedByRate={};hashes={}
 for scene in json.loads(Path(__file__).with_name('long-scenes.json').read_text()):
  req=scene['request'];rate=req['rate'];op=req['operations'][0]
  if rate not in expectedByRate:expectedByRate[rate]=v.oracle(op['samples']*op['repeats'],rate)
  expected=expectedByRate[rate];result=runner.invoke(v.CASE,payload,[req],timeout=20)
  if result['status']!='ok':raise RuntimeError(str(result))
  actual=[x for m in result['output'][0] if m.get('type')=='pcm16k' for x in m['pcm16k']]
  checks.append({'item':'A01','case':scene['id'],'passed':len(actual)==len(expected),'actualCount':len(actual),'expectedCount':len(expected)})
  checks.append({'item':'A02','case':scene['id'],'passed':bool(actual) and all(abs(a-b)<=1 for a,b in zip(actual,expected))})
  key=(req['path'],rate);digest=hashlib.sha256(json.dumps(actual).encode()).hexdigest()
  if key in hashes:checks.append({'item':'A04','case':scene['id'],'passed':hashes[key]==digest})
  else:hashes[key]=digest
 return checks
