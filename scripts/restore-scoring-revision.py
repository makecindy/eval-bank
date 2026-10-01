"""Restore candidate-failure-v1 in a NEW directory; never change the Release."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
REVISION = "candidate-failure-v1"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def restore(key, assets, output):
    ident, version = key.split("@")
    suite = json.loads((REPO / "suites/seven-question-quality-v2.json").read_text(encoding="utf-8"))
    if not any(q["id"] == ident and q["revision"] == version for q in suite["questions"]):
        raise ValueError("Not a supported frozen source key")
    original = REPO / "questions" / ident / version
    revision = REPO / "scoring-revisions" / REVISION
    contract = json.loads((revision / "manifest.json").read_text(encoding="utf-8"))
    entry = next(q for q in contract["questions"] if q["sourceKey"] == key)
    for rel, expected in {**contract["sources"], **entry["referenceSources"]}.items():
        if digest(REPO / rel) != expected:
            raise ValueError("Scoring revision source integrity mismatch: " + rel)
    # The Release restorer verifies all ZIP and file hashes before proceeding.
    subprocess.run([sys.executable, "-B", str(REPO / "scripts/restore-release.py"),
                    key, str(assets), str(output)], check=True)
    module_spec = importlib.util.spec_from_file_location("revision_adapters", revision / "adapters.py")
    adapters = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(adapters)
    adapters.apply(output, ident)
    shutil.copyfile(output / "author/grade.py", output / "author/legacy_gate.py")
    shutil.copyfile(revision / "grade.py", output / "author/grade.py")
    spec = json.loads((output / "question.json").read_text(encoding="utf-8"))
    spec.pop("legacyAdapter", None)
    spec.pop("supersedes", None)
    spec.update(revision=version + "-cf1", scoringRevision=REVISION,
                scoringVersion=spec["scoringVersion"] + "+" + REVISION,
                sourceKey=key, status="experimental",
                changeNote="Explicit candidate failure classification after reference health checks; opt-in only.")
    if spec != entry["question"]:
        raise ValueError("Derived question differs from the reviewed revision manifest")
    (output / "question.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    reference = output / "calibration-reference"
    shutil.copytree(output / "candidate", reference)
    overlay = original / "reference-overlay"
    if overlay.is_dir():
        for source in overlay.rglob("*"):
            if source.is_symlink():
                raise ValueError("Linked reference input")
            if source.is_file():
                target = reference / source.relative_to(overlay)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    elif (output / "reference/src").is_dir():
        shutil.copytree(output / "reference/src", reference / "src", dirs_exist_ok=True)
    else:
        raise ValueError("Missing reference implementation")
    # No candidate code was executed. Pin the complete derived trusted closure.
    files = {p.relative_to(output).as_posix(): digest(p)
             for p in sorted(output.rglob("*")) if p.is_file()}
    manifest = {"schemaVersion": 1, "sourceKey": key, "scoringRevision": REVISION,
                "scoringManifestSha256": digest(revision / "manifest.json"),
                "revisionSources": {p.name: digest(p) for p in (revision / "adapters.py", revision / "grade.py")},
                "files": files}
    (output / "scoring-closure.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("closure-sha256=" + digest(output / "scoring-closure.json"))
    print("Retain this digest outside the candidate execution domain before any candidate runs.")
    print("Restored experimental " + spec["revision"] + "; not selected as the default; no grading performed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("key", help="Frozen source key, e.g. composer@v2")
    parser.add_argument("assets", type=Path, help="Locally downloaded public Release ZIPs")
    parser.add_argument("output", type=Path, help="New destination (must not exist)")
    args = parser.parse_args()
    restore(args.key, args.assets.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
