from pathlib import Path
import json,subprocess,tempfile,shutil,sys,os
HERE=Path(__file__).resolve().parent;Q=HERE.parent
NEW=[f'V{i:02}{part}' for i in range(1,5) for part in ['core','edge','guard']]
OLD=['B01','B02','B03','B04','B05','B06','B03b','R01','R03']
def grade(root):
 rows=[]
 with tempfile.TemporaryDirectory(prefix='remote-grade-') as td:
  d=Path(td);shutil.copytree(Path(root)/'src',d/'src')
  shutil.copytree(Q/'reference/runtime',d/'runtime');shutil.copy2(Q/'reference/package.json',d/'package.json')
  env=dict(os.environ,TMPDIR=str(d))
  for ident in NEW+OLD:
   try:
    r=subprocess.run([str(Q/'candidate/runtime/node'),'--experimental-strip-types',str(HERE/('checks.mjs' if ident in NEW else 'legacy-checks.mjs')),str(d),ident],env=env,capture_output=True,text=True,timeout=15)
    try:row=json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:row={'id':ident,'pass':False,'environment_invalid':True,'error':r.stderr[-2000:]}
    row['exitCode']=r.returncode
   except subprocess.TimeoutExpired:row={'id':ident,'pass':False,'error':'behavior did not settle before safety timeout','timeout':True}
   rows.append(row)
 raw={r['id']:r['pass'] for r in rows};items={k:raw[k] for k in NEW}
 fractions={f'B{i:02}':float(raw[f'B{i:02}'] and (raw['B03b'] if i==3 else True)) for i in range(1,7)}
 items.update({k:raw[k] for k in OLD if k.startswith('B')})
 fractions.update({f'V{i:02}':(0.5+0.25*items[f'V{i:02}edge']+0.25*items[f'V{i:02}guard']) if items[f'V{i:02}core'] else 0 for i in range(1,5)})
 invalid=any(r.get('environment_invalid') for r in rows)
 return {'status':'environment_invalid' if invalid else 'graded','score':None if invalid else sum(fractions.values())/10,'groupFractions':fractions,'items':items,'regressions':{k:raw[k] for k in OLD},'details':rows}
if __name__=='__main__':
 try:r=grade(sys.argv[1])
 except Exception as e:r={'status':'environment_invalid','score':None,'error':str(e)}
 Path(sys.argv[2]).write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps(r,ensure_ascii=False))
