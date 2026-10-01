# 结构与运行边界

- src/preview：回环 HTTP HTML 预览、资源响应与临时目录。
- src/cache：远程文件本地缓存、共享下载、附件暂存与回收。
- src/transport：设备文件读取策略、传输任务与队列。
- src/path：跨平台工作目录与相对路径转换。
- src/security：预览内容安全策略。
- runtime：独立运行所需的平台适配，以及本地目录模拟远端设备的工作区入口。
- scripts：模块加载检查和命令行演示。
- test：已有基础测试；fixtures：普通演示文件。

src 是从 Cindy 生产功能抽取的代码。runtime/platform.ts 用独立数据目录和模拟身份代替 Electron userData、账号服务与日志。工作区适配使用本地目录模拟远端内容，文件复制、缓存、HTTP 服务均真实执行。

无需 Electron、账号登录、远端服务或额外 npm 依赖。Node 的 TypeScript strip 仅做解析和加载，不是完整 tsc 类型检查。本项目不证明真实手机 UI、生产网络或原生窗口行为。文档是产品约定，测试不是完整规格。
