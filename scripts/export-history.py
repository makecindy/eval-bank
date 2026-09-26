"""Export reviewed structural fields only; never publish logs or session bodies.

Run only in trusted local trees whose contents and directory structure remain
unchanged for the duration of the export. Path checks prevent accidental aliases;
they are not a security boundary against concurrent filesystem modification.
"""
import argparse
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path

FIELDS = ('runId','configurationId','model','harness','effort','questionId','revision','manifestSha256','scoreExact','score','status','sampleKind','executionChannel','startUtc','endUtc','timeSource','costUSD','items','regressions')
SUMMARY = ('status','model','harness','effort','fast','suite','condition','timeLimitInPrompt','completedAt','totalExact','total','maximum','meanExact','mean','limitations','promptNormalization')
ROW = ('question','name','scoreExact','score','executionChannel','failedItems')
REPORTS = ('seven-luna-high-concise-001','seven-grok47-high-concise-001','seven-mimo26pro-default-concise-001')
BUG_KEYS = {f'B{i:02}' for i in range(1, 7)} | {'B03b'}
CHECK_KEYS = {
    'items': BUG_KEYS | {f'D{i:02}{part}' for i in range(1, 8) for part in ('a', 'b')}
             | {f'V{i:02}{part}' for i in range(1, 8) for part in ('core', 'edge', 'guard')},
    'regressions': BUG_KEYS | {f'R{i:02}' for i in range(1, 5)},
}

def overlap(left, right):
    return left == right or left in right.parents or right in left.parents

def checks(raw, field):
    value = raw[field]
    if value is None:
        return None
    if not isinstance(value, dict) or any(
        key not in CHECK_KEYS[field] or type(item) is not bool
        for key, item in value.items()
    ):
        raise ValueError(f'Invalid public {field}; expected reviewed check IDs and booleans')
    return value

def make_public_directories(path):
    missing = []
    while not path.exists():
        missing.append(path)
        path = path.parent
    for directory in reversed(missing):
        directory.mkdir()
        directory.chmod(0o755)


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path)
    p.add_argument('output',type=Path)
    a=p.parse_args()
    archive, output = a.archive.resolve(), a.output.resolve()
    if overlap(archive, output):
        p.error('Output must not overlap the private archive')
    sources = sorted((archive/'question-bank/results').glob('*.json'))
    if not sources:
        p.error('No historical records found; refusing to replace public results')
    records=[]
    for source in sources:
        source_bytes = source.read_bytes()
        raw=json.loads(source_bytes)
        row={k:raw[k] for k in FIELDS if k in raw}
        for field in CHECK_KEYS:
            if field in raw:
                row[field] = checks(raw, field)
        row['sourceRecordSha256']=hashlib.sha256(source_bytes).hexdigest()
        row.setdefault('costUSD',None)
        row['evidenceAvailability']='Original evidence retained privately; not bundled in this export'
        records.append(row)
    pending = [(output/'results/historical-records.json', records)]
    for name in REPORTS:
        raw=json.loads((archive/'reports'/name/'summary.json').read_text(encoding='utf-8'))
        row={k:raw[k] for k in SUMMARY if k in raw}
        row['questions']=[{k:q[k] for k in ROW if k in q} for q in raw['questions']]
        row['costUSD']=None
        pending.append((output/'reports'/name/'summary.json', row))
    # Validate all inputs and destinations before the first write, including
    # aliases in existing output trees. Reject symlinks present at validation.
    # The caller must keep the trusted tree unchanged until export finishes.
    for path, _ in pending:
        if overlap(archive, path.resolve()):
            p.error('Output destination overlaps the private archive')
        if any(part.is_symlink() for part in (path, *path.parents)):
            p.error('Output destinations must not contain symlinks')
        if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
            p.error('Output destination must be a regular file with a single link')
    # Finish every serialization and write before replacing any public file.
    # Stage beside each destination so replacement stays on the same filesystem.
    staged = []
    try:
        for path, value in pending:
            make_public_directories(path.parent)
            fd, name = tempfile.mkstemp(prefix='.history-export-', dir=path.parent)
            os.close(fd)
            temporary = Path(name)
            staged.append((temporary, path))
            write(temporary, value)
            # Keep an existing access policy; new reviewed public exports are readable.
            temporary.chmod(stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
        for temporary, path in staged:
            temporary.replace(path)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    print(f'Exported {len(records)} historical records and 3 suite summaries')

if __name__=='__main__':main()
