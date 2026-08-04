---
name: focalapi-gen
description: 用 focalapi 生成图片和视频（产物自动下载到本地）。Use when 用户要画图、生成海报/插画/logo、图生图、文生视频、或查询/下载视频生成任务产物。
---

# focalapi 图像与视频生成

## 图片（同步）

```bash
focalapi gen image "未来城市夜景海报，赛博朋克风" -m <图像模型> --size 1024x1024 -o ./out
# 多张：--n 4（上限 128）
```

产物保存到 `-o` 目录（默认 `./focalapi-out/`），stdout/stderr 会打印绝对路径，把路径直接交给用户或后续步骤。

## 视频（任务制）

```bash
# 方式一：前台等待完成并自动下载（默认）
focalapi gen video "海浪拍打礁石，电影感" -m <视频模型> --seconds 5 -o ./out

# 方式二：异步——Agent 做长任务编排时推荐
focalapi gen video "..." -m <视频模型> --no-wait --json     # 立即拿 task_id
focalapi task status <task_id> --json                      # 轮询状态
focalapi task download <task_id> -o ./out                  # 完成后取 mp4
```

- `--seconds` 上限 3600（CLI 与后端双重 clamp，超限直接报错）。
- 轮询参数：`--poll-interval <ms>`（默认 5000）、`--timeout <分钟>`（默认 30）。
- 产物下载走 focalapi 内容代理（`/v1/videos/:task_id/content`），不依赖上游签名 URL，不过期。

## JSON 输出约定（供 Agent 解析）

- `gen image --json` → `{"files": ["..."], "count": N}`
- `gen video --no-wait --json` → `{"task_id": "...", "submitted": true}`
- `gen video --json`（等待模式）→ `{"task_id": "...", "status": "success", "file": "..."}`
- `task status --json` → `{"task_id","status":"pending|running|success|failed|unknown","progress","raw"}`

## 排错

- 任务失败：`focalapi task status <task_id> --json` 看 `raw` 里上游详情。
- 模型名不确定：`focalapi models list --filter video` / `--filter image`。
