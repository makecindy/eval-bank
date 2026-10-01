# 工作环境

这是 Cindy Desktop 的历史开发现场。你的任务是按照 PROMPT.md 独立检查功能。

- apps/、packages/、docs/ 和历史测试来自同一份改动前源码快照；没有 .git 和后续修复记录。
- lab/ 提供可重复操作的输入框工作台。真实 React、Tiptap/ProseMirror、ChatInput、PermissionSelector、焦点恢复hook、首页 NewMakerDraftRoute、草稿与附件 store 参与执行；桌面宿主、供应商目录、创建请求、语音识别结果由本地替身提供，不会调用付费模型或读个人数据。
- 已有任务入口使用 ChatInput 的 onSend 边界，工作台在该回调收到消息时记录一次用户消息展示，然后等待手动结算；首页直接运行真实 NewMakerDraftRoute。完整 CCAgentSessionView / enqueue、真实 Electron 窗口、CSS 排版与麦克风不在工作台内。
- 可修改 apps/desktop/src/renderer/ 内与本需求相关的源码，新增 tests/ 下自测；lab/、runtime/、题面为评测基础设施，不修改。不提交、不安装依赖、不使用目录外资料。
- 若修改了工作台没有加载的业务模块，报告该覆盖缺口；宿主不得把未执行的实现判为已验证，也不得将环境不支持算成模型零分。

正式开始前检查会话默认目录与题包根一致；不能只依靠某条 shell 命令的 cd。读取、编辑工具和执行命令必须使用同一个根。若默认目录不正确，报告环境问题，由宿主调整后重新开始。

预检顺序：
1. 在题包根执行 `./runtime/node lab/preflight.cjs --prepare`。
2. 用你的读取工具打开输出中的 editFile，再用实际编辑工具把 `value: 1` 改成 `value: 2`，回读确认。编辑时使用完整绝对路径，避免不同工具的相对路径基准不一致。
3. 执行 `./runtime/node lab/preflight.cjs --verify`，确认被编辑的文件实际执行并产出 2，且源码构建、真实 Chromium 启动和组件挂载成功。预检只涉及 tests/environment-preflight/，不改业务代码。

通过后自行探索、修复并验证。无需再次询问是否可以实现普通技术方案；只提出方案不算交付。

```
./runtime/node lab/build.cjs
./runtime/node lab/console.cjs
./runtime/node lab/console.cjs tests/my-scene.json
./runtime/node lab/browser-console.cjs tests/my-scene.json
```

默认 lab/scene.json 是一次已存在任务的发送。控制台输入是 JSON 数组：
- `mount`: view 为 task 或 home，任务页可设置 sessionId、remoteHostId。
- `set`: 设置 html 或 Tiptap document；`type`: 在可编辑输入框插入 text/html。
- `focus`、`click`: 聚焦末尾、触发 Enter 发送。
- `switch`: 切换 sessionId，复用实际输入框组件。
- `settle`: 结算第 index 条已存在任务的发送，result=true/false，或 reject=true。
- `created`: 结算第 index 次首页创建，fail=true 表示创建失败。
- `voice`、`voiceFinal`: 注入录音中的预览文本与稍后的定稿；识别服务本身是替身。
- `seedDraft`: 使用真实草稿store准备指定sessionId的draft（正文和附件）；这是初始现场材料，不直接修改组件内部状态。
- 浏览器控制台另支持 `editorClick`（真实鼠标点击编辑器）、`buttonClick`（真实鼠标点击发送）、`keyboardType`（直接键盘输入text，不自动聚焦）。
- `hydrate`: 返回测试消息引用的原文；`flush`: 推进一次 React/动画帧处理。

输出包括编辑器文档、可编辑/焦点/权限按钮/发送按钮状态、导航、草稿和请求计数。普通console使用jsdom，几何为空；browser-console使用固定Chromium 149.0.7827.55（macOS arm64）与Playwright原生鼠标/键盘，支持浏览器焦点验证，但不是Electron、原生macOS或生产CSS视觉验收。它只监听本机随机端口并拒绝公网请求。运行工具已随runtime提供，不用下载依赖。未知宿主能力报 ENVIRONMENT_UNSUPPORTED，不补一个“成功”返回来绕过。

完成后保留源码及自测记录，说明原因、改动和实测边界。隐藏验收由外部运行，不自行访问。
