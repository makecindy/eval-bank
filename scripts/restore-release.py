"""Restore one frozen runtime from separately downloaded, hash-checked Release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import zipfile


def safe_path(value):
    p = PurePosixPath(value)
    if not value or p.is_absolute() or '..' in p.parts or '\\' in value:
        raise ValueError('unsafe archive path')
    return p


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('key', help='e.g. audio@v2')
    parser.add_argument('assets', type=Path)
    parser.add_argument('output', type=Path, help='new, empty question directory')
    args = parser.parse_args()
    index = json.loads((Path(__file__).resolve().parents[1] / 'releases/20260925/index.json').read_text())
    q = next(x for x in index['questions'] if x['key'] == args.key)
    # Validate every package before writing anything. Never execute downloaded code.
    for layer in q['layers']:
        f = args.assets / safe_path(layer['artifact'])
        expected = index['artifacts'][layer['artifact']]
        if f.stat().st_size != expected['bytes'] or hashlib.file_digest(f.open('rb'), 'sha256').hexdigest() != expected['sha256']:
            raise ValueError('asset integrity mismatch: ' + f.name)
    args.output.mkdir(parents=True, exist_ok=False)
    written = set()
    for layer in q['layers']:
        mount = PurePosixPath(layer['mount']) if layer['mount'] else PurePosixPath()
        if layer['mount']:
            safe_path(layer['mount'])
        with zipfile.ZipFile(args.assets / layer['artifact']) as archive:
            for member in archive.infolist():
                rel = (mount / safe_path(member.filename)).as_posix()
                mode = member.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise ValueError('symlinks are not allowed')
                if member.is_dir():
                    continue
                if rel in written or rel not in q['files']:
                    raise ValueError('duplicate or unlisted file: ' + rel)
                target = args.output / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                with archive.open(member) as source, target.open('xb') as dest:
                    while chunk := source.read(1024 * 1024):
                        digest.update(chunk)
                        dest.write(chunk)
                if digest.hexdigest() != q['files'][rel]:
                    raise ValueError('file integrity mismatch: ' + rel)
                os.chmod(target, 0o755 if mode & 0o111 else 0o644)
                written.add(rel)
    if written != set(q['files']):
        raise ValueError('missing files in restored package')
    print(f"Verified {q['key']}: {len(written)} files. No candidate code was executed.")


if __name__ == '__main__':
    main()
