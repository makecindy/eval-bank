"""Export reviewed structural fields only; never publish logs or session bodies."""
import argparse
import hashlib
import json
from pathlib import Path

FIELDS = ('runId','configurationId','model','harness','effort','questionId','revision','manifestSha256','scoreExact','score','status','sampleKind','executionChannel','startUtc','endUtc','timeSource','costUSD','items','regressions')
SUMMARY = ('status','model','harness','effort','fast','suite','condition','timeLimitInPrompt','completedAt','totalExact','total','maximum','meanExact','mean','limitations','promptNormalization')
ROW = ('question','name','scoreExact','score','executionChannel','failedItems')

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive',type=Path)
    p.add_argument('output',type=Path)
    a=p.parse_args()
    records=[]
    for source in sorted((a.archive/'question-bank/results').glob('*.json')):
        raw=json.loads(source.read_text())
        row={k:raw[k] for k in FIELDS if k in raw}
        row['sourceRecordSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
        row.setdefault('costUSD',None)
        row['evidenceAvailability']='Original evidence retained privately; not bundled in this export'
        records.append(row)
    write(a.output/'results/historical-records.json',records)
    for name in ('seven-luna-high-concise-001','seven-grok47-high-concise-001','seven-mimo26pro-default-concise-001'):
        raw=json.loads((a.archive/'reports'/name/'summary.json').read_text())
        row={k:raw[k] for k in SUMMARY if k in raw}
        row['questions']=[{k:q[k] for k in ROW if k in q} for q in raw['questions']]
        row['costUSD']=None
        write(a.output/'reports'/name/'summary.json',row)
    print(f'Exported {len(records)} historical records and 3 suite summaries')

if __name__=='__main__':main()
