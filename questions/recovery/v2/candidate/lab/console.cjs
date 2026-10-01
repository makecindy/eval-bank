const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
(async () => {
    const root = path.resolve(__dirname, '..');
    const script = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'workspace.json'), 'utf8'));
    const h = await require('./host.cjs').createLab();
    const rows = [{ op: 'initial', ...h.snapshot() }];
    for (const step of script) {
        switch (step.op) {
            case 'dispatch':
                await (step.queued === false ? h.begin() : h.start());
                break;
            case 'event':
                await h.session.emit(step.type, step.data || {}, step.meta || {});
                break;
            case 'advance':
                await h.advance(step.ms);
                break;
            case 'fault':
                if (!['rejectSend', 'holdPersist', 'progress', 'progressUnavailable'].includes(step.name))
                    throw Error('unknown I/O fault');
                h.io[step.name] = step.value;
                break;
            case 'release-persistence':
                await h.releasePersistence(step.ok !== false);
                break;
            case 'user-message':
                await h.userTakeover();
                break;
            case 'release-user-turn':
                await h.releaseUserTurn();
                break;
            case 'stop':
                await h.stop();
                break;
            default: throw Error('unknown action ' + step.op);
        }
        await h.drain();
        h.assertEnvironment();
        rows.push({ op: step, ...h.snapshot() });
    }
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    const dest = path.join(root, 'tests', `replay-${Date.now()}-${crypto.randomUUID()}.jsonl`);
    fs.writeFileSync(dest, rows.map(x => JSON.stringify(x)).join('\n') + '\n');
    for (const row of rows)
        console.log(JSON.stringify(row));
    console.error('Saved:', dest);
})().catch(e => { console.error(e); process.exitCode = 1; });
