# 恢复与复现

Git 中的 candidate 是便于审查的源码子集，不是完整运行包。尤其灵动岛、恢复与输入框需要完整冻结 Cindy 基底；不能直接在裁剪目录运行评分并声称覆盖完整保护门。

先从既有 Release 下载资产到独立目录，再恢复需要的题目：

```sh
gh release download eval-bank-20260925 --repo makecindy/eval-bank --dir ./release-assets
python3 scripts/restore-release.py audio@v2 ./release-assets ./restored/audio-v2
```

恢复器验证资产大小/SHA-256、每个文件哈希、文件集合与安全路径，保留可执行位，不执行下载代码。目标必须不存在。失败目录仅供诊断，不能用于评测；重新选一个新目录重试。

恢复后复制 candidate 到独立作答目录，模型只接触该副本。作答结束由可信评分侧执行：

```sh
python3 -B restored/audio-v2/author/grade.py /absolute/submission /absolute/output.json
```

评分会执行候选代码，只对可信题包与受控作答使用；本脚本不是系统沙箱。

`reference-overlay/` 保存原作者参考修复的代码差异，供审阅，不直接构成完整参考运行闭包。18个版本中5个 legacy-normalized-v1 仅用于历史成绩归一；公开Release可恢复的是当前7题。其余历史版本当前只发布定义与参考差异，不宣称已能完整恢复。原始作者完整快照与未脱敏过程日志没有混入此仓。

`source-export.json` 和 `versions.json` 明确导出边界；原始清单哈希只是来源标识，不能把裁剪或脱敏文件宣称为原始冻结快照。
