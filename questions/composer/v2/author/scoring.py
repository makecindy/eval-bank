"""Six fixed capability groups; the former 13-item ratio remains diagnostic."""
import json
from pathlib import Path
from fractions import Fraction

CONTRACT = json.loads((Path(__file__).with_name('acceptance.json')).read_text())
EXPECTED = {i['id'] for i in CONTRACT['items']}
GROUPS = CONTRACT['groups']
VERSION = 'capability-groups-v1.5'
assert len(GROUPS) == 6
assert sorted(i for g in GROUPS for i in g['items']) == sorted(EXPECTED)
assert all(g['weight'] == 1 and g['items'] for g in GROUPS)

def score(result, baseline=None):
    out = dict(result, scoringVersion=VERSION)
    if not result.get('valid'):
        out.update(score=None, scorePercent=None, contribution=None, coveragePercent=None,
                   groups=None, allItemsPassed=None, coreProblemSolved=None, solved=None,
                   outcome='environment_invalid')
        return out
    rows = result['items']; ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)) or set(ids) != EXPECTED:
        raise ValueError('acceptance IDs differ from frozen 13-item contract')
    if any(type(r['passed']) is not bool for r in rows):
        raise ValueError('each item must have a boolean result')
    passed = {r['id'] for r in rows if r['passed']}
    groups=[]; ratios=[]
    for g in GROUPS:
        n = len(passed.intersection(g['items'])); ratio=Fraction(n,len(g['items']))
        groups.append(dict(g, passed=n, total=len(g['items']), ratio=float(ratio), exact=str(ratio)))
        ratios.append(ratio)
    contribution=sum(ratios)/len(ratios)
    out.update(passed=len(passed),total=len(EXPECTED),coveragePercent=100*len(passed)/len(EXPECTED),
               itemRatio=float(Fraction(len(passed),len(EXPECTED))),groups=groups,
               contribution=float(contribution),contributionExact=str(contribution),
               score=float(contribution*100),scorePercent=float(contribution*100),
               allItemsPassed=passed==EXPECTED,coreProblemSolved='C01' in passed,
               solved=passed==EXPECTED,outcome='solved' if passed==EXPECTED else 'not_solved')
    return out
