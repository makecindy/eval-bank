"""Export reviewed structural fields only; never publish logs or session bodies.

Run only in trusted local trees whose contents and directory structure remain
unchanged for the duration of the export. Path checks prevent accidental aliases;
they are not a security boundary against concurrent filesystem modification.
"""
import argparse
import hashlib
import json
import os
import math
import re
from fractions import Fraction
from datetime import datetime
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

# Frozen historical schema, not a general-purpose diagnostic exporter.
IDENTITY = ('runId', 'configurationId', 'model', 'harness', 'effort',
            'questionId', 'revision', 'manifestSha256', 'sampleKind', 'executionChannel')
FAILED_IDS = {
    'audio': set(),
    'island': {'I04', 'I06'},
    'recovery': {'R04', 'R08', 'R17', 'R20'},
    'composer': {'C09', 'C10'},
    'mobile-stream-order': {'C02', 'C03', 'C04'},
    'remote-files-bughunt': {'B03', 'B03b', 'B04', 'B05', 'B06', 'V01core', 'V01edge',
                            'V02core', 'V02edge', 'V02guard', 'V03edge', 'V03guard', 'V04guard'},
    'task-switch-cache': {'parsing-negative', 'parsing-markdown', 'media-handoff',
                          'cards-ownership', 'bounded-reuse-lru'},
}

def validate_score(raw, nullable=False):
    exact = raw.get('scoreExact')
    if 'scoreExact' not in raw or (exact is None and not nullable):
        raise ValueError('Missing public exact score')
    if exact is not None:
        if not isinstance(exact, str) or not re.fullmatch(r'[0-9]+(?:/[1-9][0-9]*|\.[0-9]+)?', exact):
            raise ValueError('Invalid public exact score')
        if not 0 <= Fraction(exact) <= 1:
            raise ValueError('Public exact score out of range')
    if 'score' in raw and raw['score'] is not None:
        value = raw['score']
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
            raise ValueError('Invalid public numeric score')
        if exact is None or not math.isclose(value, float(Fraction(exact)), rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError('Inconsistent public score representations')

def validate_record(raw):
    if not isinstance(raw, dict) or any(not isinstance(raw.get(k), str) or not raw[k].strip() for k in IDENTITY):
        raise ValueError('Missing or invalid public result identity')
    if not re.fullmatch(r'[a-f0-9]{64}', raw['manifestSha256']):
        raise ValueError('Invalid public manifest hash')
    if raw.get('status') not in ('graded', 'environment_invalid'):
        raise ValueError('Invalid public result status')
    validate_score(raw, nullable=raw['status'] == 'environment_invalid')
    cost = raw.get('costUSD')
    if cost is not None and (type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0):
        raise ValueError('Invalid public costUSD')

def public_question(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get('question'), str) or raw['question'] not in FAILED_IDS:
        raise ValueError('Invalid public summary question')
    validate_score(raw)
    failed = raw.get('failedItems')
    if not isinstance(failed, list) or any(not isinstance(item, str) or item not in FAILED_IDS[raw['question']] for item in failed):
        raise ValueError('Invalid public failedItems; expected reviewed question-specific IDs')
    return {k: raw[k] for k in ROW if k in raw}

def public_questions(raw):
    questions = raw.get('questions')
    if not isinstance(questions, list):
        raise ValueError('Missing public summary questions')
    rows = [public_question(q) for q in questions]
    if len(rows) != len(FAILED_IDS) or {q['question'] for q in rows} != set(FAILED_IDS):
        raise ValueError('Summary must contain all seven unique questions')
    total = sum((Fraction(q['scoreExact']) for q in rows), Fraction(0))
    if type(raw.get('maximum')) is not int or raw['maximum'] != len(FAILED_IDS):
        raise ValueError('Invalid summary maximum')
    for field, expected in (('total', total), ('mean', total / len(FAILED_IDS))):
        exact, number = raw.get(field + 'Exact'), raw.get(field)
        if not isinstance(exact, str) or not re.fullmatch(r'[0-9]+(?:/[1-9][0-9]*|\.[0-9]+)?', exact) or Fraction(exact) != expected:
            raise ValueError('Inconsistent summary exact aggregate')
        if type(number) not in (int, float) or not math.isfinite(number) or not math.isclose(number, float(expected), rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError('Inconsistent summary numeric aggregate')
    return rows

def validate_summary(raw):
    if not isinstance(raw, dict):
        raise ValueError('Invalid summary object')
    for field in ('model', 'effort', 'suite', 'condition', 'completedAt'):
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise ValueError('Missing or invalid summary metadata: ' + field)
    if raw.get('status') != 'complete':
        raise ValueError('Invalid summary status')
    for field in ('fast', 'timeLimitInPrompt'):
        if type(raw.get(field)) is not bool:
            raise ValueError('Invalid summary boolean: ' + field)
    if 'harness' in raw and (not isinstance(raw['harness'], str) or not raw['harness'].strip()):
        raise ValueError('Invalid summary harness')
    if datetime.fromisoformat(raw['completedAt'].replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('Summary completion time requires a timezone')

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
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')

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
    run_ids=set()
    for source in sources:
        source_bytes = source.read_bytes()
        raw=json.loads(source_bytes)
        validate_record(raw)
        if raw['runId'] in run_ids:
            raise ValueError('Duplicate historical runId')
        run_ids.add(raw['runId'])
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
        validate_summary(raw)
        row={k:raw[k] for k in SUMMARY if k in raw}
        row['questions']=public_questions(raw)
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
