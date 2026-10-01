const fs = require('node:fs'), path = require('node:path'), ts = require('../runtime/typescript.cjs');
(async () => {
    const root = path.resolve(__dirname, '..');
    const dest = path.join(root, 'tests');
    fs.mkdirSync(dest, { recursive: true });
    const probe = path.join(dest, 'environment-probe.txt');
    fs.writeFileSync(probe, 'preflight');
    if (fs.readFileSync(probe, 'utf8') !== 'preflight')
        throw Error('write/read failed');
    let parsed = 0;
    function scan(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory())
            scan(p);
        else if (/\.[cm]?[jt]sx?$/.test(p)) {
            const source = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true, p.endsWith('tsx') ? ts.ScriptKind.TSX : p.endsWith('js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
            if (source.parseDiagnostics.length)
                throw Error('Source syntax error: ' + p);
            parsed++;
        }
    } }
    scan(path.join(root, 'apps/desktop/src/main/maker-ipc'));
    const h = await require('./host.cjs').createLab();
    await h.start();
    h.assertEnvironment();
    if (h.snapshot().status !== 'running' || h.trace.filter(x => x.kind === 'vendor.send' && x.id === 'worker-A').length !== 1)
        throw Error('real queued dispatch did not reach fake vendor');
    const result = { writeRead: true, node: process.version, typescript: ts.version, root, platform: process.platform, arch: process.arch, parsedSourceFiles: parsed, realRegisterMakerIpc: true, realCoordinator: true, realOrcaInitialDispatch: true, knownBoundaryPolicy: true };
    fs.writeFileSync(path.join(dest, 'preflight.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
})().catch(e => { console.error(e); process.exitCode = 1; });
