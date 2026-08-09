---
name: focalapi-gen
description: 用 focalapi 生成图片、Gemini 原生图片或视频，并跟踪或下载异步产物。Use when 用户要画图、图生图、生成视频，或查询/下载生成任务。
---

# focalapi 图片与视频生成

先选模型、再读实时契约；不要复用过期模型名或参数。

```bash
focalapi models search image --endpoint image-generation --json
focalapi models search video --endpoint video-generation --json
focalapi models get <model-id> --json
```

## 图片

```bash
# OpenAI 图片
focalapi gen image "产品主视觉，工作室柔光" -m gpt-image-2 \
  --size 1536x1024 --quality high --background opaque -o ./out

# Seedream：size 可使用模型允许的档位；水印、格式和提示词优化为原生字段
focalapi gen image "未来城市夜景海报" -m seedream-5-0-260128 \
  --size 3k --watermark false --output-format jpeg --optimize-prompt disabled -o ./out

# Grok 图像：使用 aspect-ratio、resolution 和 seed，不要改写成 Seedream 参数
focalapi gen image "电影感海岸线" -m grok-imagine-image-quality \
  --aspect-ratio 16:9 --resolution 2k --seed 7 -o ./out

# Gemini 必须走原生 generateContent 命令
focalapi gen gemini-image "水彩橘猫" -m gemini-3.1-flash-image \
  --aspect-ratio 16:9 --image-size 2K -o ./out
```

- 编辑图使用 `--image <url...>`；`gpt-image-2` 的 `--mask` 需要恰好一张参考图。
- `gen image --no-wait --json` 返回 `task_id`；带 `--no-wait` 时不能用 `--response-format b64_json`。
- Gemini Lite 的 `--thinking-level`、`--temperature`、`--top-p` 仅适用于 `gemini-3.1-flash-lite-image`。

## 视频

```bash
# Seedance 2.0：ratio、resolution 和 priority
focalapi gen video "海浪拍打礁石，电影感" -m dreamina-seedance-2-0-260128 \
  --seconds 5 --resolution 720p --ratio 16:9 --priority 4 --no-wait --json

# Seedance 2.5 最长 30 秒；不支持 priority
focalapi gen video "产品旋转展示" -m dreamina-seedance-2-5-260628 \
  --seconds 12 --resolution 720p --ratio 16:9 --no-wait --json

# Grok 视频：使用 aspect-ratio 与 seed，不能传 --ratio
focalapi gen video "航拍海岸线" -m grok-imagine-video-1.5 \
  --seconds 6 --resolution 1080p --aspect-ratio 16:9 --seed 7 --no-wait --json
```

- Seedance 2.0 系列时长为 4–15 秒；2.5 为 4–30 秒；Grok 视频为 1–15 秒。实际可用范围以 `models get` 为准。
- 视频默认轮询到完成并下载。编排长任务时用 `--no-wait --json`，然后执行 `focalapi task status <task-id> --json` 和 `focalapi task download <task-id> -o ./out`。
- 使用 `--content <json>` 时，内容进入 `metadata.content`；仍需使用已验证的模型和参数。
