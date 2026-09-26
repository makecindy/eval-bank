"""Export reviewed structural fields only; never publish logs or session bodies."""
import argparse
import hashlib
import json
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

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

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
        raw=json.loads(source.read_text())
        row={k:raw[k] for k in FIELDS if k in raw}
        for field in CHECK_KEYS:
            if field in raw:
                row[field] = checks(raw, field)
        row['sourceRecordSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
        row.setdefault('costUSD',None)
        row['evidenceAvailability']='Original evidence retained privately; not bundled in this export'
        records.append(row)
    pending = [(output/'results/historical-records.json', records)]
    for name in REPORTS:
        raw=json.loads((archive/'reports'/name/'summary.json').read_text())
        row={k:raw[k] for k in SUMMARY if k in raw}
        row['questions']=[{k:q[k] for k in ROW if k in q} for q in raw['questions']]
        row['costUSD']=None
        pending.append((output/'reports'/name/'summary.json', row))
    # Validate all inputs and destinations before the first write, including
    # aliases in existing output trees. Never follow an output symlink.
    input_paths = sources + [archive/'reports'/name/'summary.json' for name in REPORTS]
    for path, _ in pending:
        if overlap(archive, path.resolve()):
            p.error('Output destination overlaps the private archive')
        if any(part.is_symlink() for part in (path, *path.parents)):
            p.error('Output destinations must not contain symlinks')
        if path.exists() and any(path.samefile(source) for source in input_paths):
            p.error('Output destination aliases a private source')
    for path, value in pending:
        write(path, value)
    print(f'Exported {len(records)} historical records and 3 suite summaries')

if __name__=='__main__':main()
