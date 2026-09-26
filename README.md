# Cindy 实战评测题库

版本化的真实项目修复与自主查错题库，供 Cindy 评测工坊使用。

## 阅读入口

- [出题原则](docs/authoring-principles.md)
- [题面与交付规范](docs/task-contract.md)
- [评分规则](docs/scoring.md)
- [冻结前检查清单](docs/calibration-checklist.md)
- [版本与发布](docs/versioning.md)
- [历史演进](docs/history.md)

每题满分 1 分，按冻结能力组评估实际交付行为。源码、评分器与控制样本可审阅；答题时只向模型提供 candidate 材料。公开评分器不能替代运行时隔离，能够接触作者资料的作答必须单列。

当前下载资产保留在 [eval-bank-20260925 Release](https://github.com/makecindy/eval-bank/releases/tag/eval-bank-20260925)。该日期是发布快照标识，不是 Cindy 客户端版本。运行包目前限定 macOS Apple Silicon；不宣称支持其他平台。

大体积运行时与冻结快照放 Release，Git 保存规则、维护源码和校验清单。历史成绩与环境无效记录分开，未知费用不补零。
