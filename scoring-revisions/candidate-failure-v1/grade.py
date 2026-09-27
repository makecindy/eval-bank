"""Explicit opt-in grading revision; old packages and results remain immutable.

Run only in a trusted, isolated execution environment. Integrity checks are not
an OS sandbox and do not make hostile candidate code safe to run on a workstation.
"""
import argparse
import hashlib
import json
import math
from fractions import Fraction
import os
from pathlib import Path
import subprocess
import sys
import tempfile

Q = Path(__file__).resolve().parent.parent


def invalid(category, reason):
    return {"status": "environment_invalid", "score": None,
            "scoreExact": None, "manualReviewRequired": True,
            "failureCategory": category, "reason": reason}


def verify_closure(expected_digest):
    raw = (Q / "scoring-closure.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_digest:
        raise ValueError("Changed closure manifest")
    manifest = json.loads(raw)
    for rel, expected in manifest["files"].items():
        path = Q / rel
        if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != Q.parent):
            raise ValueError("linked trusted input")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError("changed trusted input: " + rel)
    return manifest


def run(source, output):
    # Inspect the submitted tree before the frozen gate exempts editable paths.
    # This is admission validation, not protection against concurrent mutation.
    source = source.absolute()
    if (not source.is_dir() or any(p.is_symlink() for p in (source, *source.parents))
            or any(p.is_symlink() for p in source.rglob("*"))):
        return invalid("submission_input", "Linked or missing submission input")
    proc = subprocess.run(
        [sys.executable, "-B", str(Q / "author/legacy_gate.py"), str(source), str(output)],
        cwd=Q, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"),
        capture_output=True, text=True, timeout=960)
    if proc.returncode or not output.is_file():
        return invalid("author_or_environment", "Grader did not produce a complete result")
    result = json.loads(output.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        return invalid("author_output", "Invalid grader result shape")
    if result.get("status") != "graded":
        # Never infer candidate failure from stderr or an arbitrary nonzero exit.
        result.update(score=None, scoreExact=None, manualReviewRequired=True)
        result.setdefault("failureCategory", "author_environment_or_observability")
    else:
        score = result.get("score")
        items = result.get("items")
        groups = json.loads((Q / "question.json").read_text(encoding="utf-8"))["groups"]
        expected = {item for group in groups for item in group["items"]}
        if (type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1
                or not isinstance(items, dict) or not expected.issubset(items)
                or any(type(items[item]) is not bool for item in expected)):
            return invalid("author_output", "Incomplete or invalid graded result")
        total = Fraction(0)
        for group in groups:
            if group["mode"] == "ratio":
                fraction = Fraction(sum(items[item] for item in group["items"]), len(group["items"]))
            elif group["mode"] == "all":
                fraction = int(all(items[item] for item in group["items"]))
            else:
                return invalid("author_output", "Unknown frozen scoring mode")
            total += Fraction(group["weight"]) * fraction
        if abs(float(total) - score) > 1e-12 or (result.get("scoreExact") is not None and Fraction(result["scoreExact"]) != total):
            return invalid("author_output", "Score does not match frozen item weights")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--closure-sha256", required=True, help="Digest retained by the trusted caller at restoration, never recomputed from candidate-writable files")
    args = parser.parse_args()
    source, output = args.source.absolute(), args.output.resolve()
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing result")
    spec = json.loads((Q / "question.json").read_text(encoding="utf-8"))
    try:
        closure = verify_closure(args.closure_sha256)
        with tempfile.TemporaryDirectory(prefix="scoring-revision-") as tmp:
            tmp = Path(tmp)
            health = run(Q / "calibration-reference", tmp / "health.json")
            if health.get("status") != "graded" or health.get("score") != 1:
                result = invalid("reference_health", "Trusted reference did not pass all checks")
                result["referenceHealth"] = health
            else:
                result = run(source, tmp / "candidate.json")
                # A postflight failure invalidates the attempt, including results
                # that happened to look like candidate failures.
                verify_closure(args.closure_sha256)
                post = run(Q / "calibration-reference", tmp / "postflight.json")
                verify_closure(args.closure_sha256)
                if post.get("status") != "graded" or post.get("score") != 1:
                    result = invalid("reference_health", "Reference postflight failed")
                else:
                    result["referenceHealth"] = "passed-before-and-after"
        result["sourceKey"] = closure["sourceKey"]
        result["scoringManifestSha256"] = closure.get("scoringManifestSha256")
    except (OSError, ValueError, TypeError, KeyError, ArithmeticError, subprocess.TimeoutExpired) as exc:
        result = invalid("author_or_environment", type(exc).__name__)
    identity = dict(questionId=spec["id"], revision=spec["revision"], sourceKey=spec.get("sourceKey"),
                    scoringVersion=spec["scoringVersion"], scoringRevision="candidate-failure-v1")
    result.update(identity)
    try:
        encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    except (TypeError, ValueError):
        result = {**invalid("author_output", "Result is not finite JSON"), **identity}
        encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        stream.write(encoded + "\n")
    print(json.dumps({k: result.get(k) for k in
                      ("questionId", "revision", "status", "score", "failureCategory")}))


if __name__ == "__main__":
    main()
