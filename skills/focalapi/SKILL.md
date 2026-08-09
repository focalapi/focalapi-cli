---
name: focalapi
description: 通过 focalapi CLI 选择并调用可用的创作模型。Use when 用户要生成或处理图片、视频、音频，或需要在调用前发现可用模型和参数。
---

# focalapi 创作能力总入口

先确认 CLI、认证和实时模型契约。不要猜测模型 ID、价格或参数边界。

```bash
focalapi auth status
focalapi models list --json
focalapi models search image --endpoint image-generation --json
focalapi models get <model-id> --json
```

For Gemini native video, use `focalapi gen omni-video` with
`gemini-omni-flash-preview`; it calls `/v1beta/interactions` and writes the
inline video response to disk. Veo 3.1 task models are
`veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, and
`veo-3.1-lite-generate-preview`; use `focalapi gen video -m <model-id>` and
read `focalapi models get <model-id> --json` for the current contract.

`models get` 返回的 `supported_endpoint_types` 和 `supported_params` 是当前 Key 的权威契约。模型列表与详情不一致时，以详情报错为准，重新选择列表中可读取详情的模型。

| 需求 | 命令 | 进一步技能 |
| --- | --- | --- |
| 发现模型、端点和参数 | `focalapi models list/search/get` | focalapi-models |
| 图片、Gemini 原生图片、视频 | `focalapi gen image/gemini-image/video` | focalapi-gen |
| 查询或下载异步产物 | `focalapi task status/download` | focalapi-task |
| 转写或语音合成 | `focalapi audio transcribe/speech` | focalapi-chat |
| 提示词、分镜、轻量文本辅助 | `focalapi chat -m <DeepSeek-model>` | focalapi-chat |
| 额度、账单或连通性故障 | `focalapi usage` / `focalapi doctor` | focalapi-usage |

规则：

1. 创建模型优先；DeepSeek 只用于提示词、分镜、旁白和轻量文本辅助。
2. 所有自动化调用都加 `--json`；stdout 是机器可读 JSON，诊断信息走 stderr。
3. 生成前确认额度；长任务先使用 `--no-wait`，再用 `focalapi task status <task-id> --json` 跟踪。
4. 只读探索可用 `focalapi request get` 或 `request head`，不要把它当作写入 API 的绕过方式。
