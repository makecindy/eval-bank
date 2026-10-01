# 固定测试环境

Node 22.23.1 / macOS arm64；无安装和网络依赖。源码保持完整。评分适配器用 Node 内置 TypeScript 转换与 VM 模块加载，audioContextPool 是随附的原始依赖。类型导入被擦除，不运行浏览器设备生命周期。

worklet 通过标准 process 与 port 消息边界驱动。fallback 通过生产 ScriptProcessor 回调使用的 handleInputFrame 边界喂入，onPcm16k 收集输出，drainBufferedAudio 排空，stop 结束并清空一轮。适配器固定时钟，不访问麦克风或授权信息。

本轮是只读出答案试跑，候选不执行代码；评分端独立在断网、无私有文件读取权限的 OS 沙箱运行代码。生成过程仍使用 Cindy Pi 工作环境，其文件访问边界不是 OS 强制隔离，结果会保留这个限制。不要尝试更换工作目录或绕过工具审批。

可阅读 adapter.mjs 了解 JSON 驱动方式，repro.json 提供最小输入例子，不附带修复方法。
