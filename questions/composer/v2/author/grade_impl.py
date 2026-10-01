from pathlib import Path
import os,sys,json,subprocess,tempfile,shutil
from fractions import Fraction
Q=Path(__file__).resolve().parent.parent
SPEC=json.loads((Q/'question.json').read_text())
def execute(args,cwd=None,env=None,timeout=180):
 p=subprocess.run([str(x) for x in args],cwd=cwd or Q,env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',**(env or {})),capture_output=True,text=True,timeout=timeout)
 return p

def finish(items,details,status='graded'):
 expected={i for g in SPEC['groups'] for i in g['items']}
 assert set(items)==expected,(set(items)^expected)
 total=sum(Fraction(g['weight'])*(Fraction(sum(items[i] for i in g['items']),len(g['items'])) if g['mode']=='ratio' else int(all(items[i] for i in g['items']))) for g in SPEC['groups'])
 r={'status':status,'scoreExact':str(total) if status=='graded' else None,'score':float(total) if status=='graded' else None,'items':items,'details':details}
 Path(sys.argv[2]).parent.mkdir(parents=True,exist_ok=True);Path(sys.argv[2]).write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k!='details'}))

with tempfile.TemporaryDirectory(prefix='composer-grade-') as td:
 d=Path(td);(d/'logs').mkdir();(d/'tmp').mkdir();node=Q/'candidate/runtime/node';build=Q/'candidate/lab/build.cjs'
 env={'EVAL_OUTPUT_ROOT':str(d),'TMPDIR':str(d/'tmp')}
 for browser in [False,True]:
  p=execute([node,build,Path(sys.argv[1]).resolve(),d/('browser.js' if browser else 'node.cjs')],env=dict(env,LAB_BROWSER='1' if browser else '0'))
  if p.returncode:raise RuntimeError(p.stdout+p.stderr)
 p=execute([sys.executable,'-B',Q/'author/legacy_grade.py',d/'node.cjs',d/'raw.json',d/'browser.js'],env=env,timeout=600)
 if p.returncode:raise RuntimeError(p.stdout+p.stderr)
 r=json.loads((d/'raw.json').read_text());r['executionLogs']={f.name:f.read_text(errors='replace') for f in (d/'logs').iterdir()}
 finish({x['id']:x['passed'] for x in r['items']},r,'graded' if r['valid'] else 'environment_invalid')
