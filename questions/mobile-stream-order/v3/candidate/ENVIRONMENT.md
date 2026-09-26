本目录是独立离线题包。只在分配给你的本目录工作；可编辑 TASK.md 指定的业务源码范围，可添加自己的测试文件。`runtime/`、`harness/`、`stubs/`、题面和合同是固定环境，不属于答案。不要读取题包外的作者资料、历史补丁或其他答案。正式验收从提交源码重新构建，忽略自制 bundle 和修改后的测试结论。

在当前工作目录执行：

```sh
pwd
./runtime/node harness/preflight.mjs
./runtime/node harness/reproduce.mjs
```

预检实际写入、读取、编辑、执行并回读 `.work/probe.mjs`，再构建并加载源码；收据在 `.work/preflight.json`。示例输出普通输入的渲染模型，只演示接口，不判断业务是否全部正确。单独构建：`./runtime/node harness/build.mjs`。

运行链：HistoryViewController 的受控历史页 → HistoryViewHandoff 的实时消息交接 → buildMobileHistoryRenderItems → 共享历史渲染 → 手机归一化、消息渲染模型与子卡片分组 → 输出消息模型。共享本地用户气泡合同另从 renderHistoryView 的已有 `isLocalUser` 入口观察；手机包装器在此版本没有该入口。此项检查共享代码改动的回归，不声称已验证手机 outbox UI。

真实源码保留原路径，`@/` 指向 `apps/mobile/src`，共享包子入口由固定 aliases.json 解析。Device Link 仅映射到原始 allowlist.ts 常量模块；不运行网络客户端。唯一替身是 i18n（返回 key）与认证错误描述（占位文本），不替换排序、交接或分组逻辑。历史传输由可控事件提供，无联网、账号或真实用户数据。

固定 runtime：Node v22.23.1 / esbuild 0.28.1，macOS arm64。无需安装依赖。只携带构建所需运行时源码闭包及 RemoteMessage 类型入口；部分仅供类型的其他仓库模块未包含，不提供全库 tsc、Vitest、Expo、React Native 或原生构建。构建是 TypeScript 转译与模块解析检查，不等于完整类型检查。

输出 `.build/` 与 `.work/` 可重建。渲染模型证明正文与卡片结构，不证明 React 组件、列表虚拟化、折叠实际可见性、CSS、动画、屏幕位置或真机行为。完整行为约定见 CONTRACT.md。
