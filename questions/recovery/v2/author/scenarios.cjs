const assert = require('node:assert/strict');
const failure = { message: 'Connection closed mid-response.', reason: 'codex_reconnect_stalled', isTerminal: true };
const quiet = h => { assert.equal(h.snapshot().status, 'running'); assert.equal(h.leadMessages.length, 0); };
const failed = h => { assert.equal(h.snapshot().status, 'error'); assert.equal(h.leadMessages.length, 1); assert.match(h.leadMessages[0].message.content, /异常终止/); assert.match(h.leadMessages[0].message.content, /Connection closed mid-response/); };
const succeeded = h => { assert.equal(h.snapshot().status, 'done'); assert.equal(h.leadMessages.length, 1); assert.doesNotMatch(h.leadMessages[0].message.content, /异常终止/); };
async function pending(h) { await h.start(); await h.session.emit('error', failure); assert.equal(h.coordinator.isAutoResumePending('worker-A'), true); }
const cases = [
    ['R01', 'recovery', '自动恢复接管后不提前报告失败', async (h) => { await pending(h); quiet(h); }],
    ['R02', 'recovery', '同一失败后的配对 done 不算完成', async (h) => { await pending(h); await h.session.emit('done'); quiet(h); }],
    ['R03', 'recovery', '真实退避与再次派发成功后只交付最终完成', async (h) => { await pending(h); await h.session.emit('done'); await h.advance(5000); assert.equal(h.trace.filter(x => x.kind === 'vendor.send' && x.id === 'worker-A').length, 2); await h.session.emit('done'); succeeded(h); assert.equal(h.errors.length, 0); }],
    ['R04', 'finalization', '续跑派发被拒后补报原错误且后续时间不重复桥接', async (h) => { await pending(h); await h.session.emit('done'); h.io.rejectSend = true; await h.advance(5000); failed(h); await h.advance(30000); failed(h); }],
    ['R05', 'finalization', '无法安全确认历史进度而放弃续跑时不会永久保持 running', async (h) => { h.io.progressUnavailable = true; await pending(h); await h.session.emit('done'); await h.advance(5000); failed(h); }],
    ['R06', 'finalization', '连续重试直到真实额度耗尽才宣告失败', async (h) => { await h.start(); let ended = false; for (let i = 0; i < 12; i++) {
            await h.session.emit('error', failure);
            if (!h.coordinator.isAutoResumePending('worker-A')) {
                ended = true;
                break;
            }
            quiet(h);
            await h.session.emit('done');
            await h.advance(30000);
        } assert.equal(ended, true, 'recovery budget did not terminate'); failed(h); }],
    ['R07', 'handoff', '用户新输入接手只补历史，不向 Lead 报旧失败', async (h) => { await pending(h); await h.userTakeover(); await h.advance(5000); quiet(h); assert.equal(h.errors.filter(x => x.data.message === failure.message).length, 1); }],
    ['R08', 'handoff', '零产出用户接手后的旧 done 与无 token running 不误完成', async (h) => { h.io.progress = false; await pending(h); h.setPersist(undefined); await h.userTakeover(); await h.session.emit('status', { isRunning: true }, { turnAttemptToken: undefined }); await h.session.emit('done', {}, { turnAttemptToken: undefined }); quiet(h); }],
    ['R09', 'handoff', '接手的新轮能够正常派发和完成', async (h) => { await pending(h); await h.session.emit('done'); await h.userTakeover(); await h.releaseUserTurn(); await h.session.emit('done'); succeeded(h); }],
    ['R10', 'handoff', '显式 Stop 不把自动恢复中的旧错误桥给 Lead', async (h) => { await pending(h); await h.stop(); await h.session.emit('done'); await h.advance(5000); assert.equal(h.leadMessages.length, 0); }],
    ['R11', 'regression', '没有恢复资格的真实终态错误照常报告', async (h) => { await h.begin(); await h.session.emit('error', failure); failed(h); }],
    ['R12', 'regression', '正常完成仍通过实际发送出口交给 Lead', async (h) => { await h.start(); await h.session.emit('done'); succeeded(h); }],
    ['R13', 'regression', '带 continuation 的 done 不结束 Worker', async (h) => { await h.start(); await h.session.emit('done', {}, { turnContinuationId: 42 }); quiet(h); }],
    ['R14', 'regression', '供应商非终态 retry 提示不结束 Worker', async (h) => { await h.start(); await h.session.emit('error', { message: '502 retrying', isTerminal: false, willRetry: true }); quiet(h); }],
    ['R15', 'persistence', '首次派发尚未持久化的 deferred 错误不伪造已接受工作', async (h) => { h.io.holdPersist = true; await h.start(); await h.session.emit('error', failure); assert.equal(h.coordinator.isAutoResumeDeferred('worker-A'), true); assert.equal(h.leadMessages.length, 0); assert.equal(h.trace.filter(x => x.kind === 'vendor.send').length, 0); }],
    ['R16', 'persistence', '首次持久化失败保留可重试入口，不发送虚假 Worker 终态', async (h) => { h.io.holdPersist = true; await h.start(); await h.session.emit('error', failure); await h.session.emit('done'); await h.releasePersistence(false); await h.advance(5000); assert.equal(h.leadMessages.length, 0); assert.equal(h.snapshot().projection.recovery.kind, 'queue-head'); assert.ok(h.errors.some(x => x.data.message === failure.message)); }],
    ['R17', 'recovery', '新一次恢复拥有新错误，不在中间一次恢复后错误收口', async (h) => { await pending(h); await h.session.emit('done'); await h.advance(5000); await h.session.emit('error', failure); assert.equal(h.coordinator.isAutoResumePending('worker-A'), true); quiet(h); await h.session.emit('done'); h.io.rejectSend = true; await h.advance(30000); failed(h); }],
    ['R18', 'regression', '零产出时安全重发原输入而非凭空从中途继续', async (h) => { h.io.progress = false; await pending(h); await h.session.emit('done'); await h.advance(5000); const sends = h.trace.filter(x => x.kind === 'vendor.send' && x.id === 'worker-A'); assert.equal(sends.length, 2); assert.equal(sends[1].message.content, sends[0].message.content); await h.session.emit('done'); succeeded(h); }],
    ['R19', 'handoff', '新的 Lead 派发不被旧恢复计时器结束', async (h) => { await pending(h); await h.session.emit('done'); await h.begin(); await h.drain(); await h.advance(5000); quiet(h); await h.session.emit('done'); succeeded(h); }],
    ['R20', 'handoff', '会话关闭清理不会向 Lead 补发已撤销恢复的错误', async (h) => { await pending(h); await h.close(); await h.advance(30000); assert.equal(h.leadMessages.length, 0); assert.equal(h.coordinator.isAutoResumePending('worker-A'), false); assert.equal(h.trace.filter(x => x.kind === 'vendor.send' && x.id === 'worker-A').length, 1); }],
];

