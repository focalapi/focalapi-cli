---
name: focalapi-task
description: 跟踪 focalapi 图片或视频异步任务并下载完成产物。Use when 生成命令返回 task_id，或用户要求查询进度、失败原因和产物文件。
---

# focalapi 异步任务

长任务优先提交后返回，避免在一次会话中盲等。

```bash
focalapi gen image "..." -m <model-id> --no-wait --json
focalapi gen video "..." -m <model-id> --no-wait --json
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./out
```

- `task status --json` 的 `status` 为 `pending`、`running`、`success`、`failed` 或 `unknown`；失败时检查 `raw` 中的上游详情。
- 只在状态为 `success` 后下载；把最终绝对路径交给用户或后续步骤。
- 需要同步等待时，视频生成可使用 `--poll-interval` 和 `--timeout`；不要以轮询替代模型和参数预检。
