# 运行环境

本包包含固定 Node 运行时，无需联网安装依赖。首次纯 pwd 确认工作根后，可用 `./runtime/node --version` 核验。

要运行 npm scripts，先在当前 shell 设置 `PATH="$PWD/runtime:$PATH"`，使其使用包内 Node；也可直接用 `./runtime/node` 执行 scripts/build.mjs 或 `--experimental-strip-types --test test/*.test.mjs`。回环 HTTP 允许，真实账号和远端服务不在环境内。

本包不是 Git 仓库，不提交、推送或创建 worktree。允许修改范围、产品约定和报告要求见 TASK.md、CONTRACT.md。runtime、scripts 和已有测试只读。
