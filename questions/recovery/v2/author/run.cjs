const fs = require('node:fs'), path = require('node:path');
const { createLab } = require('../candidate/lab/host.cjs');
const { cases } = require('./scenarios.cjs');
const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '../candidate'));
const output = process.argv[3];
const overlay = process.argv.includes('--overlay');
const { validateSource } = require('../candidate/lab/validate-source.cjs');
(async () => {
    const freezeFile=path.join(__dirname,'../frozen.json');
    const freeze=fs.existsSync(freezeFile)?require('./verify-freeze.cjs').verifyFreeze():null; const validation = validateSource(sourceRoot, { overlay }); if (!validation.valid) {
    const result = { schemaVersion: 3, freeze, question: 'MF-011-worker-recovery-v3', sourceRoot, status: 'invalid_submission', solved: false, passed: 0, total: cases.length, validation };
    if (output)
        fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, errors: validation.errors.slice(0, 8) }));
    return;
} const rows = [], calls = new Set(); for (const [id, group, description, run] of cases) {
    let h;
    try {
        h = await createLab({ sourceRoot, overlay });
        await run(h);
        h.assertEnvironment();
        rows.push({ id, group, description, required: true, status: 'passed', evidence: h.snapshot() });
    }
    catch (e) {
        let environmentError;
        try {
            h?.assertEnvironment();
        }
        catch (x) {
            environmentError = x;
        }
        rows.push({ id, group, description, required: true, status: environmentError || e.message.includes('ENVIRONMENT_') ? 'environment_unsupported' : 'failed', error: (environmentError || e).message, stack: e.stack, evidence: h?.snapshot() });
    }
    if (h)
        for (const call of h.boundaryCalls)
            calls.add(call);
} const valid = !rows.some(x => x.status === 'environment_unsupported'); const result = { schemaVersion: 3, freeze, question: 'MF-011-worker-recovery-v3', sourceRoot, gradedAt: new Date().toISOString(), status: valid ? 'graded' : 'environment_unsupported', solved: valid ? rows.every(x => x.status === 'passed') : null, passed: rows.filter(x => x.status === 'passed').length, total: rows.length, rows, validation, boundaryCalls: [...calls].sort(), rankingEligible: false, caveat: 'Interpret with frozen.json and calibration.json. Historical submissions were produced under earlier public environments; regrading does not constitute a new model run.' }; if (output)
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, passed: result.passed, total: result.total, failures: rows.filter(x => x.status !== 'passed').map(x => ({ id: x.id, status: x.status, error: x.error })) })); })().catch(e => { console.error(e); process.exitCode = 2; });
