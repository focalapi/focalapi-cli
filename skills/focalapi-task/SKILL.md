---
name: focalapi-task
version: 2.0.0
description: "续取 focalapi 图片/视频异步任务并下载产物。当生成结果包含 task_id/next_command，或用户问进度、失败原因、结果文件时使用；必须复用原 task_id，不重复生成。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi task --help"
---

# focalapi 异步任务闭环

生成命令返回 `task_id` 后，以响应里的 `next_command` 为第一选择：

```bash
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./focalapi-out --json
```

- `pending` / `running`：仍是同一个有效任务，稍后查询；不要重提生成请求。
- `success`：执行 download，检查文件存在，并把绝对路径交给用户。
- `failed`：展示上游错误摘要和 hint；只有参数/内容问题被明确指出时才重新生成。
- `unknown`：保留原始响应并运行 `focalapi doctor --json`，不要伪造成功状态。

轮询要有边界；用户没有要求阻塞等待时，汇报当前状态和 `task_id` 即可。
