"""Local-only evaluation helpers. Every write is confined to this version."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, threading, time, uuid

ROOT = Path(os.environ['EVAL_OUTPUT_ROOT']).resolve()
PACKAGE = Path(__file__).resolve().parent.parent
BASE = ROOT.parent
LOCK = threading.Lock()

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def write_json(path, value):
    path = Path(path)
    assert path.resolve().is_relative_to(ROOT), path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def run(args, label, cwd=None, env=None, timeout=120):
    token = label + '-' + uuid.uuid4().hex[:8]
    stdout = ROOT / 'logs' / (token + '.stdout.log')
    stderr = ROOT / 'logs' / (token + '.stderr.log')
    e = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'TMPDIR': str(ROOT / 'tmp') + '/', **(env or {})}
    start = time.monotonic()
    row = {'command': [str(x) for x in args], 'cwd': str(cwd or ROOT), 'startedAt': now(), 'label': label}
    try:
        p = subprocess.run(row['command'], cwd=cwd or ROOT, env=e, capture_output=True, timeout=timeout)
        out, err, code = p.stdout, p.stderr, p.returncode
    except subprocess.TimeoutExpired as exc:
        out, err, code = exc.stdout or b'', exc.stderr or b'', None
        row['timeout'] = timeout
    stdout.write_bytes(out); stderr.write_bytes(err)
    row.update(exitCode=code, finishedAt=now(), elapsedSeconds=time.monotonic()-start,
               stdout=str(stdout.relative_to(ROOT)), stderr=str(stderr.relative_to(ROOT)))
    with LOCK, (ROOT/'logs/commands.jsonl').open('a') as f:
        f.write(json.dumps(row, ensure_ascii=False)+'\n')
    return row, out.decode(errors='replace'), err.decode(errors='replace')

def source_manifest(root):
    root = Path(root)
    # All business/build inputs; self-tests and packaged runtimes cannot change
    # business identity, and are hashed separately in the original-file audit.
    return {str(p.relative_to(root)): digest(p) for group in ['apps', 'packages', 'config', 'dependency-patches']
            for p in sorted((root/group).rglob('*')) if p.is_file()}

def manifest_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
