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
        self.source.write_text(json.dumps({'scoreExact': '1/3', 'items': {'B01': True}, 'regressions': {'R01': False}, 'privateNote': 'SECRET'}))
        for name in export.REPORTS:
            p = self.archive / 'reports' / name / 'summary.json'
            p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'totalExact': '1/3', 'questions': [{'scoreExact': '1/3'}], 'secret': 'SECRET'}))
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
            path.write_text(json.dumps({'questions': [{'name': '中文题目', 'scoreExact': '1/3'}]}, ensure_ascii=False), encoding='utf-8')
        env = {**os.environ, 'LC_ALL': 'C', 'LANG': 'C', 'PYTHONUTF8': '0', 'PYTHONCOERCECLOCALE': '0'}
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.archive), str(self.output)], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in export.REPORTS:
            value = json.loads((self.output / 'reports' / name / 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual(value['questions'][0], {'name': '中文题目', 'scoreExact': '1/3'})

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
                    self.source.write_text(json.dumps({field: value}))
                    self.assert_failure_preserves()

    def test_existing_public_checks_accepted_without_change(self):
        records = json.loads((SCRIPT.parents[1] / 'results/historical-records.json').read_text())
        for row in records:
            for field in export.CHECK_KEYS:
                if field in row:
                    self.assertEqual(export.checks(row, field), row[field])


if __name__ == '__main__':
    unittest.main()
