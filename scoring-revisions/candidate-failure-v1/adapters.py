"""Narrow, checked transformations of frozen author adapters (never old files).

Every replacement must match once. Unknown author/process failures deliberately
keep the original unscored path. Candidate exceptions are caught at call sites,
not classified by messages printed by the candidate.
"""
import json


def replace(root, rel, before, after):
    path = root / rel
    text = path.read_text(encoding="utf-8")
    if text.count(before) != 1:
        raise ValueError("Frozen adapter anchor mismatch: " + rel)
    path.write_text(text.replace(before, after), encoding="utf-8")


def apply(root, ident):
    # Reject appended JSON, mismatched cases and abnormal checker exits.
    # Candidate and checker still share a process: this is not an authenticated
    # evidence channel and does not establish adversarial grading isolation.
    if ident in ("remote-files-bughunt", "task-switch-cache"):
        proc, row, case = ("r", "row", "ident") if ident == "remote-files-bughunt" else ("p", "o", "case")
        replace(root, "author/grade_impl.py",
                f"    try:{row}=json.loads({proc}.stdout.strip().splitlines()[-1])",
                f"""    try:
     {row}=json.loads({proc}.stdout)
     if not isinstance({row},dict) or {row}.get('id')!={case} or type({row}.get('pass')) is not bool:raise ValueError('Invalid checker evidence')
     if {proc}.returncode not in (0,1) or ({proc}.returncode==1 and {row}['pass'] is not False):raise ValueError('Checker exit contradicts evidence')""")
        # An outer watchdog cannot distinguish candidate hangs from checker or
        # infrastructure hangs. Keep this separate from reviewed inner deadlines.
        replace(root, "author/grade_impl.py",
                f"except subprocess.TimeoutExpired:{row}={{'id':{case},'pass':False,",
                f"except subprocess.TimeoutExpired:{row}={{'id':{case},'pass':False,'environment_invalid':True,'failureCategory':'unclassified_timeout',")
    if ident == "mobile-stream-order":
        replace(root, "author/run.mjs",
                "const [source,bundle,out]=process.argv.slice(2);await build(source,bundle);\nconst api=await import(pathToFileURL(bundle));fs.writeFileSync(out,JSON.stringify(await assess(api)));",
                """const [source,bundle,out]=process.argv.slice(2);
function fail(stage) {
 const spec=JSON.parse(fs.readFileSync(new URL('../question.json',import.meta.url),'utf8'));
 fs.writeFileSync(out,JSON.stringify({items:[...new Set(spec.groups.flatMap(g=>g.items))].map(id=>({id,pass:false})),failureCategory:stage}));
}
let built=false;
try {await build(source,bundle);built=true;}
catch(e) {
 // esbuild diagnostics identify compilation; service/IO/config failures don't.
 if(!Array.isArray(e.errors)||!e.errors.length||e.errors.some(x=>!x.location)) throw e;
 fail('candidate_build');
}
if(built) {
 let api;
 try {api=await import(pathToFileURL(bundle));}
 catch(e) {fail('candidate_load');}
 if(api) fs.writeFileSync(out,JSON.stringify(await assess(api)));
}""")
    elif ident == "composer":
        replace(root, "candidate/lab/build.cjs",
                ".catch(e=>{console.log(e.errors?.map(x=>x.text+' @ '+x.location?.file+':'+x.location?.line).join('\\n')||e);process.exitCode=1});",
                ".catch(e=>{if(Array.isArray(e.errors)&&e.errors.length&&e.errors.every(x=>x.location))fs.writeFileSync(process.argv[3]+'.candidate-error.json',JSON.stringify({stage:'candidate_build'}));console.error(e);process.exitCode=1});")
        replace(root, "author/grade_impl.py",
                "  if p.returncode:raise RuntimeError(p.stdout+p.stderr)",
                "  if p.returncode and not (d/(('browser.js' if browser else 'node.cjs')+'.candidate-error.json')).exists():raise RuntimeError(p.stdout+p.stderr)")
        replace(root, "author/legacy_grade.py",
                "    command,stdout,stderr=run([PACKAGE/'candidate/runtime/node',PACKAGE/'author'/script,*args], 'case-'+case,timeout=60 if case=='C09' else 30)",
                """    from pathlib import Path
    unavailable=[arg for arg in args if arg in (bundle,browser) and Path(arg+'.candidate-error.json').exists()]
    if unavailable:
        rows.append(dict(id=case,**{'pass':False},failureCategory='candidate_build'))
        continue
    command,stdout,stderr=run([PACKAGE/'candidate/runtime/node',PACKAGE/'author'/script,*args], 'case-'+case,timeout=60 if case=='C09' else 30)""")
        (root / "candidate/lab/candidate-failure.cjs").write_text("""const marked=new WeakSet();
exports.mark=e=>{const wrapped=new Error('Candidate code failed');wrapped.cause=e;marked.add(wrapped);return wrapped};
exports.isCandidate=e=>marked.has(e);
exports.row=(id,e)=>exports.isCandidate(e)?{id,pass:false,failureCategory:'candidate_load'}:{id,status:'ENVIRONMENT_UNSUPPORTED',error:String(e)};
""", encoding="utf-8")
        replace(root, "candidate/lab/host.cjs", "=require(modulePath);", "=(()=>{try{return require(modulePath)}catch(e){throw require('./candidate-failure.cjs').mark(e)}})();")
        replace(root, "candidate/lab/browser-driver.cjs",
                "page.on('pageerror',e=>errors.push(String(e)));",
                "const candidateErrors=[];page.on('pageerror',e=>{errors.push(String(e));if(e.stack?.split('\\n').find(s=>s.trim().startsWith('at '))?.includes(origin+'/module.js:'))candidateErrors.push(e)});const checkErrors=()=>{if(!errors.length)return;if(candidateErrors.length===errors.length)throw require('./candidate-failure.cjs').mark(candidateErrors[0]);throw Error('ENVIRONMENT_UNSUPPORTED '+errors.join('\\n'))};")
        replace(root, "candidate/lab/browser-driver.cjs",
                "await page.goto(origin);await page.evaluate",
                "await page.goto(origin);checkErrors();await page.evaluate")
        replace(root, "candidate/lab/browser-driver.cjs",
                "if(errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+errors.join('\\n'));",
                "checkErrors();")
        replace(root, "candidate/lab/browser-driver.cjs", "return {page,run,errors,version:", "return {page,run,errors,checkErrors,version:")
        replace(root, "author/pending-behavior.cjs",
                "if(h.errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+h.errors.join('\\n'));", "h.checkErrors();")
        for name, candidate_source in [("host.cjs", "modulePath"), ("browser-host.js", "'/module.js:'")]:
            rel = "candidate/lab/" + name
            path = root / rel
            text = path.read_text(encoding="utf-8")
            text = text.replace("lab.errors.push(String(e.error))", "lab.errors.push(e.error)")
            before = "if(unsupported.size||lab.errors.length)throw Error('ENVIRONMENT_UNSUPPORTED '+JSON.stringify([...unsupported,...lab.errors]));"
            after = f"""if(unsupported.size)throw Error('ENVIRONMENT_UNSUPPORTED '+JSON.stringify([...unsupported]));
  if(lab.errors.length){{
   const candidate=lab.errors.every(e=>e?.stack?.split('\\n').find(s=>s.trim().startsWith('at '))?.includes({candidate_source}));
   if(candidate)throw Error('Candidate execution failed');
   throw Error('ENVIRONMENT_UNSUPPORTED: unclassified host event error');
  }}"""
            if text.count(before) != 1:
                raise ValueError("Missing composer runtime error boundary")
            text = text.replace(before, after)
            before_act = "const act=async(fn)=>{await React.act(async()=>{await fn();});await flush();};"
            after_act = f"""const act=async(fn)=>{{try{{await React.act(async()=>{{await fn();}});await flush();}}catch(e){{
 if(!unsupported.size&&e?.stack?.split('\\n').find(s=>s.trim().startsWith('at '))?.includes({candidate_source}))throw Error('Candidate execution failed');
 throw e;
 }}}};"""
            if text.count(before_act) != 1:
                raise ValueError("Missing composer act boundary")
            path.write_text(text.replace(before_act, after_act), encoding="utf-8")
        for name in ("case.cjs", "browser-case.cjs", "composition-case.cjs", "hydration-case.cjs",
                     "recovery-case.cjs", "visible-send-case.cjs", "pending-behavior.cjs", "isolation-case.cjs"):
            path = root / "author" / name
            text = path.read_text(encoding="utf-8")
            text = "const candidateFailure=require('../candidate/lab/candidate-failure.cjs');\n" + text
            # Only outer structured error exits, not internal author assertions.
            fixed_id = {"composition-case.cjs": "X01", "hydration-case.cjs": "C07-hydration",
                        "recovery-case.cjs": "C04", "isolation-case.cjs": "C09"}.get(name)
            label = repr(fixed_id) if fixed_id else "id"
            field = "id:" + label if fixed_id else "id"
            before = "{" + field + ",status:'ENVIRONMENT_UNSUPPORTED',error:String(e)}"
            if text.count(before) != 1:
                raise ValueError("Missing outer candidate load boundary: " + name)
            text = text.replace(before, f"candidateFailure.row({label},e)")
            text = text.replace("process.exitCode=2", "process.exitCode=candidateFailure.isCandidate(e)?0:2")
            text = text.replace("process.exit(2)", "process.exit(candidateFailure.isCandidate(e)?0:2)")
            if name == "isolation-case.cjs":
                # Branch protocol has a different discriminator than parent C09.
                text = text.replace("candidateFailure.row('C09',e)", "(process.argv[2]!=='C09'&&candidateFailure.isCandidate(e)?{branch:process.argv[2],pass:false,failureCategory:'candidate_load'}:candidateFailure.row('C09',e))")
            path.write_text(text, encoding="utf-8")
    elif ident == "recovery":
        replace(root, "author/run.cjs",
                "if (!validation.valid) {",
                """if (!validation.valid && validation.errors.length && validation.errors.every(e=>Number.isInteger(e.code))) {
    // The protected submission gate already checked non-editable inputs.
    const rows=cases.map(([id,group,description])=>({id,group,description,status:'failed',failureCategory:'candidate_build'}));
    fs.writeFileSync(output,JSON.stringify({status:'graded',rows,validation}));return;
    } if (!validation.valid) {""")
        replace(root, "author/run.cjs",
                "environmentError || e.message.includes('ENVIRONMENT_') ?",
                "environmentError || require('../candidate/lab/host.cjs').isEnvironmentFailure(e) ?")
        host = root / "candidate/lab/host.cjs"
        text = host.read_text(encoding="utf-8")
        for before in ("Error('ENVIRONMENT_UNSUPPORTED: missing boundary policy')",
                       "new Error('ENVIRONMENT_UNSUPPORTED: ' + name)",
                       "Error('ENVIRONMENT_UNSETTLED: event loop did not quiesce')"):
            if text.count(before) != 1:
                raise ValueError("Missing recovery environment boundary")
            text = text.replace(before, before.replace("new Error(", "environmentFailure(").replace("Error(", "environmentFailure("))
        text = "const environmentFailures=new WeakSet();function environmentFailure(message){const e=new Error(message);environmentFailures.add(e);return e}\n" + text
        text += "\nmodule.exports.isEnvironmentFailure=e=>environmentFailures.has(e);\n"
        host.write_text(text, encoding="utf-8")
    elif ident in ("remote-files-bughunt", "task-switch-cache"):
        if ident == "remote-files-bughunt":
            for name, param in [("checks.mjs", "p"), ("legacy-checks.mjs", "f")]:
                rel = "author/" + name
                case = "caseId" if name == "checks.mjs" else "id"
                replace(root, rel, f"const load={param}=>import(pathToFileURL(path.join(root,{param})));",
                        f"""const load=async {param}=>{{
 try {{return await import(pathToFileURL(path.join(root,{param})));}}
 catch(e) {{
  if(!{param}.startsWith('src/')) throw e;
  process.stdout.write(JSON.stringify({{id:{case},pass:false,failureCategory:'candidate_load'}})+'\\n');
  process.exit(0);
 }}
}};""")
        else:
            for name in ("scenarios.mjs", "legacy-scenarios.mjs"):
                rel = "author/" + name
                path = root / rel
                text = path.read_text(encoding="utf-8")
                anchor = "globalThis.__projectionCalls=0;globalThis.__counts={projection:0,files:0,markdown:0};"
                helper = """
async function candidateImport(value) {
 try {return await import(value);}
 catch(e) {
  process.stdout.write(JSON.stringify({id,pass:false,failureCategory:'candidate_load'})+'\\n');
  process.exit(0);
 }
}
"""
                replace(root, rel, anchor, anchor + helper)
                text = path.read_text(encoding="utf-8")
                # Only source imports; the trusted reference stays outside catch.
                if "await import(url(" not in text:
                    raise ValueError("Missing candidate import boundary")
                path.write_text(text.replace("await import(url(", "await candidateImport(url("), encoding="utf-8")
    elif ident == "audio":
        # Only absent editable files are candidate load failures. Protected
        # inputs, permissions and other filesystem errors remain author/IO errors.
        replace(root, "author/grade_impl.py", "import runner,verify,behavior", """def read_candidate_source(source,name):
 try:return (source/name).read_text()
 except FileNotFoundError:
  if name not in ('WebMicAudioEngine.ts','pcm16k-worklet.js'):raise
  return None

import runner,verify,behavior""")
        replace(root, "author/grade_impl.py", "(source/f).read_text()", "read_candidate_source(source,f)")
        # VM exceptions are attached to individual requests. The author oracle
        # remains outside this catch; adapter/setup/process errors stay unscored.
        replace(root, "author/adapter.mjs", "  let instance;", "  let instance;\n  try {")
        replace(root, "author/adapter.mjs", "  if(test.path==='worklet'){",
                "  if(typeof sources[test.path==='worklet'?'pcm16k-worklet.js':'WebMicAudioEngine.ts']!=='string')throw Error('Candidate source missing');\n  if(test.path==='worklet'){")
        replace(root, "author/adapter.mjs", "  results.push(messages.map",
                "  } catch(e) {results.push({candidateFailure:true});continue;}\n  results.push(messages.map")
        replace(root, "author/behavior.py", " checks={k:[] for k,_ in ITEMS}",
                """ failed=[t for t,out in zip(tests,outputs) if isinstance(out,dict) and out.get('candidateFailure') is True]
 outputs=[[] if isinstance(out,dict) and out.get('candidateFailure') is True else out for out in outputs]
 checks={k:[] for k,_ in ITEMS}""")
        replace(root, "author/behavior.py", " rows=[{'id':k,'name':n,", """ for t in failed:
  group=t['group']
  affected={'continuity':['A01','A02','A04'],'clipping':['A01','A03','A04'],
            'short':['A01','A02','A06'],'framing':['A05'],'drain':['A06'],
            'control':['A06'],'lifecycle':['A08' if 'pause-empty' in t['name'] else 'A07']}[group]
  for item in affected:add(item,t['name'],False,'candidate execution failed')
 rows=[{'id':k,'name':n,""")
        replace(root, "author/compositions.py", "    msgs=result['output'][0];actual=", """    if isinstance(result['output'][0],dict) and result['output'][0].get('candidateFailure'):
     checks.extend({'item':item,'case':f'{path}-{rate}-{frame}','passed':False,'failureCategory':'candidate_execution'} for item in (['A05','A07','A06'] if path=='worklet' else ['A05','A07']))
     continue
    msgs=result['output'][0];actual=""")
        replace(root, "author/compositions.py", "  actual=[x for m in result['output'][0]", """  if isinstance(result['output'][0],dict) and result['output'][0].get('candidateFailure'):
   checks.extend({'item':item,'case':scene['id'],'passed':False,'failureCategory':'candidate_execution'} for item in ['A01','A02','A04'])
   continue
  actual=[x for m in result['output'][0]""")
    elif ident != "island":
        raise ValueError("No reviewed adapter for " + ident)
    if ident == "remote-files-bughunt":
        path = root / "author/checks.mjs"
        text = path.read_text(encoding="utf-8")
        text = "const environmentFailures=new WeakSet();function environmentFailure(message){const e=new Error(message);environmentFailures.add(e);return e}\n" + text
        pairs = [
            ("throw Error('AUTHOR: filesystem never settled')", "throw environmentFailure('AUTHOR: filesystem never settled')"),
            ("function deadline(p,label)", "function deadline(p,label,environment=false)"),
            ("reject(Error('operation did not settle: '+label))", "reject((environment?environmentFailure:Error)('operation did not settle: '+label))"),
            ("deadline(reached.promise,'AUTHOR: publication observability needs adaptation')", "deadline(reached.promise,'AUTHOR: publication observability needs adaptation',true)"),
            ("environment_invalid:String(e).includes('AUTHOR:')", "environment_invalid:environmentFailures.has(e)")]
        for before, after in pairs:
            if text.count(before) != 1:
                raise ValueError("Missing remote observability boundary")
            text = text.replace(before, after)
        fixture = "await fs.mkdir(dir,{recursive:true});for(let i=0;i<3;i++){const p=path.join(dir,`sparse-${i}`);const f=await fs.open(p,'w');await f.truncate(1536*1024*1024);await f.close();await fs.utimes(p,1000+i,1000+i)}"
        if text.count(fixture) != 1:
            raise ValueError("Missing author sparse-file fixture")
        text = text.replace(fixture, "try{" + fixture + "}catch(e){throw environmentFailure('Author sparse-file fixture failed')}")
        path.write_text(text, encoding="utf-8")
    if ident == "task-switch-cache":
        for name in ("scenarios.mjs", "legacy-scenarios.mjs"):
            path = root / "author" / name
            text = path.read_text(encoding="utf-8")
            helper = """const environmentFailures=new WeakSet();
function observe(ok,message){if(!ok){const e=new Error(message);environmentFailures.add(e);throw e}}
function fixtureDifferent(a,b,message){try{assert.notDeepEqual(a,b,message)}catch(e){environmentFailures.add(e);throw e}}
"""
            # These are author-owned observability assertions, never candidate text.
            prefixes = ["assert(meta.toolMetadataCache instanceof Map,", "assert(Array.isArray(proj.recentRenderProjections),",
                        "assert(Array.isArray(p.recentRenderProjections),", "assert(Array.isArray(e.dependencies?.[0]),",
                        "assert(first>0,", "assert(p.recentRenderProjections.length<=3,", "assert(tests[id],"]
            for prefix in prefixes:
                text = text.replace(prefix, "observe(" + prefix[len("assert("):])
            text = text.replace("assert.notDeepEqual(old,expected,'AUTHOR: fixture has no difference')", "fixtureDifferent(old,expected,'AUTHOR: fixture has no difference')")
            text = text.replace("pass:false,error:e.message,stack:e.stack", "pass:false,environment_invalid:environmentFailures.has(e),error:e.message,stack:e.stack")
            path.write_text(helper + text, encoding="utf-8")
        replace(root, "author/grade_impl.py",
                "   if 'OBSERVABILITY:' in o.get('error','') or 'AUTHOR:' in o.get('error',''):o['environment_invalid']=True",
                "   # Only the trusted adapter's typed observability flag controls exemption.")
        replace(root, "author/grade_impl.py",
                "except Exception as e:result={'status':'environment_invalid','score':None,'error':str(e)}",
                "except Exception as e:result={'status':'environment_invalid','score':None,'error':str(e),'failureCategory':'observability' if isinstance(e,AssertionError) and str(e).startswith('OBSERVABILITY:') else 'author_or_environment'}")
