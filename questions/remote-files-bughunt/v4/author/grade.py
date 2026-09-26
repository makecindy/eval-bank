"""Trusted submission gate: runtime/infrastructure changes never earn behavior points."""
from pathlib import Path
import sys,json,filecmp,subprocess,os
Q=Path(__file__).resolve().parent.parent
root=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve()
allowed=json.loads((Q/'author/editable.json').read_text())
def editable(rel):
 return any(rel==p or p.endswith('/') and rel.startswith(p) for p in allowed) and '/__tests__/' not in '/'+rel and '.test.' not in rel
errors=[]
if not root.is_dir():errors.append('source root missing')
else:
 for base in (Q/'candidate').rglob('*'):
  if not base.is_file():continue
  rel=base.relative_to(Q/'candidate').as_posix()
  if editable(rel):continue
  if rel.startswith(('tests/lab-build/','tests/environment-preflight/','.build/','.work/')) or rel in ('tests/environment-edit-probe.txt','tests/environment-probe.txt','tests/preflight.json'):continue
  other=root/rel
  if not other.is_file() or other.is_symlink() or not filecmp.cmp(base,other,shallow=False):errors.append(rel)
if errors:
 result={'status':'environment_invalid','reason':'submission changed protected inputs or package incomplete','score':None,'files':errors}
else:
 try:
  p=subprocess.run([sys.executable,'-B',str(Q/'author/grade_impl.py'),str(root),str(output)],env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'),capture_output=True,text=True,timeout=900)
  if p.returncode or not output.exists():result={'status':'environment_invalid','score':None,'reason':'grader could not complete; manual classification required','stdout':p.stdout[-4000:],'stderr':p.stderr[-4000:]}
  else:
   result=json.loads(output.read_text());result['submissionGate']='passed'
 except subprocess.TimeoutExpired:result={'status':'environment_invalid','score':None,'reason':'grader safety timeout; manual classification required'}
spec=json.loads((Q/'question.json').read_text());result.update(questionId=spec['id'],revision=spec['revision'],scoringVersion=spec['scoringVersion'])
output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['details','raw','executionLogs']},ensure_ascii=False))
