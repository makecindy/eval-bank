import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

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
