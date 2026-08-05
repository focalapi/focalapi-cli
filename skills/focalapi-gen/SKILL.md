---
name: focalapi-gen
description: 用 focalapi 生成图片和视频（产物自动下载到本地）。Use when 用户要画图、生成海报/插画/logo、图生图、文生视频、或查询/下载视频生成任务产物。
---

# focalapi 图像与视频生成

## 图片（同步）

调用创作模型前，先读取它的机器可读契约；不要猜测尺寸、时长或原生端点：

```bash
focalapi models get <模型ID> --json
```

响应中的 `supported_endpoint_types` 指明应使用的 API 协议，`supported_params` 列出参数、默认值、枚举和边界。CLI 会提前拒绝已知无效参数；应修正参数，不要将同一参数重试给上游。

```bash
focalapi gen image "未来城市夜景海报，赛博朋克风" -m <图像模型> --size 1024x1024 -o ./out
# 多张：--n 4（上限 128）
# 参考图/编辑：image 可重复给 URL；response-format 只接受 url 或 b64_json
focalapi gen image "将背景改为雨夜" -m gpt-image-2 --image https://example.com/source.png \
  --mask https://example.com/mask.png --response-format b64_json -o ./out
# 长任务编排：--no-wait 要求服务端持久化任务，返回 task_id；图像结果从 task status 的 raw.data 读取 URL
focalapi gen image "未来城市夜景海报，赛博朋克风" -m gpt-image-2 --size 1024x1024 --no-wait --json
focalapi task status <task_id> --json

# Gemini 图像模型必须走原生 Gemini generateContent 端点，不能使用 gen image
focalapi gen gemini-image "未来城市夜景海报，赛博朋克风" -m gemini-3.1-flash-image-preview \
  --aspect-ratio 16:9 --image-size 2K -o ./out
# Gemini named flags cover --image, --system, --seed, --thinking-level, --temperature, and --top-p.
# For another documented generationConfig field, use --config; the command keeps responseFormat.image and candidateCount=1 authoritative.
```

产物保存到 `-o` 目录（默认 `./focalapi-out/`），stdout/stderr 会打印绝对路径，把路径直接交给用户或后续步骤。

## 视频（任务制）

```bash
# 方式一：前台等待完成并自动下载（默认）
focalapi gen video "海浪拍打礁石，电影感" -m <视频模型> --seconds 5 -o ./out

# Seedance 2.0：使用模型原生参数。Fast/Mini 只支持 480p 和 720p；所有 Seedance 2.0 时长为 4–15 秒。
focalapi gen video "海浪拍打礁石，电影感" -m doubao-seedance-2-0-260128 \
  --seconds 5 --resolution 720p --ratio 16:9 --generate-audio true --no-wait --json

# 图生视频与 Seedance 的任务控制参数会映射到请求 metadata；布尔参数必须显式为 true 或 false
focalapi gen video "让海浪缓慢推进" -m doubao-seedance-2-0-260128 \
  --image https://example.com/frame.png --generate-audio false --watermark true \
  --return-last-frame true --callback-url https://example.com/callback \
  --execution-expires-after 7200 --safety-identifier customer-42 --priority 4 --no-wait --json

# Ark-compatible metadata.content keeps native text/image_url/video_url/audio_url items and roles unchanged:
focalapi gen video "ignored when content is supplied" -m doubao-seedance-2-0-260128 \
  --content '[{"type":"text","text":"A cinematic ocean wave."}]' --no-wait --json

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
- `gen image --no-wait --json` → `{"task_id": "...", "status": "queued", "submitted": true}`
- `gen gemini-image --json` → `{"files": ["..."], "count": N}`
- `gen video --no-wait --json` → `{"task_id": "...", "submitted": true}`
- `gen video --json`（等待模式）→ `{"task_id": "...", "status": "success", "file": "..."}`
- `task status --json` → `{"task_id","status":"pending|running|success|failed|unknown","progress","raw"}`

## 排错

- 任务失败：`focalapi task status <task_id> --json` 看 `raw` 里上游详情。
- 模型名不确定：`focalapi models list --filter video` / `--filter image`。
