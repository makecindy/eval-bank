const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('../runtime/typescript.cjs');
const root = path.resolve(__dirname, '..');
async function createLab(options = {}) {
    const root = options.sourceRoot || path.resolve(__dirname, "..");
    const trace = [], cache = new Map();
    let persistId = 'assistant-1';
    const noop = () => undefined;
    let coordinator;
    const ipcHandlers = new Map();
    let fixedTime = 1787987267043;
    class LabDate extends Date {
        constructor(...a) { super(...(a.length ? a : [fixedTime])); }
        static now() { return fixedTime; }
    }
    const timers = new Map();
    let timerId = 0;
    const timer = (f, ms, repeat = false) => { const id = ++timerId; timers.set(id, { f, ms, repeat, at: fixedTime + Math.max(0, Number(ms || 0)) }); return id; };
    const sourceFiles = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'baseline-files.json'), 'utf8')));
    const boundaryCalls = new Set(), environmentErrors = [];
    const policyFile = path.join(__dirname, 'boundary-policy.json');
    if (!fs.existsSync(policyFile))
        throw Error('ENVIRONMENT_UNSUPPORTED: missing boundary policy');
    const policy = new Set(JSON.parse(fs.readFileSync(policyFile, 'utf8')).allowedEmptyCalls);
    function boundaryCall(name) { boundaryCalls.add(name); trace.push({ kind: 'boundary.call', name }); if (policy && !policy.has(name)) {
        const err = new Error('ENVIRONMENT_UNSUPPORTED: ' + name);
        environmentErrors.push(err.message);
        throw err;
    } }
    function emptyAdapter(name) { return new Proxy(function () { }, { get(t, p) { if (p === 'then')
            return undefined; if (p === Symbol.iterator)
            return function* () { }; if (typeof p === 'symbol')
            return undefined; return emptyAdapter(name + '.' + p); }, apply() { boundaryCall(name); return undefined; }, construct() { boundaryCall('new ' + name); return emptyAdapter(name); } }); }
    const dummy = emptyAdapter('unconfigured.default');
    const fn = name => new Proxy(function (...args) { boundaryCall(name); return /^create|^init/.test(name) ? emptyAdapter(name) : undefined; }, { get(t, p) { if (p === 'then')
            return undefined; return emptyAdapter(name + '.' + String(p)); }, construct() { boundaryCall('new ' + name); return emptyAdapter(name); } });
    const log = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, (message, data) => trace.push({ kind: 'log', level, message, data })]));
    const errors = [];
    const terminal = [];
    let manualInterrupt = null;
    const leadMessages = [];
    const worker = { id: 'worker-1', teamId: 'team-1', leadSessionId: 'lead-1', sessionId: 'worker-A', status: 'idle', label: 'tester', role: 'tester', focused: false, idleSince: null, session: { title: 'Worker', agentKind: 'codex', model: 'lab', effort: 'medium', permissionMode: 'bypassPermissions', fastMode: false } };
    const link = { workerId: worker.id, teamId: worker.teamId, workerSessionId: worker.sessionId, leadSessionId: worker.leadSessionId };
    let service;
    const bindings = { knownNonOrcaSessionIds: new Set(), initGhostSetupInteractionBridge: () => ({ pendingSnapshots: () => [], cleanupForSession: noop }), cleanupOrphanedTempAttachments: async () => { }, createLogger: () => log, ipcMain: { handle: (k, f) => ipcHandlers.set(k, f), on: noop, removeHandler: noop }, getAgentIslandService: () => null, createId: (() => { let n = 0; return () => 'lab-' + (++n); })(), onPiPackagesChanged: () => noop, BrowserWindow: { getAllWindows: () => [] }, createWorkerTurnStartSequencer: () => ({ waitForStart: async () => { }, start: (id, f) => f() }),
        createGhostSessionTap: () => ({ handleEvent: noop, dispose: noop }), onTurnErrorEvent: (id, data) => errors.push({ id, data }),
        redactEventForRenderer: e => e, makerToDbAgentKind: x => x,
        consumeLastAssistantPersistId: () => { const x = persistId; persistId = undefined; return x; }, consumeLastTopLevelAssistantPersistId: () => undefined,
        isSuccessfulAssistantReplyDoneData: () => true, isSuccessfulCodexDoneEventData: () => true,
        getSessionProvider: () => null, readSessionModelForUsage: () => Promise.resolve('lab'), getSessionFastMode: () => false,
        getDbClient: () => ({ select: () => ({ from: () => ({ where: () => ({ get: () => null, all: () => [] }) }) }) }),
        readSilentStopAutoResumeSettings: () => ({ enabled: true }), readInterruptedTurnAutoResumeSettings: () => ({ enabled: true }),
        drainPersistQueue: async () => { }, refreshSessionListPreview: async () => { }, maybeGenerateSessionTaskSummary: async () => { },
        productTurnUsageDetails: () => null, buildEventAgentMeta: () => ({}), prepareEventAgentMeta: () => ({}), getSession: () => null,
        broadcastToAllWindows: (channel, payload) => trace.push({ kind: 'broadcast', channel: String(channel), payload }),
    };
    const realNames = new Set(['agent-input-coordinator', 'interruptedTurnAutoResume', 'recoveryCoordinator', 'sessionQueueInspection', 'agentInputQueue', 'interruptedTurn', 'sessionReferenceMetadata', 'autoResumeBookkeeping', 'orcaTeamService', 'sessionTurnActivityTracker', 'workerTurnStartSequencer', 'acceptedCallbackRunner', 'orcaInterAgentDispatcher', 'sessionQueueControl', 'send-outcome', 'collabSendOutcome']);
    function localPath(request, parent) {
        if (request === '@cindy/orca-workflow')
            return path.join(root, 'packages/orca-workflow/src/index.ts');
        if (request.startsWith('@cindy/maker-shared/'))
            return path.join(root, 'packages/maker-shared', JSON.parse(fs.readFileSync(path.join(root, 'packages/maker-shared/package.json'), 'utf8')).exports['./' + request.slice('@cindy/maker-shared/'.length)]);
        if (request.startsWith('.')) {
            let p = path.resolve(path.dirname(parent), request).replace(/\.js$/, '.ts');
            if (!fs.existsSync(p) && fs.existsSync(p + '.ts'))
                p += '.ts';
            return p;
        }
    }
    const externalCache = new Map();
    function external(request) {
        if (request === 'node:path')
            return path;
        if (request === '@cindy/maker-core')
            return new Proxy({ ...load(path.join(root, 'packages/maker-core/src/types/events.ts')), ...load(path.join(root, 'packages/maker-core/src/session-send-outcome.ts')) }, { get(t, k) { return t[k] ?? bindings[k] ?? fn(k); } });
        if (request === 'node:crypto')
            return { randomUUID: () => 'lab-uuid' };
        if (externalCache.has(request))
            return externalCache.get(request);
        const x = new Proxy({ __esModule: true }, { get(t, k) { if (k === '__esModule')
                return true; if (k === 'default')
                return dummy; if (typeof k !== 'string')
                return undefined; return bindings[k] ?? fn(k); } });
        externalCache.set(request, x);
        return x;
    }
    function isChanged(file) { const baseline = path.join(path.resolve(__dirname, '..'), path.relative(root, file)); return file !== baseline && fs.existsSync(file) && (!fs.existsSync(baseline) || !fs.readFileSync(file).equals(fs.readFileSync(baseline))); }
    function load(file, force = false) {
        if (cache.has(file))
            return cache.get(file).exports;
        trace.push({ kind: 'source.load', file: path.relative(root, file) });
        const mod = { exports: {} };
        cache.set(file, mod);
        let actualFile = fs.existsSync(file) ? file : options.overlay ? path.join(path.resolve(__dirname, '..'), path.relative(root, file)) : file;
        let source = fs.readFileSync(actualFile, 'utf8');
        if (file.endsWith('/register.ts'))
            source += '\nexport const __lab = {get coordinator(){return agentInputCoordinatorHolder},get service(){return orcaTeamServiceForEvents},book:autoResumeBookkeeping};';
        const result = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
        const fatal = (result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
        if (fatal.length)
            throw new Error(ts.formatDiagnosticsWithColorAndContext(fatal, { getCanonicalFileName: x => x, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
        const compiled = result.outputText;
        const context = { exports: mod.exports, module: mod, require: (r) => { const p = localPath(r, file); if (p && (realNames.has(path.basename(p, '.ts')) || isChanged(p) || (p.startsWith(path.join(root, 'apps/desktop/src/main/maker-ipc/')) && !sourceFiles.has(path.relative(root, p))) || r.startsWith('@cindy/maker-shared/turn-continuation') || r.startsWith('@cindy/maker-shared/agent-error') || p.includes('/packages/orca-workflow/') || p.includes('/packages/maker-shared/') || (p.includes('/apps/desktop/src/shared/') && !file.endsWith('/register.ts'))))
                return load(p); return external(r); }, __filename: file, __dirname: path.dirname(file), console, process: { pid: 1, env: {}, platform: process.platform }, Date: LabDate, setTimeout: timer, clearTimeout: id => timers.delete(id), setInterval: (f, ms) => timer(f, ms, true), clearInterval: id => timers.delete(id), queueMicrotask, Buffer, AbortController, AbortSignal, URL, TextEncoder, TextDecoder, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}` } };
        new vm.Script(compiled, { filename: file }).runInNewContext(context, { timeout: 3000 });
        return mod.exports;
    }
    const reg = load(path.join(root, 'apps/desktop/src/main/maker-ipc/register.ts'));
    const liveSessions = new Map();
    let idCounter = 0;
    const dbMessages = [];
    let dbFilter = null;
    const io = { progress: true, rejectSend: false, holdPersist: false };
    let persistGate;
    const row = id => ({ id: id || 'worker-A', title: 'Worker', status: 'active', userSendAt: null, clearedAt: null, agentKind: 'codex', model: 'lab', workDir: root, permissionMode: 'bypassPermissions' });
    const query = { select() { return this; }, from() { return this; }, where(x) { dbFilter = x; return this; }, limit() { return Promise.resolve([row(dbFilter?.value)]); }, get() { return row(dbFilter?.value); }, all() { return []; }, then(ok, bad) { return Promise.resolve([row(dbFilter?.value)]).then(ok, bad); }, update() { return this; }, set(v) { if (v.status)
            worker.status = v.status; return this; } };
    Object.assign(bindings, { getMakerIfReady: () => maker, getGhostFsSlot: () => ({ cleanupForSession: noop }), touchUserSendInDb: async () => { }, readSessionRuntimeFallbackSettings: () => ({ enabled: false }), withGhostUserHookModel: (m, f) => f(), screenGhostUserMessage: async () => ({ action: "allow" }), withCreateSessionStderr: x => x, readSessionExtraDirsFromDb: async () => [], readSessionWritableDirsFromDb: async () => [],
        eq: (field, value) => ({ field, value }), getDbClient: () => ({ drizzle: query }),
        getWorkerLink: async ({ workerSessionId, workerId }) => (workerSessionId === worker.sessionId || workerId === worker.id) ? link : null,
        listWorkersByLead: async () => [worker], updateWorkerStatus: async (id, status) => { worker.status = status; trace.push({ kind: 'worker.status', status }); },
        markWorkerIdleIfStatus: async (id, status) => { if (worker.status !== status)
            return false; worker.status = 'idle'; return true; }, restoreWorkerDoneIfIdle: async () => { if (worker.status !== 'idle')
            return false; worker.status = 'done'; return true; },
        createMakerSendTransaction: () => ({ sendToAgentAccepted: async (id, message, createOpts, opts = {}) => {
                await opts.persistUserMessage?.onPersisting?.();
                if (io.holdPersist)
                    await new Promise((resolve, reject) => { persistGate = { resolve, reject }; }).catch(err => { opts.persistUserMessage?.onPersistFailed?.(); throw err; });
                if (opts.persistUserMessage) {
                    await bindings.createMessage(id, opts.persistUserMessage);
                    await opts.persistUserMessage.onPersisted?.();
                }
                if (io.rejectSend)
                    return { outcome: { kind: 'host-send', accepted: false, code: 'SEND_FAILED', message: 'Injected vendor send rejection' } };
                await opts.onAccepted?.();
                const result = await liveSessions.get(id).send(message, {});
                return { outcome: { kind: 'session-dispatch', source: 'lab', dispatched: result.accepted } };
            } }),
        createId: () => 'lab-' + (++idCounter), getManualInterrupt: () => manualInterrupt, clearManualInterrupt: () => { manualInterrupt = null; }, restoreManualInterrupt: (id, m) => { manualInterrupt = m; },
        loadAgentInputQueueSnapshot: async () => [], saveAgentInputQueueSnapshot: async () => { },
        createMessage: async (id, data) => { dbMessages.push({ id, data }); return { id: data.clientId, ...data }; },
        enqueueDurableWrite: async (key, f) => f(), hasAssistantProgressAfterMessage: async () => { if (io.progressUnavailable)
            throw Error('Injected progress-store read failure'); return io.progress; }, getRecoveryContextSnapshot: async () => ({ contextTokens: 100, contextWindow: 10000, progressCount: io.progress ? 1 : 0, recentProgress: [] }),
        createDeferredRestartQueueGate: () => () => false, readSessionClearBoundary: async () => null,
        getSessionRowSnapshot: async (id) => row(id), getSession: async (id) => row(id),
    });
    function makeSession(id) {
        let busy = false, generation = 0;
        const listeners = [], statusListeners = [];
        const sess = { id, instanceId: 'instance-' + id, agentKind: 'codex', model: null, remoteHostId: null, workDir: root,
            isTurnRunning: () => busy, getTurnGeneration: () => generation, getObservedCurrentTurnTerminal: () => ({ kind: 'none', generation }),
            setTurnLifecycleObserver: noop, setInteractionListener: noop, onEvent: f => { listeners.push(f); return noop; }, onClosed: () => noop, onClose: () => noop, onError: () => noop, onStatusChange: f => { statusListeners.push(f); return noop; }, close: async () => { busy = false; for (const f of statusListeners)
                f("closed"); await drain(); },
            setBusy: v => { busy = v; }, async emit(type, data = {}, extras = {}) { if (type === 'error' || type === 'done')
                busy = false; const event = { type, data, source: 'codex', sessionTurnGeneration: generation, sessionInstanceId: sess.instanceId, turnAttemptToken: generation, ...extras }; for (const f of listeners)
                f(event); await drain(); },
            async send(message, opts = {}) { await opts.onAccepted?.(); await opts.onDispatching?.(); busy = true; generation++; for (const f of listeners)
                f({ type: 'status', data: { isRunning: true }, source: 'codex', sessionTurnGeneration: generation, sessionInstanceId: sess.instanceId, turnAttemptToken: generation }); trace.push({ kind: 'vendor.send', id, message }); if (id === 'lead-1')
                leadMessages.push({ id, message }); return { accepted: true }; }, abort: async () => { busy = false; }, getSdkSessionId: () => undefined };
        liveSessions.set(id, sess);
        return sess;
    }
    const session = makeSession('worker-A');
    const lead = makeSession('lead-1');
    async function drain() { let stable = 0, last = -1; for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setImmediate(resolve));
        if (trace.length === last)
            stable++;
        else
            stable = 0;
        last = trace.length;
        if (stable >= 2)
            return;
    } throw Error('ENVIRONMENT_UNSETTLED: event loop did not quiesce'); }
    const maker = { getSessionCloseReason: () => 'user', getSession: id => liveSessions.get(id), listActiveSessions: () => [...liveSessions.values()], getSessionMeta: async (id) => ({ id, agentKind: 'codex', model: 'lab', workingDir: root }), on: noop };
    reg.registerMakerIpc(maker, { onProviderModelAutoRefreshConfigured: noop });
    coordinator = reg.__lab.coordinator;
    service = reg.__lab.service;
    reg.wireSessionToIpc(session);
    await coordinator.ensureQueueRestored('worker-A');
    await coordinator.ensureQueueRestored('lead-1');
    const h = { io, trace, leadMessages, errors, timers, coordinator, service, ipcHandlers, session, lead, drain, book: reg.__lab.book,
        assertEnvironment() { if (environmentErrors.length)
            throw Error(environmentErrors.join('; ')); }, boundaryCalls,
        snapshot: () => JSON.parse(JSON.stringify({ status: worker.status, leadMessages, errors, projection: coordinator.getProjection('worker-A') })),
        async advance(ms) { const target = fixedTime + ms; let steps = 0; while (true) {
            const next = [...timers].filter(([id, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next)
                break;
            if (++steps > 1000)
                throw Error('Environment timer step limit');
            timers.delete(next[0]);
            fixedTime = next[1].at;
            if (next[1].repeat)
                timers.set(next[0], { ...next[1], at: fixedTime + Math.max(1, Number(next[1].ms || 0)) });
            await next[1].f();
            await drain();
        } fixedTime = target; await drain(); },
        async start() { session.setBusy(true); const out = await this.begin(); session.setBusy(false); coordinator.wakeSession('worker-A', 'lab'); await drain(); return out; },
        async releasePersistence(ok = true) { io.holdPersist = false; if (!persistGate)
            throw Error('No pending persistence'); ok ? persistGate.resolve() : persistGate.reject(Error('Injected persistence rejection')); await drain(); },
        async userTakeover() { coordinator.setInteractionLock('worker-A', 'user-handoff', true); coordinator.enqueue('worker-A', { clientId: 'user-' + (++idCounter), text: '我来接手，继续处理', persistedContent: '我来接手，继续处理', chatMessage: { role: 'user', content: '我来接手，继续处理', createdAt: new LabDate().toISOString() }, createOpts: { agentKind: 'codex', model: 'lab' }, model: 'lab', effort: 'medium', permissionMode: 'bypassPermissions' }); await drain(); },
        async releaseUserTurn() { coordinator.setInteractionLock('worker-A', 'user-handoff', false); await drain(); },
        setPersist: id => { persistId = id; },
        async stop() { manualInterrupt = { reason: 'user', markedAt: fixedTime }; coordinator.stop('worker-A'); await drain(); },
        async close() { await session.close(); await drain(); },
        async begin() { const out = await service.dispatchWorkerTask({ targetSessionId: 'worker-A', message: '修复当前问题', dispatchMeta: { source: 'lab', context: 'benchmark' } }); await drain(); return out; },
    };
    return h;
}
module.exports = { createLab };
if (require.main === module) {
    createLab().then(async (h) => { await h.start(); h.assertEnvironment(); console.log(JSON.stringify(h.snapshot())); }).catch(e => { console.error(e); process.exitCode = 1; });
}
