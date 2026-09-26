"""Run scenarios and retain every command, stderr and trace."""
import json, sys
from common import ROOT, PACKAGE, run, write_json
from scoring import score, CONTRACT
bundle, output, browser = map(str,sys.argv[1:4])
commands=[(f'C{n:02}','case.cjs',[f'C{n:02}',bundle]) for n in range(1,17)]
commands += [('C07-hydration','hydration-case.cjs',[bundle]),('C06-permission','browser-case.cjs',['C06-permission',browser]),('C17','browser-case.cjs',['C17',browser])]
commands=[(case,'visible-send-case.cjs',[case,browser]) if case in ('C01','C02') else (case,script,args) for case,script,args in commands]
commands=[(case,'pending-behavior.cjs',[case,browser]) if case in ('C06','C08') else (case,script,args) for case,script,args in commands]
commands=[(case,'recovery-case.cjs',[bundle]) if case=='C04' else (case,script,args) for case,script,args in commands]
commands=[(case,'isolation-case.cjs',[case,bundle]) if case=='C09' else (case,script,args) for case,script,args in commands]
commands += [('X01','composition-case.cjs',[bundle])]
rows=[]
for case,script,args in commands:
    command,stdout,stderr=run([PACKAGE/'candidate/runtime/node',PACKAGE/'author'/script,*args], 'case-'+case,timeout=60 if case=='C09' else 30)
    lines=[line for line in stdout.splitlines() if line.startswith('{"id"')]
    try:
        row=json.loads(lines[-1])
        assert row['id']==case
        assert row.get('status')=='ENVIRONMENT_UNSUPPORTED' or type(row.get('pass')) is bool
    except (IndexError,ValueError,AssertionError):
        row=dict(id=case,status='ENVIRONMENT_UNSUPPORTED',error='Missing or invalid structured scenario result')
    if command['exitCode']!=0:
        row.update(status='ENVIRONMENT_UNSUPPORTED',processError=stderr[-2000:],timeout=command.get('timeout'))
    row.update(stderr=stderr,exitCode=command['exitCode'],command=command)
    rows.append(row)
assert len({r['id'] for r in rows})==len(commands)
byid={r['id']:r for r in rows}
items=[dict(id=i['id'],passed=all(byid[c].get('pass') is True for c in i['scenarios'])) for i in CONTRACT['items']]
required={c for i in CONTRACT['items'] for c in i['scenarios']}
valid=not any(byid[c].get('status')=='ENVIRONMENT_UNSUPPORTED' for c in required)
result=score(dict(valid=valid,items=items,raw=rows))
write_json(output,result)
print(json.dumps({k:v for k,v in result.items() if k not in ('raw','items','groups')}))
for row in rows:
    if not row.get('pass'):print(row['id'],row.get('status','FAIL'),row.get('error'))
