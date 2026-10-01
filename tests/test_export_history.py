import importlib.util
import hashlib
import json
import os
import shutil
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
        public_records = json.loads((SCRIPT.parents[1] / 'results/historical-records.json').read_text(encoding='utf-8'))
        self.run_ids = [row['runId'] for row in public_records]
        self.manifest_hashes = {(row['questionId'], row['revision']): row['manifestSha256'] for row in public_records}
        self.valid_record = {k: 'fixture' for k in export.IDENTITY}
        self.valid_record.update(runId=self.run_ids[0], manifestSha256=self.manifest_hashes['task-switch-cache', 'v1'], status='graded', scoreExact='1/3',
                                 configurationId='gpt-6-astra / codex / medium', model='gpt-6-astra',
                                 harness='codex', effort='medium', questionId='task-switch-cache', revision='v1', sampleKind='independent')
        self.source.write_text(json.dumps({**self.valid_record, 'scoreExact': '1/3', 'items': {'D01a': True}, 'regressions': {'R01': False}, 'privateNote': 'SECRET'}))
        for index, run_id in enumerate(self.run_ids[1:]):
            self.source.with_name(f'record-{index:03}.json').write_text(json.dumps({**self.valid_record, 'runId': run_id}))
        for name in export.REPORTS:
            p = self.archive / 'reports' / name / 'summary.json'
            p.parent.mkdir(parents=True)
            identity = json.loads((SCRIPT.parents[1] / 'reports' / name / 'summary.json').read_text(encoding='utf-8'))
            p.write_text(json.dumps({'status': 'complete', **{k: identity[k] for k in ('model','effort','suite','condition')}, 'fast': False,
                                    'timeLimitInPrompt': False, 'completedAt': '2026-09-24T00:00:00Z',
                                    'maximum': 7, 'totalExact': '7/3', 'total': 7/3,
                                    'meanExact': '1/3', 'mean': 1/3,
                                    'questions': [{'question': q, 'scoreExact': '1/3', 'failedItems': []} for q in export.FAILED_IDS], 'secret': 'SECRET'}))
        self.target = self.output / 'results/historical-records.json'
        self.target.parent.mkdir(parents=True)
        self.target.write_text('existing results')

    def run_export(self, output=None):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.archive), str(output or self.output)], capture_output=True)

    def assert_failure_preserves(self, output=None, with_summaries=False):
        if with_summaries:
            for name in export.REPORTS:
                target = self.output / 'reports' / name / 'summary.json'
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('existing summary')
        before = {p: p.read_bytes() for p in self.archive.rglob('*.json')}
        public_before = {p: p.read_bytes() for p in self.output.rglob('*.json')}
        self.assertNotEqual(self.run_export(output).returncode, 0)
        self.assertEqual(self.target.read_text(), 'existing results')
        self.assertEqual(before, {p: p.read_bytes() for p in self.archive.rglob('*.json')})
        self.assertEqual(public_before, {p: p.read_bytes() for p in self.output.rglob('*.json')})

    def test_valid_export(self):
        self.assertEqual(self.run_export().returncode, 0)
        result = json.loads(self.target.read_text())[0]
        self.assertEqual(result['scoreExact'], '1/3')
        self.assertEqual(result['items'], {'D01a': True})
        self.assertNotIn('SECRET', self.target.read_text())

    def test_unknown_sample_kind_preserves_all_files(self):
        for status in ('graded', 'environment_invalid'):
            for kind in ('unknown', 'independant', 'Independent', ' historical_import', 'reassessment ', 'assisted-revision'):
                with self.subTest(status=status, kind=kind):
                    raw = {**self.valid_record, 'status': status, 'sampleKind': kind,
                           'scoreExact': None if status == 'environment_invalid' else '1/3'}
                    self.source.write_text(json.dumps(raw))
                    self.target.write_text('existing results')
                    self.assert_failure_preserves(with_summaries=True)

    def test_unknown_sample_kind_does_not_create_output(self):
        self.source.write_text(json.dumps({**self.valid_record, 'sampleKind': 'unknown'}))
        fresh = self.root / 'fresh-output'
        self.assert_failure_preserves(fresh, with_summaries=True)
        self.assertFalse(fresh.exists())

    def test_sealed_sample_kinds_preserved(self):
        for status in ('graded', 'environment_invalid'):
            for kind in ('independent', 'historical_import', 'reassessment', 'assisted_revision'):
                with self.subTest(status=status, kind=kind):
                    raw = {**self.valid_record, 'status': status, 'sampleKind': kind,
                           'scoreExact': None if status == 'environment_invalid' else '1/3'}
                    self.source.write_text(json.dumps(raw))
                    before = {p: p.read_bytes() for p in self.archive.rglob('*.json')}
                    result = self.run_export()
                    self.assertEqual(result.returncode, 0, result.stderr)
                    exported = next(row for row in json.loads(self.target.read_text()) if row['runId'] == raw['runId'])
                    self.assertEqual({key: exported[key] for key in raw}, raw)
                    self.assertEqual(before, {p: p.read_bytes() for p in self.archive.rglob('*.json')})

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
        for output in (alias, alias / 'export'):
            with self.subTest(output=output):
                self.assert_failure_preserves(output)

    def test_selected_output_root_and_ancestor_aliases(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.output, target_is_directory=True)
        ancestor = self.root / 'ancestor'
        ancestor.symlink_to(self.root, target_is_directory=True)
        before = {p: p.read_bytes() for p in self.archive.rglob('*.json')}
        for output in (alias, ancestor / self.output.name):
            with self.subTest(output=output):
                result = self.run_export(output)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(json.loads(self.target.read_text())), 346)
                self.assertEqual(before, {p: p.read_bytes() for p in self.archive.rglob('*.json')})
                for name in export.REPORTS:
                    self.assertTrue((self.output / 'reports' / name / 'summary.json').is_file())

    def test_derived_symlinks_to_independent_tree_preserve_both_outputs(self):
        external = self.root / 'independent'
        external.mkdir()
        sentinel = external / 'sentinel.json'
        sentinel.write_text('independent content')
        linked_directory = self.output / 'reports'
        linked_directory.symlink_to(external, target_is_directory=True)
        self.assert_failure_preserves()
        self.assertEqual(list(external.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), 'independent content')
        linked_directory.unlink()
        self.target.unlink()
        self.target.symlink_to(sentinel)
        before = {p: p.read_bytes() for p in self.archive.rglob('*.json')}
        self.assertNotEqual(self.run_export().returncode, 0)
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(sentinel.read_text(), 'independent content')
        self.assertEqual(before, {p: p.read_bytes() for p in self.archive.rglob('*.json')})

    def test_nested_symlink(self):
        (self.output / 'reports').symlink_to(self.archive / 'reports', target_is_directory=True)
        self.assert_failure_preserves()

    def test_archive_aliases_cannot_be_replaced_by_any_export(self):
        for family in ('record', 'summary'):
            for directory_alias, case_alias in ((False, False), (True, False), (False, True), (True, True)):
                for destination_index in range(4):
                    # A summary-directory alias retains the summary.json filename.
                    if family == 'summary' and directory_alias and destination_index == 0:
                        continue
                    with self.subTest(family=family, directory_alias=directory_alias, case_alias=case_alias, destination=destination_index), tempfile.TemporaryDirectory(dir=self.root) as temporary:
                        root = Path(temporary)
                        archive, output = root / 'private', root / 'public'
                        shutil.copytree(self.archive, archive)
                        destinations = [output / 'results/historical-records.json',
                                        *(output / 'reports' / name / 'summary.json' for name in export.REPORTS)]
                        for destination in destinations:
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            destination.write_text('existing export')
                        source = (archive / 'question-bank/results/one.json' if family == 'record'
                                  else archive / 'reports' / export.REPORTS[0] / 'summary.json')
                        destination = destinations[destination_index]
                        if directory_alias:
                            parent = source.parent
                            for child in parent.iterdir():
                                child.replace(destination if child == source else destination.parent / child.name)
                            parent.rmdir()
                            alias = parent
                        else:
                            source.replace(destination)
                            alias = source
                        alias_target = destination.parent if directory_alias else destination
                        if case_alias:
                            alias_target = alias_target.with_name(alias_target.name.upper())
                            if not alias_target.exists():
                                self.skipTest('case-insensitive filesystem required for spelling aliases')
                        alias.symlink_to(alias_target, target_is_directory=directory_alias)
                        before = {p: p.read_bytes() for p in root.rglob('*.json')}
                        paths = set(root.rglob('*'))
                        result = subprocess.run([sys.executable, str(SCRIPT), str(archive), str(output)], capture_output=True)
                        self.assertNotEqual(result.returncode, 0, result.stderr)
                        self.assertIn(b'Output destination resolves to an input source', result.stderr)
                        self.assertEqual(before, {p: p.read_bytes() for p in root.rglob('*.json')})
                        self.assertEqual(paths, set(root.rglob('*')))
                        self.assertTrue(alias.is_symlink())

    def test_archive_aliases_to_independent_sources_remain_supported(self):
        external = self.root / 'independent'
        external.mkdir()
        sources = [self.source.parent, self.archive / 'reports' / export.REPORTS[0],
                   self.archive / 'reports' / export.REPORTS[1] / 'summary.json']
        for index, source in enumerate(sources):
            target = external / str(index)
            directory = source.is_dir()
            source.rename(target)
            source.symlink_to(target, target_is_directory=directory)
        before = {p: p.read_bytes() for p in external.rglob('*') if p.is_file()}
        result = self.run_export()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads(self.target.read_text())), 346)
        self.assertEqual(before, {p: p.read_bytes() for p in external.rglob('*') if p.is_file()})

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
        for source in self.source.parent.glob('*.json'):
            source.unlink()
        self.assert_failure_preserves()

    def test_one_missing_sealed_record_preserves_all_outputs(self):
        self.source.unlink()
        self.assert_failure_preserves(with_summaries=True)

    def test_only_one_sealed_record_preserves_all_outputs(self):
        for source in self.source.parent.glob('*.json'):
            if source != self.source:
                source.unlink()
        self.assert_failure_preserves(with_summaries=True)

    def test_same_count_wrong_run_id_preserves_all_outputs(self):
        self.source.write_text(json.dumps({**self.valid_record, 'runId': 'unreviewed-replacement'}))
        self.assert_failure_preserves(with_summaries=True)

    def test_extra_run_id_preserves_all_outputs(self):
        self.source.with_name('extra.json').write_text(json.dumps({**self.valid_record, 'runId': 'unreviewed-addition'}))
        self.assert_failure_preserves(with_summaries=True)

    def test_complete_set_accepts_renamed_source_files(self):
        self.source.rename(self.source.with_name('z-renamed.json'))
        result = self.run_export()
        self.assertEqual(result.returncode, 0, result.stderr)
        records = json.loads(self.target.read_text())
        self.assertEqual({row['runId'] for row in records}, set(self.run_ids))
        self.assertEqual(len(records), 346)

    def test_missing_last_summary(self):
        (self.archive / 'reports' / export.REPORTS[-1] / 'summary.json').unlink()
        self.assert_failure_preserves()

    def test_nested_unreviewed_fields(self):
        for field, key in (('items', 'D01a'), ('regressions', 'R01')):
            for value in ({key: 'SECRET'}, {'private/path': True}, {key: {'details': 'SECRET'}}, ['SECRET']):
                with self.subTest(field=field, value=value):
                    self.source.write_text(json.dumps({**self.valid_record, field: value}))
                    self.assert_failure_preserves()

    def test_existing_public_checks_accepted_without_change(self):
        records = json.loads((SCRIPT.parents[1] / 'results/historical-records.json').read_text())
        for row in records:
            for field in ('items', 'regressions'):
                if field in row:
                    self.assertEqual(export.checks(row, field), row[field])

    def test_mismatched_manifest_hashes_preserve_all_outputs(self):
        rubrics = sorted(self.manifest_hashes)
        for index, (question, revision) in enumerate(rubrics):
            other_hash = self.manifest_hashes[rubrics[(index + 1) % len(rubrics)]]
            for manifest_hash in ('0' * 64, other_hash):
                for status in ('graded', 'environment_invalid'):
                    with self.subTest(question=question, revision=revision, hash=manifest_hash, status=status):
                        raw = {**self.valid_record, 'questionId': question, 'revision': revision,
                               'manifestSha256': manifest_hash, 'status': status,
                               'scoreExact': None if status == 'environment_invalid' else '1/3'}
                        self.source.write_text(json.dumps(raw))
                        self.assert_failure_preserves(with_summaries=True)

    def test_manifest_mismatch_does_not_create_output_tree(self):
        output = self.root / 'not-created' / 'public'
        self.source.write_text(json.dumps({**self.valid_record, 'manifestSha256': '0' * 64}))
        self.assert_failure_preserves(output)
        self.assertFalse(output.parent.exists())

    def test_contradictory_configuration_fields_preserve_all_outputs(self):
        for model in ('gpt-6-astra', 'moonshot/kimi-k3'):
            for separator in (' / ', '/', '|'):
                valid = {**self.valid_record, 'model': model,
                         'configurationId': separator.join((model, 'codex', 'medium'))}
                for field in ('configurationId', 'model', 'harness', 'effort'):
                    with self.subTest(model=model, separator=separator, field=field):
                        self.source.write_text(json.dumps({**valid, field: 'other-' + valid[field]}))
                        self.assert_failure_preserves(with_summaries=True)

    def test_legacy_configuration_formats_preserve_original_strings(self):
        for model in ('gpt-6-astra', 'moonshot/kimi-k3'):
            for separator in (' / ', '/', '|'):
                with self.subTest(model=model, separator=separator):
                    raw = {**self.valid_record, 'model': model,
                           'configurationId': separator.join((model, 'codex', 'medium'))}
                    self.source.write_text(json.dumps(raw))
                    result = self.run_export()
                    self.assertEqual(result.returncode, 0, result.stderr)
                    row = next(r for r in json.loads(self.target.read_text()) if r['runId'] == raw['runId'])
                    self.assertEqual({k: row[k] for k in raw}, raw)

    def test_checks_from_other_questions_or_revisions_preserve_all_outputs(self):
        cases = [
            ('task-switch-cache', 'v1', 'V01core', 'B01'),
            ('task-switch-cache', 'v2', 'D01a', 'B01'),
            ('task-switch-cache', 'v2.1', 'D01a', 'B01'),
            ('remote-files-bughunt', 'v1', 'B01', 'R01'),
            ('remote-files-bughunt', 'v2', 'B01', 'R02'),
            ('remote-files-bughunt', 'v3', 'V05core', 'R04'),
            *((q, 'legacy-normalized-v1', 'B01', 'R01') for q in
              ('audio', 'composer', 'island', 'mobile-stream-order', 'recovery')),
        ]
        for question, revision, item_id, regression_id in cases:
            for field, key in (('items', item_id), ('regressions', regression_id)):
                with self.subTest(question=question, revision=revision, field=field, key=key):
                    raw = {**self.valid_record, 'questionId': question, 'revision': revision,
                           'manifestSha256': self.manifest_hashes[question, revision], field: {key: True}}
                    self.source.write_text(json.dumps(raw))
                    self.assert_failure_preserves(with_summaries=True)
        for question, revision in (('unknown', 'v1'), ('task-switch-cache', 'unknown')):
            for diagnostics in ({}, {'items': None}, {'items': {}}):
                with self.subTest(question=question, revision=revision, diagnostics=diagnostics):
                    self.source.write_text(json.dumps({**self.valid_record, 'questionId': question,
                                                      'revision': revision, **diagnostics}))
                    self.assert_failure_preserves(with_summaries=True)

    def test_known_rubrics_preserve_optional_checks_and_subsets(self):
        cases = [
            ('task-switch-cache', 'v1', {'D01a': True}, {'R04': False}),
            ('task-switch-cache', 'v2', {'V07guard': False}, {'R02': True}),
            ('task-switch-cache', 'v2.1', {'V07edge': True}, {'R03': False}),
            ('remote-files-bughunt', 'v2', {'V04guard': True}, {'B03b': False}),
            ('remote-files-bughunt', 'v3', {'B03b': True}, {'R03': False}),
            ('remote-files-bughunt', 'v1', {}, {}),
            *((q, 'legacy-normalized-v1', {}, {}) for q in
              ('audio', 'composer', 'island', 'mobile-stream-order', 'recovery')),
        ]
        for question, revision, items, regressions in cases:
            for diagnostics in ({}, {'items': None, 'regressions': None},
                                {'items': items, 'regressions': regressions}):
                with self.subTest(question=question, revision=revision, diagnostics=diagnostics):
                    raw = {**self.valid_record, 'questionId': question, 'revision': revision,
                           'manifestSha256': self.manifest_hashes[question, revision], **diagnostics}
                    self.source.write_text(json.dumps(raw))
                    result = self.run_export()
                    self.assertEqual(result.returncode, 0, result.stderr)
                    row = next(r for r in json.loads(self.target.read_text()) if r['runId'] == raw['runId'])
                    self.assertEqual({k: row[k] for k in raw}, raw)
                    for field in ('items', 'regressions'):
                        self.assertEqual(field in row, field in raw)

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
        valid = json.loads(target.read_text())
        for value in (None, 'I04', {}, [False], [['I04']], ['/private/path'], ['token=SECRET'], ['C09']):
            with self.subTest(value=value):
                raw = json.loads(json.dumps(valid))
                next(row for row in raw['questions'] if row['question'] == 'island')['failedItems'] = value
                target.write_text(json.dumps(raw))
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
            export.validate_summary(raw, name)
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
        self.assert_failure_preserves()
        copy.unlink()
        # Matching file count must not permit one sealed ID to replace another.
        raw['runId'] = self.run_ids[1]
        self.source.write_text(json.dumps(raw))
        self.assert_failure_preserves()

    def test_optional_record_metadata_rejected_before_writes(self):
        for field in ('startUtc', 'endUtc', 'timeSource'):
            invalid = [[], {'diagnostic': 'SECRET'}, True, 12]
            if field != 'timeSource':
                invalid += ['not a timestamp', '2026-09-24T00:00:00']
            for value in invalid:
                with self.subTest(field=field, value=value):
                    self.source.write_text(json.dumps({**self.valid_record, field: value}))
                    self.assert_failure_preserves()
        for metadata in ({}, {'startUtc': None, 'endUtc': None, 'timeSource': None},
                         {'startUtc': '2026-09-24T00:00:00Z', 'endUtc': '2026-09-24T01:00:00+00:00',
                          'timeSource': 'Worker reported UTC timestamps'}):
            self.source.write_text(json.dumps({**self.valid_record, **metadata}))
            self.assertEqual(self.run_export().returncode, 0)
            row = json.loads(self.target.read_text())[0]
            for field in ('startUtc', 'endUtc', 'timeSource'):
                self.assertEqual(field in row, field in metadata)
                self.assertEqual(row.get(field), metadata.get(field))

    def test_duplicate_failed_ids_rejected_before_writes(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(target.read_text())
        for question, ids in export.FAILED_IDS.items():
            if not ids:
                continue
            raw = json.loads(json.dumps(valid))
            row = next(q for q in raw['questions'] if q['question'] == question)
            row['failedItems'] = [sorted(ids)[0]] * 2
            target.write_text(json.dumps(raw))
            with self.subTest(question=question):
                self.assert_failure_preserves()

    def test_reversed_timestamps_preserve_all_outputs(self):
        for status in ('graded', 'environment_invalid'):
            for start, end in (
                ('2026-09-24T00:00:00Z', '2026-09-23T23:59:59Z'),
                ('2026-09-24T00:00:00-02:00', '2026-09-24T01:00:00Z'),
                ('2026-09-24T01:00:00Z', '2026-09-24T02:00:00+02:00'),
                ('2026-09-24T00:00:00.002Z', '2026-09-24T00:00:00.001Z'),
            ):
                with self.subTest(status=status, start=start, end=end):
                    self.source.write_text(json.dumps({**self.valid_record, 'status': status,
                                                      'scoreExact': None if status == 'environment_invalid' else '1/3',
                                                      'startUtc': start, 'endUtc': end}))
                    self.assert_failure_preserves(with_summaries=True)

    def test_timestamp_order_preserves_original_offsets_and_missing_values(self):
        for metadata in (
            {'startUtc': '2026-09-24T00:00:00Z', 'endUtc': '2026-09-24T00:00:00+00:00'},
            {'startUtc': '2026-09-24T02:00:00+02:00', 'endUtc': '2026-09-24T00:00:00Z'},
            {'startUtc': '2026-09-24T00:00:00+02:00', 'endUtc': '2026-09-23T23:00:00Z'},
            {'startUtc': '2026-09-24T00:00:00Z', 'endUtc': '2026-09-24T00:00:00.001Z'},
            {'startUtc': None, 'endUtc': '2026-09-24T00:00:00Z'},
            {'startUtc': '2026-09-24T00:00:00Z', 'endUtc': None},
            {'startUtc': '2026-09-24T00:00:00Z'},
            {'endUtc': '2026-09-24T00:00:00Z'},
        ):
            with self.subTest(metadata=metadata):
                self.source.write_text(json.dumps({**self.valid_record, **metadata}))
                result = self.run_export()
                self.assertEqual(result.returncode, 0, result.stderr)
                row = next(r for r in json.loads(self.target.read_text()) if r['runId'] == self.valid_record['runId'])
                for field in ('startUtc', 'endUtc'):
                    self.assertEqual(field in row, field in metadata)
                    self.assertEqual(row.get(field), metadata.get(field))

    def test_perfect_scores_with_failed_items_preserve_all_outputs(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(target.read_text())
        for question, ids in export.FAILED_IDS.items():
            if not ids:
                continue
            for exact in ('1', '1/1', '1.0', '2/2'):
                with self.subTest(question=question, exact=exact):
                    raw = json.loads(json.dumps(valid))
                    row = next(q for q in raw['questions'] if q['question'] == question)
                    row.update(scoreExact=exact, failedItems=[sorted(ids)[0]])
                    raw.update(totalExact='3', total=3, meanExact='3/7', mean=3/7)
                    target.write_text(json.dumps(raw))
                    self.assert_failure_preserves(with_summaries=True)

    def test_perfect_scores_without_failed_items_preserve_all_questions(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        raw = json.loads(target.read_text())
        for index, row in enumerate(raw['questions']):
            row.update(scoreExact=('1', '1/1', '1.0', '2/2')[index % 4], score=1, failedItems=[])
        raw.update(totalExact='7', total=7, meanExact='1', mean=1)
        target.write_text(json.dumps(raw))
        result = self.run_export()
        self.assertEqual(result.returncode, 0, result.stderr)
        published = json.loads((self.output / 'reports' / export.REPORTS[-1] / 'summary.json').read_text())
        self.assertEqual(published['questions'], raw['questions'])

    def test_report_identity_mismatch_preserves_all_outputs(self):
        originals = {name: (self.archive / 'reports' / name / 'summary.json').read_bytes() for name in export.REPORTS}
        for name in export.REPORTS:
            target = self.output / 'reports' / name / 'summary.json'
            target.parent.mkdir(parents=True)
            target.write_text('existing summary')
        before = {p: p.read_bytes() for p in self.output.rglob('*.json')}
        for destination in export.REPORTS:
            target = self.archive / 'reports' / destination / 'summary.json'
            valid = json.loads(originals[destination])
            candidates = [json.loads(data) for name, data in originals.items() if name != destination]
            candidates += [{**valid, field: value} for field, value in (
                ('model', 'another-model'), ('effort', 'another-effort'), ('suite', 'another-suite'),
                ('condition', 'another-condition'), ('fast', True), ('timeLimitInPrompt', True))]
            for raw in candidates:
                with self.subTest(destination=destination, raw=raw):
                    target.write_text(json.dumps(raw))
                    self.assert_failure_preserves()
                    self.assertEqual(before, {p: p.read_bytes() for p in self.output.rglob('*.json')})
            target.write_bytes(originals[destination])

    def test_optional_summary_text_shapes_preserve_outputs(self):
        target = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(target.read_text())
        for name in export.REPORTS:
            existing = self.output / 'reports' / name / 'summary.json'
            existing.parent.mkdir(parents=True)
            existing.write_text('existing summary')
        for field in ('name', 'executionChannel', 'limitations', 'promptNormalization'):
            values = (None, False, 12, {'privateNote': 'SECRET'}, ['SECRET'])
            if field == 'limitations':
                values = (None, False, 12, 'SECRET', [{'privateNote': 'SECRET'}], [12], [['SECRET']])
            for value in values:
                with self.subTest(field=field, value=value):
                    raw = json.loads(json.dumps(valid))
                    container = raw['questions'][0] if field in ('name', 'executionChannel') else raw
                    container[field] = value
                    target.write_text(json.dumps(raw))
                    self.assert_failure_preserves()
        # Optional fields stay absent, or retain their exact reviewed strings and order.
        for present in (False, True):
            raw = json.loads(json.dumps(valid))
            if present:
                raw.update(limitations=['reviewed note', ''], promptNormalization='reviewed normalization')
                raw['questions'][0].update(name='中文题目', executionChannel='Orca Worker')
            target.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')
            result = self.run_export()
            self.assertEqual(result.returncode, 0, result.stderr)
            published = json.loads((self.output / 'reports' / export.REPORTS[-1] / 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual(published['questions'], raw['questions'])
            for field in ('limitations', 'promptNormalization'):
                self.assertEqual(field in published, field in raw)
                self.assertEqual(published.get(field), raw.get(field))

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

    def test_environment_invalid_scores_preserve_all_outputs(self):
        scores = [{'scoreExact': exact, **numeric}
                  for exact, value in (('0', 0), ('1/3', 1/3), ('1', 1))
                  for numeric in ({}, {'score': None}, {'score': value})]
        scores += [{'scoreExact': None, 'score': value} for value in (0, 1/3, 1)]
        for fields in scores:
            with self.subTest(fields=fields):
                self.target.write_text('existing results')
                self.source.write_text(json.dumps({**self.valid_record, 'status': 'environment_invalid', **fields}))
                self.assert_failure_preserves(with_summaries=True)

    def test_environment_invalid_score_does_not_create_output_tree(self):
        output = self.root / 'not-created' / 'public'
        self.source.write_text(json.dumps({**self.valid_record, 'status': 'environment_invalid', 'scoreExact': '0', 'score': 0}))
        self.assert_failure_preserves(output)
        self.assertFalse(output.parent.exists())

    def test_scored_records_and_summary_questions_preserve_score_representations(self):
        summary = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(summary.read_text())
        for exact, value, total in (('0', 0, '0'), ('1/3', 1/3, '7/3'), ('1', 1, '7')):
            for numeric in ({}, {'score': None}, {'score': value}):
                with self.subTest(exact=exact, numeric=numeric):
                    raw = {**self.valid_record, 'scoreExact': exact, **numeric}
                    self.source.write_text(json.dumps(raw))
                    report = json.loads(json.dumps(valid))
                    for row in report['questions']:
                        row.update(scoreExact=exact, **numeric)
                    report.update(totalExact=total, total=value*7, meanExact=exact, mean=value)
                    summary.write_text(json.dumps(report))
                    result = self.run_export()
                    self.assertEqual(result.returncode, 0, result.stderr)
                    published = next(r for r in json.loads(self.target.read_text()) if r['runId'] == raw['runId'])
                    self.assertEqual({k: published[k] for k in raw}, raw)
                    self.assertEqual('score' in published, 'score' in numeric)
                    published_summary = json.loads((self.output / 'reports' / export.REPORTS[-1] / 'summary.json').read_text())
                    self.assertEqual(published_summary['questions'], report['questions'])

    def test_required_exact_scores_remain_required(self):
        for status in ('graded', 'environment_invalid'):
            for fields in ({}, {'score': None}, {'scoreExact': None, 'score': None}):
                if status == 'environment_invalid' and 'scoreExact' in fields:
                    continue  # This is the valid unscored representation.
                with self.subTest(status=status, fields=fields):
                    raw = {k: v for k, v in self.valid_record.items() if k != 'scoreExact'}
                    self.source.write_text(json.dumps({**raw, 'status': status, **fields}))
                    self.assert_failure_preserves(with_summaries=True)
        self.source.write_text(json.dumps(self.valid_record))
        summary = self.archive / 'reports' / export.REPORTS[-1] / 'summary.json'
        valid = json.loads(summary.read_text())
        for missing in (True, False):
            with self.subTest(summary_missing_exact=missing):
                raw = json.loads(json.dumps(valid))
                row = raw['questions'][0]
                if missing:
                    del row['scoreExact']
                else:
                    row['scoreExact'] = None
                summary.write_text(json.dumps(raw))
                self.assert_failure_preserves(with_summaries=True)

    def test_nullable_environment_score_and_optional_checks_preserved(self):
        for numeric in ({}, {'score': None}):
            with self.subTest(numeric=numeric):
                row = {**self.valid_record, 'status': 'environment_invalid', 'scoreExact': None,
                       'items': None, 'regressions': None, **numeric}
                self.source.write_text(json.dumps(row))
                result = self.run_export()
                self.assertEqual(result.returncode, 0, result.stderr)
                published = next(r for r in json.loads(self.target.read_text()) if r['runId'] == row['runId'])
                self.assertEqual({k: published[k] for k in row}, row)
                self.assertEqual('score' in published, 'score' in numeric)


if __name__ == '__main__':
    unittest.main()
