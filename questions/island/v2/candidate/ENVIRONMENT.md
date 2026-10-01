首条命令使用无 cd、无显式 workdir 的 pwd，确认宿主默认目录与绑定根一致。不一致时停止，报告环境阻断。

# 工作环境

这是用于本次工作的历史源码快照。apps/、packages/、docs/ 等保留历史目录，未安装完整 monorepo 依赖；不访问本机用户资料或生产账号。运行材料的来源与模拟边界见 lab/PROVENANCE.md。

环境自检命令为 `./runtime/node lab/preflight.mjs`，用于验证工具和 tests/ 写入能力，不包含解题步骤。

在本目录执行 `./runtime/node lab/console.mjs --help` 查看本地桌面模拟控制台用法，`./runtime/node lab/console.mjs` 启动。它从本目录源码编译并运行；修改后重新启动加载。可以观察输出、读取生成日志、探索源码、编写脚本重放或自建测试。lab/workspace.json 是默认模拟工作区，也可通过 --scene 指定自建场景。模拟时间由控制台动作推进，不依赖真实等待。

runtime/ 提供当前机器可用的 Node 与 esbuild，不需要安装。只读：runtime/、lab/、题面。可编辑：需要修复的 apps/、packages/ 源码；可创建、修改、执行 tests/ 内脚本。历史文档和测试可以阅读。所有命令在本目录执行；若工具没有 cwd 参数，显式 cd 到本目录。

本次交付为定位问题、修复代码及验证记录，无需 commit 或 PR。原生 Electron 窗口、音频、真实网络和 macOS 动画不在此环境中运行，不把模拟结果称为原生验收。不要联网安装、访问目录外资料、其他候选或隐藏验收；不要委派。构建、源码编辑和本地自测在上述范围内已获授权。若自动审批拒绝，停止并报告实际命令和理由，不换命令绕过。

开工须阅读 PROMPT.md、CONTRACT.md 及本环境说明。预检后用编辑工具把 tests/environment-edit-probe.txt 的 probe 改为 probe-edited，回读并用本目录 runtime/node 断言；不访问作者目录和其他答案。
