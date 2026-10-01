首条命令使用无 cd、无显式 workdir 的 pwd，确认宿主默认目录与绑定根一致。不一致时停止，报告环境阻断。

# 固定测试环境

Node 22.23.1 / macOS arm64；无安装和网络依赖。源码保持完整。评分适配器用 Node 内置 TypeScript 转换与 VM 模块加载，audioContextPool 是随附的原始依赖。类型导入被擦除，不运行浏览器设备生命周期。

worklet 通过标准 process 与 port 消息边界驱动。fallback 通过生产 ScriptProcessor 回调使用的 handleInputFrame 边界喂入，onPcm16k 收集输出，drainBufferedAudio 排空，stop 结束并清空一轮。适配器固定时钟，不访问麦克风或授权信息。

本轮可编辑源码并自测。运行 ./runtime/node lab/preflight.cjs 做通用预检；运行 ./runtime/node lab/public-check.cjs 使用普通输入示例 repro.json。runtime/、lab/、adapter.mjs、repro.json、题面及 audioContextPool.ts 只读。所有命令显式在本目录执行；可读本目录，写入范围为允许的两个源码文件及 tests/。不联网、安装、提交、访问账号或目录外资料；没有 .git，不创建 worktree。若宿主拒绝操作，停止并报告原始错误，由评测者处理。生成阶段仅靠任务范围约束，不声称 OS 沙箱。

可阅读 adapter.mjs 了解 JSON 驱动方式，repro.json 提供最小输入例子，不附带修复方法。

开工须阅读 PROMPT.md 及本环境说明。预检后用编辑工具把 tests/environment-edit-probe.txt 的 probe 改为 probe-edited，回读并用本目录 runtime/node 断言；不访问作者目录和其他答案。
