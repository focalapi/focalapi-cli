---
name: focalapi-chat
version: 2.0.0
description: "focalapi 的补充文本与音频命令。仅当用户明确要求通过 focalapi 做文本辅助，或实时模型契约明确存在可调用的音频模型时使用；图片/视频创作必须转 focalapi-gen。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi chat --help"
---

# focalapi 补充能力

本技能不是创作请求的默认入口。图片、视频、改图、图生视频统一转
`focalapi-gen`。

用户明确要求文本辅助时，先从实时列表取得可用文本模型，再调用：

```bash
focalapi models list --json
focalapi chat "<用户文本任务>" -m <列表中的文本模型> --json
```

音频命令只有在 `focalapi models get <model-id> --json` 与 `focalapi audio --help`
共同确认可执行时才能使用：

```bash
focalapi audio transcribe <file> -m <model-id> --json
focalapi audio speech "<text>" -m <model-id> -o <file> --json
```

模型列表里出现名称不等于 CLI 已支持调用。当前 Key 没有音频模型契约时应明确说明
暂不可用，不要尝试相似模型或外部接口。
