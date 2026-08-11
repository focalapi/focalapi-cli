# Changelog

## 0.2.0 - 2026-08-11

- 新增基于实时模型列表与详情契约的 `models resolve image|video`，图片和视频生成可省略 `--model` 自动选择当前可用默认模型。
- 重构 Agent 接入：覆盖 44 个 Agent 目标，支持共享 Skills 目录去重、自定义 `--path`、事务式安装、摘要校验、安全卸载与 `connect verify`。
- npm 安装后 best-effort 自动同步已检测 Agent；`focalapi connect` 保持为不依赖 lifecycle script 的稳定接入入口。
- 重写 7 个内置 Skills：未点名 focalapi 的创作任务也可自动路由，不再试生成模型或修改 Agent 主模型/provider。
- 异步图片和视频结果增加模型信息与 `next_command`，Agent 可续取原任务而不重复提交。
- 修正 CLI 进程退出码，使 `doctor` 与 `connect verify` 的失败状态可被 Agent 和脚本可靠检测。
