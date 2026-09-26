"""OS-isolated candidate execution; answers and assertions stay in parent Python."""
import json, os, signal, subprocess, tempfile, shutil, resource, hashlib, selectors, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NODE=ROOT.parent/'candidate/runtime/node'
def quote(s): return json.dumps(str(s))
def profile(run):
    # Parent directories need read access for macOS loader path resolution.
    parents={Path('/'),*ROOT.parents,ROOT,NODE.parent,*run.parents,run}
    literals=' '.join('(literal '+quote(p)+')' for p in parents)
    return f'''(version 1)
(deny default)
(allow process-exec (literal {quote(NODE)}))
(allow process-fork)
(allow process-info*)
(allow sysctl-read)
(allow mach-lookup)
(allow file-map-executable)
(allow ipc-posix-shm*)
(allow file-read-metadata)
(allow file-read* {literals} (subpath "/System") (subpath "/usr") (subpath "/dev") (subpath {quote(NODE.parent)}) (subpath {quote(run)}))
(allow file-write* (literal "/dev/null") (subpath "/dev/fd") (literal "/dev/stdout") (literal "/dev/stderr"))
'''
def limits():
    resource.setrlimit(resource.RLIMIT_CPU,(5,6))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE,(0,0))
    resource.setrlimit(resource.RLIMIT_NOFILE,(128,128))

def bounded_communicate(p,payload,timeout):
    deadline=time.monotonic()+timeout
    try:p.stdin.write(payload);p.stdin.close()
    except BrokenPipeError:pass
    buffers={p.stdout:bytearray(),p.stderr:bytearray()}
    sel=selectors.DefaultSelector()
    for pipe in buffers:sel.register(pipe,selectors.EVENT_READ)
    failure=None
    while sel.get_map():
        if time.monotonic()>deadline:failure='timeout';break
        for key,_ in sel.select(min(.2,max(0,deadline-time.monotonic()))):
            chunk=os.read(key.fileobj.fileno(),65536)
            if not chunk:sel.unregister(key.fileobj);continue
            buffers[key.fileobj].extend(chunk)
            if len(buffers[key.fileobj])>8*1024*1024:failure='output_limit';break
        if failure:break
    if failure:
        try:os.killpg(p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    p.wait(timeout=2);sel.close()
    return failure,bytes(buffers[p.stdout]),bytes(buffers[p.stderr])

def invoke(case,source,tests,probe_code=None,timeout=10,permission=True):
    if source is not None:
        source=Path(source).absolute()
        if source.is_symlink() or any(p.is_symlink() for p in source.parents):
            return {'status':'unsafe_source_path','reason':'candidate source may not use symlinks'}
        if not source.is_file() or source.stat().st_size>256*1024:
            return {'status':'invalid_source_file','reason':'regular source file <=256KiB required'}
    payload=json.dumps({'tests':tests}).encode()
    if len(payload)>8*1024*1024:return {'status':'input_limit'}
    with tempfile.TemporaryDirectory(prefix='cindy-eval-run-',dir='/private/tmp') as t:
        run=Path(t);run.chmod(0o700)
        if case:
            public=ROOT/'public'
            shutil.copytree(public,run,dirs_exist_ok=True)
            shutil.copyfile(source,run/case['file'])
        shutil.copyfile(Path(__file__).resolve().parent/'adapter.mjs',run/'adapter.mjs')
        env={'PATH':'/usr/bin:/bin','LANG':'C','TZ':'UTC'}
        flags=['--no-warnings','--max-old-space-size=128','--experimental-strip-types','--experimental-vm-modules']
        if permission: flags+=['--experimental-permission',f'--allow-fs-read={run}']
        argv=['-e',probe_code] if probe_code is not None else [str(run/'adapter.mjs'),case['kind'],str(run/case['file'])]
        cmd=['/usr/bin/sandbox-exec','-p',profile(run),str(NODE),*flags,*argv]
        p=subprocess.Popen(cmd,cwd=run,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limits)
        failure,stdout,stderr=bounded_communicate(p,payload,timeout)
        if failure:return {'status':failure,'exit_code':p.returncode}
        if p.returncode!=0:
            return {'status':'execution_error','exit_code':p.returncode,'stderr':stderr.decode(errors='replace')[:1200]}
        try:
            return {'status':'ok','output':json.loads(stdout),'stderr':stderr.decode(errors='replace')[:300]}
        except (ValueError,UnicodeDecodeError):
            return {'status':'invalid_output','exit_code':p.returncode,'bytes':len(stdout)}

def verify_runtime():
    env=json.loads((ROOT/'environment.json').read_text())
    assert hashlib.sha256(NODE.read_bytes()).hexdigest()==env['node_sha256'],'runtime hash differs'
    return env

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description='Grade one code candidate; no model calls.');ap.add_argument('case');ap.add_argument('candidate');args=ap.parse_args()
    verify_runtime()
    cases=json.loads((ROOT/'manifest.json').read_text())['cases']
    case=next(c for c in cases if c['id']==args.case)
    import verify
    result=verify.grade(case,Path(args.candidate))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(0 if result.get('task_pass') else 1 if result['status']=='graded' else 2)
