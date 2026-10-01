# 本地事件实验台

先执行 `./runtime/node lab/preflight.cjs`，再执行 `./runtime/node lab/console.cjs`。默认场景在 `lab/workspace.json`，也可传自己写的 JSON 动作数组文件。每一步显示 Worker 状态、真实发送到 Lead 替身的消息、持久化错误和 coordinator projection。日志保存在 tests/，不会覆盖以前的运行。

可用动作：

- `dispatch`：经过真实 Orca 派发、队列和持久化后到达本地 vendor。`queued:false` 使用空闲 live session 直发。
- `event`：`type`、`data`、可选 `meta` 作为模拟 provider 事件输入真实注册监听器。
- `advance`：`ms` 推进虚拟时钟并执行到期的真实退避回调。
- `fault`：`name` 与 `value` 控制本地 I/O。`rejectSend` 拒绝后续 vendor 发送；`holdPersist` 延迟落库；`progress` 指定数据库是否已有 assistant 进度；`progressUnavailable` 模拟进度查询失败。
- `release-persistence`：`ok:true/false` 释放待完成的持久化。
- `user-message`：真实 coordinator 接收新用户输入，同时暂留交互锁，以便观察新输入尚未派发的时序；`release-user-turn` 释放该锁。
- `stop`：用户停止当前工作。

本台执行实际 registerMakerIpc、AgentInputCoordinator、OrcaTeamService、自动恢复账本/判据、Orca dispatcher 和发送结果转换。窗口、数据库、provider 进程及其他非本题集成不启动；其固定边界在 host.cjs 和 boundary-policy.json 中列明。未配置的调用返回环境不支持错误，不可视为修复失败或测试通过。

实验不提供直接设置 pending/deferred、强制认领或结算账本的动作。恢复状态由上述业务入口自行产生。可查看真实源码和已有测试理解当前行为；日志不是预设答案。

禁止把此实验称为真实 Electron、真实 API 或完整类型检查。preflight 的 TypeScript 检查只检查语法。