// All transitions use the real input coordinator and virtual timer, never set recovery state.
cases.push(
 ['X01','composition','retry then user replacement, paired terminal, new result',async h=>{
  await pending(h);await h.session.emit('done');await h.advance(5000);quiet(h);
  await h.session.emit('error',failure);await h.session.emit('done');quiet(h);
  await h.userTakeover();quiet(h);await h.releaseUserTurn();await h.advance(30000);quiet(h);
  await h.session.emit('done');succeeded(h);await h.advance(60000);succeeded(h);
 }],
 ['X02','composition','retry then stop and delayed timer stays quiet',async h=>{
  await pending(h);await h.session.emit('done');await h.advance(5000);
  await h.session.emit('error',failure);await h.session.emit('done');await h.stop();
  await h.session.emit('done');await h.advance(60000);assert.equal(h.leadMessages.length,0);
  assert.notEqual(h.snapshot().status,'running');
 }],
 ['X03','composition','successful persistence and retry then rejected retry settles once',async h=>{
  h.io.holdPersist=true;await h.start();assert.equal(h.trace.filter(x=>x.kind==='vendor.send').length,0);
  assert.equal(h.leadMessages.length,0);h.io.holdPersist=false;await h.releasePersistence(true);
  await h.advance(5000);await h.session.emit('error',failure);await h.session.emit('done');quiet(h);
  h.io.rejectSend=true;await h.advance(30000);failed(h);await h.advance(60000);failed(h);
 }],
 ['X04','composition','retry then lead dispatch survives old schedule',async h=>{
  await pending(h);await h.session.emit('done');await h.advance(5000);
  await h.session.emit('error',failure);await h.session.emit('done');await h.begin();await h.drain();
  await h.advance(60000);quiet(h);await h.session.emit('done');succeeded(h);
 }]
);

cases.push(['X05','composition','old terminal arrives after replacement starts',async h=>{
 await h.start();const generation=h.session.getTurnGeneration();
 await h.session.emit('error',failure);await h.userTakeover();await h.releaseUserTurn();
 assert.ok(h.session.getTurnGeneration()>generation);quiet(h);
 await h.session.emit('done',{}, {sessionTurnGeneration:generation,turnAttemptToken:generation});quiet(h);
 await h.advance(60000);quiet(h);await h.session.emit('done');succeeded(h);
}]);
module.exports = { cases };
