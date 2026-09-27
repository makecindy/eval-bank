"""Synthetic contracts; full Release calibration is a separate explicit command."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
REV = REPO / "scoring-revisions/candidate-failure-v1"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RevisionTests(unittest.TestCase):
    def test_frozen_adapters_apply_and_compile_without_changing_sources(self):
        adapters = load("adapters", REV / "adapters.py")
        suite = json.loads((REPO / "suites/seven-question-quality-v2.json").read_text())
        for entry in suite["questions"]:
            original = REPO / "questions" / entry["id"] / entry["revision"]
            before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in original.rglob("*") if p.is_file()}
            with self.subTest(question=entry["id"]), tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "question"
                shutil.copytree(original, target)
                adapters.apply(target, entry["id"])
                for p in target.rglob("*.py"):
                    compile(p.read_text(), str(p), "exec")
                with self.assertRaises(ValueError):
                    adapters.replace(target, "question.json", "missing frozen anchor", "replacement")
            self.assertEqual(before, {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in before})

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.q = Path(self.tmp.name).resolve() / "question"
        self.q.mkdir()
        self.spec = {"id": "fixture", "revision": "v1-cf1", "scoringVersion": "fixture+candidate-failure-v1",
                     "groups": [{"id": "a", "items": ["A"], "mode": "all", "weight": "1"}]}
        (self.q / "question.json").write_text(json.dumps(self.spec))
        self.grade = load("grade", REV / "grade.py")
        self.grade.Q = self.q

    def invoke(self, results):
        output = Path(self.tmp.name) / "new-result.json"
        with patch.object(sys, "argv", ["grade", str(self.q / "candidate"), str(output), "--closure-sha256", "a" * 64]), \
                patch.object(self.grade, "verify_closure", return_value={"sourceKey": "fixture@v1"}), \
                patch.object(self.grade, "run", side_effect=results), contextlib.redirect_stdout(io.StringIO()):
            self.grade.main()
        return json.loads(output.read_text())

    def test_healthy_environment_preserves_partial_candidate_result(self):
        health = {"status": "graded", "score": 1}
        candidate = {"status": "graded", "score": 0.5, "items": {"A": False, "B": True}}
        result = self.invoke([health, candidate, health])
        self.assertEqual(result["score"], 0.5)
        self.assertTrue(result["items"]["B"])
        self.assertEqual(result["scoringRevision"], "candidate-failure-v1")

    def test_reference_failure_never_becomes_candidate_zero(self):
        result = self.invoke([{"status": "environment_invalid", "score": None}])
        self.assertIsNone(result["score"])
        self.assertTrue(result["manualReviewRequired"])
        self.assertEqual(result["failureCategory"], "reference_health")

    def test_postflight_failure_invalidates_candidate_score(self):
        result = self.invoke([{"status": "graded", "score": 1}, {"status": "graded", "score": 0},
                              {"status": "graded", "score": 0.5}])
        self.assertIsNone(result["score"])

    def test_process_timeout_never_becomes_candidate_zero(self):
        with patch.object(self.grade, "run", side_effect=subprocess.TimeoutExpired("fixture", 1)):
            # invoke installs its own run mock; use an exception side effect entry.
            result = self.invoke([subprocess.TimeoutExpired("fixture", 1)])
        self.assertIsNone(result["score"])
        self.assertTrue(result["manualReviewRequired"])

    def test_existing_score_is_never_overwritten(self):
        output = Path(self.tmp.name) / "old.json"
        output.write_text('{"score":0.75}')
        with patch.object(sys, "argv", ["grade", str(self.q), str(output), "--closure-sha256", "a" * 64]):
            with self.assertRaises(FileExistsError):
                self.grade.main()
        self.assertEqual(output.read_text(), '{"score":0.75}')

    def test_submission_links_rejected_before_grader_execution(self):
        source = self.q / "source"
        source.mkdir()
        outside = self.q / "reference"
        outside.mkdir()
        (outside / "code.js").write_text("reference")
        for target in (outside / "code.js", outside, outside / "missing"):
            link = source / "editable"
            link.symlink_to(target, target_is_directory=target.is_dir())
            with patch.object(self.grade.subprocess, "run") as launch:
                self.assertEqual(self.grade.run(source, self.q / "result")["failureCategory"], "submission_input")
                launch.assert_not_called()
            link.unlink()
        alias = self.q / "alias"
        alias.symlink_to(source, target_is_directory=True)
        child = source / "child"
        child.mkdir()
        for candidate in (alias, alias / "child", self.q / "missing"):
            with patch.object(self.grade.subprocess, "run") as launch:
                self.assertIsNone(self.grade.run(candidate, self.q / "result")["score"])
                launch.assert_not_called()

    def test_calibration_rejects_partial_credit_and_passing_affected_items(self):
        calibration = load("calibration", REPO / "scripts/calibrate-scoring-revision.py")
        good = {"status": "graded", "score": 0, "items": {"A": False}}
        calibration.require_full_failure(good, self.spec)
        for result in ({**good, "score": 0.9}, {**good, "items": {"A": True}},
                       {**good, "items": {}}, {**good, "items": {"A": 0}},
                       {**good, "status": "environment_invalid"}, {**good, "score": False}):
            with self.assertRaises(RuntimeError):
                calibration.require_full_failure(result, self.spec)

    def test_checker_protocol_rejects_appended_forgery_and_nonzero_exit(self):
        adapters = load("evidence_adapters", REV / "adapters.py")
        for ident, version in (("remote-files-bughunt", "v4"), ("task-switch-cache", "v3")):
            target = self.q / ident
            shutil.copytree(REPO / "questions" / ident / version, target)
            adapters.apply(target, ident)
            # Run the transformed production parser block with actual child
            # stdout, including an exit handler appending a forged success.
            import ast
            tree = ast.parse((target / "author/grade_impl.py").read_text())
            node = next(n for n in ast.walk(tree) if isinstance(n, ast.Try)
                        and any(isinstance(x, ast.Assign) and isinstance(x.value, ast.Call)
                                and isinstance(x.value.func, ast.Attribute) and x.value.func.attr == "loads"
                                for x in n.body))
            parser = compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), "evidence", "exec")
            for mode in ("healthy", "append", "nonzero", "wrong-id", "wrong-type"):
                child = subprocess.run([sys.executable, "-c", '''import atexit,json,sys
mode=sys.argv[1]
if mode=='append':atexit.register(lambda: print(json.dumps({'id':'case','pass':True})))
print(json.dumps({'id':'other' if mode=='wrong-id' else 'case','pass':1 if mode=='wrong-type' else False}))
sys.exit(2 if mode=='nonzero' else 0)
''', mode], capture_output=True, text=True, check=False)
                scope = dict(json=json, r=child, p=child, ident="case", case="case")
                exec(parser, scope)
                row = scope["row" if ident == "remote-files-bughunt" else "o"]
                self.assertIs(row["pass"], False)
                self.assertEqual(bool(row.get("environment_invalid")), mode != "healthy")

    def test_changed_or_missing_runtime_rejected_before_execution(self):
        runtime = self.q / "node"
        runtime.write_text("pinned")
        (self.q / "scoring-closure.json").write_text(json.dumps({"files": {"node": hashlib.sha256(b"pinned").hexdigest()}}))
        expected = hashlib.sha256((self.q / "scoring-closure.json").read_bytes()).hexdigest()
        runtime.write_text("different")
        with self.assertRaises(ValueError):
            self.grade.verify_closure(expected)
        runtime.unlink()
        with self.assertRaises(FileNotFoundError):
            self.grade.verify_closure(expected)

    def test_malformed_or_incomplete_result_is_unscored(self):
        output = Path(self.tmp.name) / "raw.json"
        for result in ([1], {"status": "graded", "score": float("nan"), "items": {"A": True}},
                       {"status": "graded", "score": 1, "items": {}},
                       {"status": "graded", "score": 1, "items": {"A": 1}}):
            output.write_text(json.dumps(result))
            with patch.object(self.grade.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
                actual = self.grade.run(self.q, output)
            self.assertIsNone(actual["score"])
            self.assertEqual(actual["failureCategory"], "author_output")

    def test_real_child_cannot_replace_manifest_and_rehash_modified_checks(self):
        author = self.q / "author"
        author.mkdir()
        shutil.copyfile(REV / "grade.py", author / "grade.py")
        (self.q / "calibration-reference").mkdir()
        (self.q / "candidate").mkdir()
        (self.q / "trusted.txt").write_text("original checks")
        (author / "legacy_gate.py").write_text('''import hashlib, json, sys
from pathlib import Path
q = Path.cwd()
if Path(sys.argv[1]).name == "candidate":
    (q / "trusted.txt").write_text("forged checks")
    manifest = json.loads((q / "scoring-closure.json").read_text())
    manifest["files"]["trusted.txt"] = hashlib.sha256(b"forged checks").hexdigest()
    (q / "scoring-closure.json").write_text(json.dumps(manifest))
Path(sys.argv[2]).write_text(json.dumps({"status":"graded","score":1,"items":{"A":True}}))
''')
        manifest = {"sourceKey": "fixture@v1", "files": {
            p.relative_to(self.q).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.q.rglob("*") if p.is_file()}}
        closure = self.q / "scoring-closure.json"
        closure.write_text(json.dumps(manifest))
        expected = hashlib.sha256(closure.read_bytes()).hexdigest()
        healthy = Path(self.tmp.name) / "healthy.json"
        command = [sys.executable, "-B", str(author / "grade.py"),
                   str(self.q / "calibration-reference"), str(healthy)]
        missing = subprocess.run(command, capture_output=True, timeout=15)
        self.assertNotEqual(missing.returncode, 0)
        self.assertFalse(healthy.exists())
        subprocess.run(command + ["--closure-sha256", expected], check=True,
                       capture_output=True, timeout=15)
        self.assertEqual(json.loads(healthy.read_text())["score"], 1)
        output = Path(self.tmp.name) / "attack.json"
        subprocess.run([sys.executable, "-B", str(author / "grade.py"),
                        str(self.q / "candidate"), str(output), "--closure-sha256", expected],
                       check=True, capture_output=True, timeout=15)
        result = json.loads(output.read_text())
        self.assertIsNone(result["score"])
        self.assertTrue(result["manualReviewRequired"])
        self.assertNotEqual(hashlib.sha256(closure.read_bytes()).hexdigest(), expected)
        with self.assertRaises(ValueError):
            self.grade.verify_closure(expected)

    def test_nonzero_with_forged_candidate_output_is_not_scored(self):
        output = Path(self.tmp.name) / "raw.json"
        output.write_text(json.dumps({"status": "graded", "score": 0, "items": {"A": False}}))
        with patch.object(self.grade.subprocess, "run", return_value=subprocess.CompletedProcess([], 2)):
            self.assertIsNone(self.grade.run(self.q, output)["score"])

    def test_score_must_match_actual_items(self):
        output = Path(self.tmp.name) / "raw.json"
        output.write_text(json.dumps({"status": "graded", "score": 1, "items": {"A": False}}))
        with patch.object(self.grade.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)):
            self.assertEqual(self.grade.run(self.q, output)["failureCategory"], "author_output")

    def test_nonfinite_details_produce_complete_unscored_json(self):
        healthy = {"status": "graded", "score": 1}
        result = self.invoke([healthy, {"status": "graded", "score": 0, "details": {"value": float("nan")}}, healthy])
        self.assertIsNone(result["score"])
        self.assertEqual(result["failureCategory"], "author_output")

    def test_experimental_manifest_pins_sources_and_old_reference_overlays(self):
        manifest = json.loads((REV / "manifest.json").read_text())
        suite = json.loads((REPO / "suites/seven-question-candidate-failure-v1.json").read_text())
        self.assertEqual(hashlib.sha256((REV / "manifest.json").read_bytes()).hexdigest(), suite["scoringManifestSha256"])
        files = dict(manifest["sources"])
        for entry in manifest["questions"]:
            files.update(entry["referenceSources"])
            ident, old_revision = entry["sourceKey"].split("@")
            old = json.loads((REPO / "questions" / ident / old_revision / "question.json").read_text())
            self.assertEqual(old["groups"], entry["question"]["groups"])
        for path, expected in files.items():
            self.assertEqual(hashlib.sha256((REPO / path).read_bytes()).hexdigest(), expected, path)


if __name__ == "__main__":
    unittest.main()
