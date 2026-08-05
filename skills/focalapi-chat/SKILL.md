---
name: focalapi-chat
description: 用 DeepSeek 作为创作流程的文本备用能力，并通过 focalapi 处理音频转写和语音合成。Use when 用户需要提示词、分镜、脚本草稿、看图辅助、音频转写或文字转语音。
---

# focalapi 文本辅助与音频

## DeepSeek 文本辅助

DeepSeek 是 focalapi 唯一对外展示的通用文本备用能力。先查询可用模型，再用于提示词、分镜、旁白与轻量脚本任务：

```bash
focalapi models list --json
focalapi chat "把这个产品简介写成 6 镜头分镜" -m <DeepSeek模型>
```

- 不要猜测模型 ID，也不要假设其他文本或编码模型可用。
- 需要结构化输出时使用 `--json`；长结果可加 `--stream`。
- `--input @image.png` 可把图片作为辅助输入；图像生成请改用 `focalapi gen image`。

## 音频

```bash
focalapi audio transcribe interview.mp3 -m <转写模型>
focalapi audio speech "这里是一段旁白" -m <语音模型> -o narration.mp3
```

- 音频模型、可用音色和格式以 `focalapi models list --json` 为准。
- 批量任务前先用短样本确认质量和单价。
