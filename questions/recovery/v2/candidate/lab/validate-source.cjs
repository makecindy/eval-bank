const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ts = require('../runtime/typescript.cjs');
const baseline = path.resolve(__dirname, '..');
function files(dir) { if (!fs.existsSync(dir))
    return []; return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => { const p = path.join(dir, e.name); return e.isDirectory() ? files(p) : [p]; }); }
function validateSource(sourceRoot, { overlay = false } = {}) {
    const errors = [], changed = [];
    sourceRoot = path.resolve(sourceRoot);
    for (const top of ['apps', 'packages']) {
        for (const f of files(path.join(sourceRoot, top))) {
            const rel = path.relative(sourceRoot, f), stat = fs.lstatSync(f);
            if (stat.isSymbolicLink()) {
                errors.push({ file: rel, reason: 'source symlink unsupported' });
                continue;
            }
            const buf = fs.readFileSync(f), base = path.join(baseline, rel);
            if (fs.existsSync(base) && buf.equals(fs.readFileSync(base)))
                continue;
            changed.push({ file: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
            if (!rel.startsWith('apps/desktop/src/main/maker-ipc/')) {
                errors.push({ file: rel, reason: 'outside advertised editable source scope' });
                continue;
            }
            if (!/\.[cm]?[jt]sx?$/.test(f))
                continue;
            const source = ts.createSourceFile(f, buf.toString('utf8'), ts.ScriptTarget.Latest, true, f.endsWith('tsx') ? ts.ScriptKind.TSX : f.endsWith('js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
            for (const d of source.parseDiagnostics || [])
                errors.push({ file: rel, code: d.code, reason: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
        }
        if (!overlay && sourceRoot !== baseline)
            for (const f of files(path.join(baseline, top))) {
                const rel = path.relative(baseline, f);
                if (!fs.existsSync(path.join(sourceRoot, rel)))
                    (rel.startsWith('apps/desktop/src/main/maker-ipc/') ? changed.push({ file: rel, deleted: true }) : errors.push({ file: rel, reason: 'source deleted outside editable scope' }));
            }
    }
    return { valid: errors.length === 0, changed, errors };
}
module.exports = { validateSource };
if (require.main === module) {
    const result = validateSource(process.argv[2] || baseline, { overlay: process.argv.includes('--overlay') });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
}
