"""Explicitly grade reference and baseline into new files; never regrade history."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import shutil
import tempfile

FAULT_TARGETS = {
    "audio": "pcm16k-worklet.js",
    "island": "apps/desktop/src/main/agent-island/state.ts",
    "recovery": "apps/desktop/src/main/maker-ipc/register.ts",
    "composer": "apps/desktop/src/renderer/components/new-chat/ChatInput.tsx",
    "mobile-stream-order": "apps/mobile/src/session/mobileHistoryRender.ts",
    "remote-files-bughunt": "src/cache/remote-file-cache.ts",
    "task-switch-cache": "src/entry.js",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("question", type=Path, help="Restored experimental question")
    parser.add_argument("output", type=Path, help="New calibration result directory")
    parser.add_argument("--fault-matrix", action="store_true", help="Also run synthetic syntax/load faults in copied reference code")
    args = parser.parse_args()
    q = args.question.resolve()
    spec = json.loads((q / "question.json").read_text(encoding="utf-8"))
    if spec.get("scoringRevision") != "candidate-failure-v1":
        raise ValueError("Expected an explicitly restored scoring revision")
    args.output.mkdir(parents=True, exist_ok=False)
    def grade(name, source):
        output = (args.output / (name + ".json")).resolve()
        subprocess.run([sys.executable, "-B", str(q / "author/grade.py"), str(source),
                        str(output)], check=True)
        return json.loads(output.read_text(encoding="utf-8"))

    reference = grade("reference", q / "calibration-reference")
    if reference.get("status") != "graded" or reference.get("score") != 1:
        raise RuntimeError("Reference health failed; stop calibration and investigate the new evidence")
    baseline = grade("baseline", q / "candidate")
    if baseline.get("status") != "graded":
        raise RuntimeError("Baseline is unscored; calibration is not complete")
    if args.fault_matrix:
        for name, suffix in [("syntax", "\nconst = ;\n"),
                             ("runtime", "\nthrow new Error('ENVIRONMENT_UNSUPPORTED: synthetic candidate failure');\n")]:
            with tempfile.TemporaryDirectory(prefix="scoring-mutant-") as tmp:
                source = Path(tmp) / "candidate"
                shutil.copytree(q / "calibration-reference", source)
                target = source / FAULT_TARGETS[spec["id"]]
                target.write_text(target.read_text(encoding="utf-8") + suffix, encoding="utf-8")
                result = grade(name, source)
                if result.get("status") != "graded" or result.get("score", 1) >= 1:
                    raise RuntimeError(name + " candidate failure was not classified as a scored failure")
        if spec["id"] == "composer":
            for name in ("browser-build", "browser-render"):
                with tempfile.TemporaryDirectory(prefix="scoring-partial-") as tmp:
                    source = Path(tmp) / "candidate"
                    shutil.copytree(q / "calibration-reference", source)
                    target = source / FAULT_TARGETS[spec["id"]]
                    text = target.read_text(encoding="utf-8")
                    if name == "browser-build":
                        text += "\nimport {readFileSync as __fixtureRead} from 'node:fs'; console.log(typeof __fixtureRead);\n"
                    else:
                        anchor = "}: ChatInputProps) {"
                        if text.count(anchor) != 1:
                            raise ValueError("Missing reviewed render boundary")
                        text = text.replace(anchor, anchor + "\nif(typeof process==='undefined')throw new Error('ENVIRONMENT_UNSUPPORTED: synthetic render failure');\n")
                    target.write_text(text, encoding="utf-8")
                    result = grade(name, source)
                    if result.get("status") != "graded" or not 0 < result.get("score", 0) < 1:
                        raise RuntimeError("Independent Node scenarios must retain their score")
                    for item in ("C03", "C04", "C05", "C07", "C09", "C10", "C11", "C12", "C13"):
                        if result["items"][item] != reference["items"][item]:
                            raise RuntimeError("Unaffected Node item changed: " + item)
    print("Saved separate calibration results; inspect reference health before interpreting baseline scores.")


if __name__ == "__main__":
    main()
