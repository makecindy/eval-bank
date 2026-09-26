import pathlib,shutil,tempfile,subprocess,json,sys,re
HERE=pathlib.Path(__file__).resolve().parent
IDS=[f'V{i:02}{s}' for i in range(1,8) for s in ['core','edge','guard']]+[f'R{i:02}' for i in range(1,5)]
CHAT='src/apps/desktop/src/renderer/components/chat/'
def grade(root,selected=None):
 root=pathlib.Path(root).resolve(); outputs=[]
 with tempfile.TemporaryDirectory(prefix='d02-grade-') as td:
  dst=pathlib.Path(td);shutil.copytree(root/'src',dst/'src')
  # Trusted runtime and package; never execute candidate-added scripts/tests in grader.
  (dst/'runtime').symlink_to(HERE.parent/'reference/runtime',target_is_directory=True)
  shutil.copy2(HERE.parent/'reference/package.json',dst/'package.json')
  for rel,name,counter in [(CHAT+'MessageStream.js','buildRenderItems','projection'),('src/apps/desktop/src/renderer/lib/generatedFiles.js','collectGeneratedFiles','files'),(CHAT+'markdownImageTargets.js','extractRenderedMarkdownImageTargets','markdown')]:
   f=dst/rel;s=f.read_text();s,n=re.subn(r'(function\s+'+name+r'\s*\([^)]*\)\s*\{)',r'\1\n globalThis.__counts.'+counter+'++;'+(' globalThis.__projectionCalls++;' if counter=='projection' else ''),s);assert n==1,'OBSERVABILITY: adapt instrumentation for equivalent implementation';f.write_text(s)
  for case in selected or IDS+[f'D{i:02}{s}' for i in range(1,8) for s in ['a','b']]:
   try:
    p=subprocess.run([str(HERE.parent/'reference/runtime/node'),str(HERE/('legacy-scenarios.mjs' if case.startswith('D') else 'scenarios.mjs')),str(dst),case],capture_output=True,text=True,timeout=45)
    try:o=json.loads(p.stdout.strip().splitlines()[-1])
    except:o={'id':case,'pass':False,'environment_invalid':True,'error':p.stderr[-2500:]}
   except subprocess.TimeoutExpired:o={'id':case,'pass':False,'timeout':True}
   if 'OBSERVABILITY:' in o.get('error','') or 'AUTHOR:' in o.get('error',''):o['environment_invalid']=True
   outputs.append(o)

 raw={o['id']:o['pass'] for o in outputs}
 caps=json.loads((HERE/'capability-map.json').read_text())
 items={g+'-'+k:all(raw.get(i,False) for i in ids) for g,c in caps.items() for k,ids in c.items()}
 groups={g:sum(items[g+'-'+k] for k in c)/len(c) for g,c in caps.items()}
 invalid=any(o.get('environment_invalid') for o in outputs)
 return {'question':'task-switch-cache','version':'v3','status':'environment_invalid' if invalid else 'graded','score':None if invalid else sum(groups.values())/6,'items':items,'groupFractions':groups,'rawChecks':raw,'details':outputs}
if __name__=='__main__':
 try:result=grade(sys.argv[1])
 except Exception as e:result={'status':'environment_invalid','score':None,'error':str(e)}
 pathlib.Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2))
 print(json.dumps({'status':result['status'],'score':result['score'],'failed':[o['id']+': '+o.get('error','') for o in result.get('details',[]) if not o['pass']]},ensure_ascii=False))
