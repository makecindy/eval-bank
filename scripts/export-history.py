"""Export reviewed structural fields only; never publish logs or session bodies.

Run only in trusted local trees whose contents and directory structure remain
unchanged for the duration of the export. Supplied roots are resolved first:
root and ancestor aliases are allowed unless the resolved trees overlap.
Paths derived beneath the resolved output root must not contain symlinks.
No output may be the same file as a record or summary input, including aliases.
These checks are not a security boundary against concurrent modification.
Export to a maintainer-owned review directory, not a live deployment tree.
Replacement preserves POSIX mode bits, not ownership, ACLs or extended attributes.
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
REPORT_IDENTITIES = {
    'seven-luna-high-concise-001': ('gpt-6-luna', 'high'),
    'seven-grok47-high-concise-001': ('grok-4.7', 'high'),
    'seven-mimo26pro-default-concise-001': ('mimo-v2.6-pro', 'default'),
}
REPORTS = tuple(REPORT_IDENTITIES)
# Sealed public run IDs: SHA-256 of sorted IDs as compact UTF-8 JSON.
HISTORICAL_RECORD_COUNT = 346
HISTORICAL_RUN_IDS_SHA256 = '8d5099523a2e550195b47db0e39de93a756cd7f7d860b0255eca456c8ec250f8'
BUG_KEYS = {f'B{i:02}' for i in range(1, 7)} | {'B03b'}
REMOTE_ITEMS = {f'V{i:02}{part}' for i in range(1, 5) for part in ('core', 'edge', 'guard')}
CACHE_ITEMS = {f'V{i:02}{part}' for i in range(1, 8) for part in ('core', 'edge', 'guard')}
REGRESSION_KEYS = {f'R{i:02}' for i in range(1, 5)}
# One fixed source for the manifest and diagnostics reviewed for each rubric.
# These are sealed public identities, not hashes recomputed from mutable output.
HISTORICAL_RUBRICS = {
    **{(q, 'legacy-normalized-v1'): {'manifestSha256': manifest_hash, 'items': set(), 'regressions': set()}
       for q, manifest_hash in (
           ('audio', 'b46ce3fa18a7ddd030c5aee2d4c1188aa37b87ca3fab15c54a4ae39e1748bfbd'),
           ('composer', 'f61555ebdedcdd196aea0d55f4c230c4f2a68949f4e48d85b02871df488f2ed2'),
           ('island', 'd5cd13aa759845398e6c6375a9b4c5f818dd54ba7f09a9b5b984c67eb7ccd769'),
           ('mobile-stream-order', '3b60a8127dfbe08f15bf6bdc71898c2e603e6eb552653fb89ab18aaf281c0ece'),
           ('recovery', 'db43ea6a2fd7b7ed18e7da0c7e32e7daaf6d4644834a8bfcd164aa359c026263'),
       )},
    ('remote-files-bughunt', 'v1'): {
        'manifestSha256': 'a5977e61a2793f39f03beeba5fea5875c501d330048e23c0e33a680f7fa2941d',
        'items': set(), 'regressions': set()},
    ('remote-files-bughunt', 'v2'): {
        'manifestSha256': 'd7750f2e2f423b8f5d6cd0c395b012122adde859432b0d34df6280997f1a846e',
        'items': REMOTE_ITEMS, 'regressions': BUG_KEYS | {'R01', 'R03'}},
    ('remote-files-bughunt', 'v3'): {
        'manifestSha256': 'e917b86d816c7a3ab2339a184dda6eb1d8d591cb4e6d1985967f48984566ca24',
        'items': REMOTE_ITEMS | BUG_KEYS, 'regressions': BUG_KEYS | {'R01', 'R03'}},
    ('task-switch-cache', 'v1'): {
        'manifestSha256': 'f33341b55bfb1fd452ed20e3e539cb38044fbe2c1f92265a53f7d016f7bd6477',
        'items': {f'D{i:02}{part}' for i in range(1, 8) for part in ('a', 'b')}, 'regressions': REGRESSION_KEYS},
    ('task-switch-cache', 'v2'): {
        'manifestSha256': '775ce54a5ef7271944fbb1ef9f8851a85ce53cd959449472960d416341c31f5e',
        'items': CACHE_ITEMS, 'regressions': REGRESSION_KEYS},
    ('task-switch-cache', 'v2.1'): {
        'manifestSha256': '53de3a9523eb93be0aa36b8407e4e3694b4c9d291d8cd484a959f677816ff38c',
        'items': CACHE_ITEMS, 'regressions': REGRESSION_KEYS},
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
    if raw['sampleKind'] not in ('independent', 'historical_import', 'reassessment', 'assisted_revision'):
        raise ValueError('Unknown historical sample kind')
    configuration = tuple(raw[field] for field in ('model', 'harness', 'effort'))
    # Compare complete strings: model names may themselves contain a slash.
    if raw['configurationId'] not in {separator.join(configuration) for separator in (' / ', '/', '|')}:
        raise ValueError('Public configurationId contradicts model, harness or effort')
    rubric = HISTORICAL_RUBRICS.get((raw['questionId'], raw['revision']))
    if rubric is None:
        raise ValueError('Unknown historical question revision')
    if raw['manifestSha256'] != rubric['manifestSha256']:
        raise ValueError('Public manifest hash does not match historical question revision')
    if raw.get('status') not in ('graded', 'environment_invalid'):
        raise ValueError('Invalid public result status')
    if raw['status'] == 'environment_invalid' and any(raw.get(field) is not None for field in ('scoreExact', 'score')):
        raise ValueError('Environment-invalid public record must not contain a score')
    validate_score(raw, nullable=raw['status'] == 'environment_invalid')
    cost = raw.get('costUSD')
    if cost is not None and (type(cost) not in (int, float) or not math.isfinite(cost) or cost < 0):
        raise ValueError('Invalid public costUSD')
    timestamps = {}
    for field in ('startUtc', 'endUtc', 'timeSource'):
        value = raw.get(field)
        if value is None:
            continue
        if not isinstance(value, str):
            raise ValueError('Invalid public metadata: ' + field)
        if field != 'timeSource':
            timestamps[field] = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if timestamps[field].tzinfo is None:
                raise ValueError('Public timestamp requires a timezone: ' + field)
    if len(timestamps) == 2 and timestamps['endUtc'] < timestamps['startUtc']:
        raise ValueError('Public end timestamp precedes start timestamp')

def public_question(raw):
    if not isinstance(raw, dict) or not isinstance(raw.get('question'), str) or raw['question'] not in FAILED_IDS:
        raise ValueError('Invalid public summary question')
    validate_score(raw)
    for field in ('name', 'executionChannel'):
        if field in raw and not isinstance(raw[field], str):
            raise ValueError('Invalid public question text: ' + field)
    failed = raw.get('failedItems')
    if not isinstance(failed, list) or any(not isinstance(item, str) or item not in FAILED_IDS[raw['question']] for item in failed):
        raise ValueError('Invalid public failedItems; expected reviewed question-specific IDs')
    if len(failed) != len(set(failed)):
        raise ValueError('Duplicate public failedItems identifier')
    if failed and Fraction(raw['scoreExact']) == 1:
        raise ValueError('Perfect public score contradicts failedItems')
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

def validate_summary(raw, report_name):
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
    identity = tuple(raw[field] for field in ('model', 'effort', 'suite', 'condition', 'fast', 'timeLimitInPrompt'))
    expected = (*REPORT_IDENTITIES[report_name], 'seven-question-quality-v2', 'concise-prompt-v1', False, False)
    if identity != expected:
        raise ValueError('Summary does not match report identity: ' + report_name)
    if 'harness' in raw and (not isinstance(raw['harness'], str) or not raw['harness'].strip()):
        raise ValueError('Invalid summary harness')
    if 'promptNormalization' in raw and not isinstance(raw['promptNormalization'], str):
        raise ValueError('Invalid summary promptNormalization')
    if 'limitations' in raw and (not isinstance(raw['limitations'], list) or
                                any(not isinstance(item, str) for item in raw['limitations'])):
        raise ValueError('Invalid summary limitations; expected text list')
    if datetime.fromisoformat(raw['completedAt'].replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('Summary completion time requires a timezone')

def overlap(left, right):
    return left == right or left in right.parents or right in left.parents

def checks(raw, field):
    allowed = HISTORICAL_RUBRICS[(raw['questionId'], raw['revision'])][field]
    value = raw[field]
    if value is None:
        return None
    if not isinstance(value, dict) or any(
        key not in allowed or type(item) is not bool
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
    if len(sources) != HISTORICAL_RECORD_COUNT:
        p.error('Expected exactly 346 sealed historical records; refusing to replace public results')
    input_files = set()
    records=[]
    run_ids=set()
    for source in sources:
        info = source.stat()
        input_files.add((info.st_dev, info.st_ino))
        source_bytes = source.read_bytes()
        raw=json.loads(source_bytes)
        validate_record(raw)
        if raw['runId'] in run_ids:
            raise ValueError('Duplicate historical runId')
        run_ids.add(raw['runId'])
        row={k:raw[k] for k in FIELDS if k in raw}
        for field in ('items', 'regressions'):
            if field in raw:
                row[field] = checks(raw, field)
        row['sourceRecordSha256']=hashlib.sha256(source_bytes).hexdigest()
        row.setdefault('costUSD',None)
        row['evidenceAvailability']='Original evidence retained privately; not bundled in this export'
        records.append(row)
    identity_bytes = json.dumps(sorted(run_ids), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    if hashlib.sha256(identity_bytes).hexdigest() != HISTORICAL_RUN_IDS_SHA256:
        p.error('Historical run IDs do not match the sealed set; refusing to replace public results')
    pending = [(output/'results/historical-records.json', records)]
    for name in REPORTS:
        source = archive/'reports'/name/'summary.json'
        info = source.stat()
        input_files.add((info.st_dev, info.st_ino))
        raw=json.loads(source.read_text(encoding='utf-8'))
        validate_summary(raw, name)
        row={k:raw[k] for k in SUMMARY if k in raw}
        row['questions']=public_questions(raw)
        row['costUSD']=None
        pending.append((output/'reports'/name/'summary.json', row))
    # The selected root aliases have already been resolved. Before writing,
    # reject symlinks in the paths derived beneath that canonical output root.
    # The caller must keep the trusted tree unchanged until export finishes.
    for path, _ in pending:
        if overlap(archive, path.resolve()):
            p.error('Output destination overlaps the private archive')
        if any(part.is_symlink() for part in (path, *path.parents)):
            p.error('Paths beneath the resolved output root must not contain symlinks')
        if path.exists():
            info = path.stat()
            if (info.st_dev, info.st_ino) in input_files:
                p.error('Output destination resolves to an input source')
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
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
            # Preserve mode bits only; deployment ownership and ACLs are out of scope.
            temporary.chmod(stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
        for temporary, path in staged:
            temporary.replace(path)
    finally:
        for temporary, _ in staged:
            temporary.unlink(missing_ok=True)
    print(f'Exported {len(records)} historical records and 3 suite summaries')

if __name__=='__main__':main()
