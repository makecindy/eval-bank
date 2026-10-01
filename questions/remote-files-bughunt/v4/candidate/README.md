# Remote File Workspace

一个可独立运行的远程文件浏览与 HTML 预览项目。

要求 Node.js 22.18 或以上；无需安装依赖。

```sh
npm run build
npm test
npm start
```

`npm start` 输出预览地址，可在本机浏览器打开，Ctrl+C 退出。默认缓存写入 `.local-data/`，可通过 `PROJECT_DATA_DIR` 指定隔离目录。测试使用临时目录与回环 HTTP，不访问真实账号或服务。

开始前阅读 TASK.md、documentation/product.md 和 documentation/architecture.md。
