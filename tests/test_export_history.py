import importlib.util
import hashlib
import json
import os
import stat
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/export-history.py'
spec = importlib.util.spec_from_file_location('export_history', SCRIPT)
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'private'
        self.output = self.root / 'public'
        self.source = self.archive / 'question-bank/results/one.json'
        self.source.parent.mkdir(parents=True)
        self.valid_record = {k: 'fixture' for k in export.IDENTITY}
        self.valid_record.update(manifestSha256='a'*64, status='graded', scoreExact='1/3')
        self.source.write_text(json.dumps({**self.valid_record, 'scoreExact': '1/3', 'items': {'B01': True}, 'regressions': {'R01': False}, 'privateNote': 'SECRET'}))
        for name in export.REPORTS:
            p = self.archive / 'reports' / name / 'summary.json'
            p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'status': 'complete', 'model': 'fixture', 'effort': 'high',
                                    'suite': 'fixture', 'condition': 'fixture', 'fast': False,
                                    'timeLimitInPrompt': False, 'completedAt': '2026-09-24T00:00:00Z',
                                    'maximum': 7, 'totalExact': '7/3', 'total': 7/3,
                                    'meanExact': '1/3', 'mean': 1/3,
                                    'questions': [{'question': q, 'scoreExact': '1/3', 'failedItems': []} for q in export.FAILED_IDS], 'secret': 'SECRET'}))
        self.target = self.output / 'results/historical-records.json'
        self.target.parent.mkdir(parents=True)
        self.target.write_text('existing results')

    def run_export(self, output=None):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.archive), str(output or self.output)], capture_output=True)

    def assert_failure_preserves(self, output=None):
        before = {p: p.read_bytes() for p in self.archive.rglob('*.json')}
        self.assertNotEqual(self.run_export(output).returncode, 0)
        self.assertEqual(self.target.read_text(), 'existing results')
        self.assertEqual(before, {p: p.read_bytes() for p in self.archive.rglob('*.json')})

    def test_valid_export(self):
        self.assertEqual(self.run_export().returncode, 0)
        result = json.loads(self.target.read_text())[0]
        self.assertEqual(result['scoreExact'], '1/3')
        self.assertEqual(result['items'], {'B01': True})
        self.assertNotIn('SECRET', self.target.read_text())

    @unittest.skipUnless(os.name == 'posix', 'POSIX file-mode semantics')
    def test_staging_preserves_existing_modes_and_new_public_readability(self):
        for mode in (0o644, 0o600):
            with self.subTest(mode=mode):
                self.target.chmod(mode)
                self.assertEqual(self.run_export().returncode, 0)
                self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), mode)
                for name in export.REPORTS:
                    target = self.output / 'reports' / name / 'summary.json'
                    self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)

    @unittest.skipUnless(os.name == 'posix', 'POSIX file-mode semantics')
    def test_new_directories_readable_under_restrictive_umask(self):
        self.output.chmod(0o700)
        for output in (self.output, self.root / 'fresh' / 'public'):
            old_umask = os.umask(0o077)
            try:
                result = self.run_export(output)
            finally:
                os.umask(old_umask)
            self.assertEqual(result.returncode, 0, result.stderr)
            for directory in (output / 'reports', *(output / 'reports' / name for name in export.REPORTS)):
                self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root / 'fresh').stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.root / 'fresh/public').stat().st_mode), 0o755)

    def test_utf8_export_with_utf8_mode_disabled(self):
        for name in export.REPORTS:
            path = self.archive / 'reports' / name / 'summary.json'
            raw = json.loads(path.read_text())
            raw['questions'][0]['name'] = '中文题目'
            path.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')
        env = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PYTHONUTF8': '0', 'PYTHONCOERCECLOCALE': '0'}
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.archive), str(self.output)], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in export.REPORTS:
            value = json.loads((self.output / 'reports' / name / 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual(value['questions'][0], {'question': 'audio', 'name': '中文题目', 'scoreExact': '1/3', 'failedItems': []})

    def test_overlapping_directories(self):
        for path in (self.archive, self.archive / 'export', self.root):
            with self.subTest(path=path):
                self.assert_failure_preserves(path)

    def test_output_alias(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.archive, target_is_directory=True)
        self.assert_failure_preserves(alias)

    def test_nested_symlink(self):
        (self.output / 'reports').symlink_to(self.archive / 'reports', target_is_directory=True)
        self.assert_failure_preserves()

    def test_hardlink(self):
        self.target.unlink()
        self.target.hardlink_to(self.source)
        original = self.source.read_bytes()
        self.assertNotEqual(self.run_export().returncode, 0)
        self.assertEqual(self.source.read_bytes(), original)

    def test_unrelated_private_hardlink(self):
        private = self.archive / 'unrelated.txt'
        private.write_text('private original')
        self.target.unlink()
        self.target.hardlink_to(private)
        self.assertNotEqual(self.run_export().returncode, 0)
        self.assertEqual(private.read_text(), 'private original')

    def test_provenance_uses_parsed_bytes(self):
        original = self.source.read_bytes()
        read = Path.read_bytes
        reads = []
        def changing_read(path):
            data = read(path)
            if path == self.source.resolve():
                reads.append(path)
                path.write_text('{"scoreExact":"0"}')
            return data
        with patch.object(Path, 'read_bytes', changing_read), patch.object(sys, 'argv', [str(SCRIPT), str(self.archive), str(self.output)]):
            export.main()
        result = json.loads(self.target.read_text())[0]
        self.assertEqual(len(reads), 1)
        self.assertEqual(result['scoreExact'], '1/3')
        self.assertEqual(result['sourceRecordSha256'], hashlib.sha256(original).hexdigest())

    def test_late_parent_failure_preserves_export(self):
        parent = self.output / 'reports' / export.REPORTS[-1]
        parent.parent.mkdir(parents=True)
        parent.write_text('not a directory')
        self.assert_failure_preserves()
        self.assertEqual(list(self.output.rglob('.history-export-*')), [])

    def test_late_staging_write_failure_preserves_all_exports(self):
        for name in export.REPORTS:
            target = self.output / 'reports' / name / 'summary.json'
            target.parent.mkdir(parents=True)
            target.write_text('old summary')
        before = {p: p.read_bytes() for p in self.output.rglob('*.json')}
        write = export.write
        count = 0
        def fail_later(path, value):
            nonlocal count
            count += 1
            if count == 3:
                raise OSError('simulated disk write failure')
            write(path, value)
        with patch.object(export, 'write', fail_later), patch.object(sys, 'argv', [str(SCRIPT), str(self.archive), str(self.output)]):
            with self.assertRaises(OSError):
                export.main()
        self.assertEqual(before, {p: p.read_bytes() for p in self.output.rglob('*.json')})
        self.assertEqual(list(self.output.rglob('.history-export-*')), [])

    def test_missing_records(self):
        self.source.unlink()
        self.assert_failure_preserves()

    def test_missing_last_summary(self):
        (self.archive / 'reports' / export.REPORTS[-1] / 'summary.json').unlink()
        self.assert_failure_preserves()

    def test_nested_unreviewed_fields(self):
        for field in ('items', 'regressions'):
            for value in ({'B01': 'SECRET'}, {'private/path': True}, {'B01': {'details': 'SECRET'}}, ['SECRET']):
                with self.subTest(field=field, value=value):
                    self.source.write_text(json.dumps({**self.valid_record, field: value}))
                    self.assert_failure_preserves()

    def test_existing_public_checks_accepted_without_change(self):
        records = json.loads((SCRIPT.parents[1] / 'results/historical-records.json').read_text())
        for row in records:
            for field in export.CHECK_KEYS:
                if field in row:
                    self.assertEqual(export.checks(row, field), row[field])

    def test_incomplete_or_wrong_record_rejected_before_writes(self):
        candidates = [{}, [], None]
        for field in (*export.IDENTITY, 'status', 'scoreExact'):
            row = dict(self.valid_record)
            del row[field]
            candidates.append(row)
            candidates.append({**self.valid_record, field: {'diagnostic': 'SECRET'}})
        candidates += [{**self.valid_record, 'scoreExact': value} for value in (True, 1, '1/0', '2', None, 'private/path')]
        candidates += [{**self.valid_record, 'score': value} for value in (True, '1', float('nan'), float('inf'))]
        for row in candidates:
            with self.subTest(row=row):
                self.source.write_text(json.dumps(row))
                self.assert_failure_preserves()

    def test_failed_item_values_rejected_before_writes(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        for value in (None, 'I04', {}, [False], [['I04']], ['/private/path'], ['token=SECRET'], ['C09']):
            with self.subTest(value=value):
                target.write_text(json.dumps({'questions': [{'question': 'island', 'scoreExact': '1/3', 'failedItems': value}]}))
                self.assert_failure_preserves()

    def test_all_public_records_and_summaries_are_unchanged_by_validation(self):
        records = json.loads((SCRIPT.parents[1] / 'results/historical-records.json').read_text(encoding='utf-8'))
        for row in records:
            before = json.dumps(row)
            export.validate_record(row)
            self.assertEqual(json.dumps(row), before)
        for name in export.REPORTS:
            raw = json.loads((SCRIPT.parents[1] / 'reports' / name / 'summary.json').read_text(encoding='utf-8'))
            before = json.dumps(raw)
            export.validate_summary(raw)
            self.assertEqual(export.public_questions(raw), raw['questions'])
            self.assertEqual(json.dumps(raw), before)

    def test_duplicate_run_identity_preserves_output(self):
        copy = self.source.with_name('renamed.json')
        copy.write_bytes(self.source.read_bytes())
        self.assert_failure_preserves()
        raw = json.loads(copy.read_text())
        raw['scoreExact'] = '1/2'
        copy.write_text(json.dumps(raw))
        self.assert_failure_preserves()
        raw['runId'] = 'distinct-run'
        copy.write_text(json.dumps(raw))
        self.assertEqual(self.run_export().returncode, 0)
        self.assertEqual(len(json.loads(self.target.read_text())), 2)

    def test_summary_metadata_required_before_replacement(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(target.read_text())
        for field in ('status', 'model', 'effort', 'suite', 'condition', 'fast', 'timeLimitInPrompt', 'completedAt'):
            for value in (None, {}, [], 0, ''):
                with self.subTest(field=field, value=value):
                    raw = {**valid, field: value}
                    if value is None:
                        del raw[field]
                    target.write_text(json.dumps(raw))
                    self.assert_failure_preserves()
        for changes in ({'status': 'running'}, {'completedAt': '2026-09-24T00:00:00'}, {'harness': []}):
            target.write_text(json.dumps({**valid, **changes}))
            self.assert_failure_preserves()

    def test_incomplete_duplicate_and_inconsistent_summary_preserve_output(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(target.read_text())
        candidates = [dict(valid, questions=valid['questions'][:1]),
                      dict(valid, questions=[valid['questions'][0]] * 7)]
        candidates += [{**valid, key: value} for key, value in
                       [('totalExact', '1'), ('total', 1), ('meanExact', '1'), ('mean', 1), ('maximum', 8)]]
        row = {**valid['questions'][0], 'score': 0}
        candidates.append({**valid, 'questions': [row, *valid['questions'][1:]]})
        for raw in candidates:
            with self.subTest(raw=raw):
                target.write_text(json.dumps(raw))
                self.assert_failure_preserves()

    def test_numeric_mismatch_and_invalid_cost_preserve_output(self):
        candidates = [{**self.valid_record, 'score': 0}]
        candidates += [{**self.valid_record, 'costUSD': value} for value in
                       (True, -1, float('nan'), float('inf'), '0', [], {'billing': 'private'})]
        for raw in candidates:
            with self.subTest(raw=raw):
                self.source.write_text(json.dumps(raw))
                self.assert_failure_preserves()
        for cost in (None, 0, 0.25):
            raw = {**self.valid_record, 'score': 1/3, 'costUSD': cost}
            export.validate_record(raw)

    def test_nullable_environment_score_and_optional_checks_preserved(self):
        row = {**self.valid_record, 'status': 'environment_invalid', 'scoreExact': None, 'items': None, 'regressions': None}
        self.source.write_text(json.dumps(row))
        self.assertEqual(self.run_export().returncode, 0)
        result = json.loads(self.target.read_text())
        for field in ('scoreExact', 'items', 'regressions'):
            self.assertIsNone(result[0][field])


if __name__ == '__main__':
    unittest.main()
