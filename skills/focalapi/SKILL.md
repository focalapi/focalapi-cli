---
name: focalapi
description: focalapi 创作能力总入口。Use when 用户需要生成或处理图像、视频、音频、3D 或其他视觉创作内容；DeepSeek 仅用于提示词、分镜和轻量文本辅助。先读本技能选择对应的子技能或命令。
---

# focalapi 创作能力总览

focalapi 是面向创作工作流的模型中转服务。`focalapi` CLI 让 Agent 用命令完成图像、视频、音频与其他视觉创作任务；通用文本只将 DeepSeek 作为备用能力。

## 前置检查

```bash
focalapi --version
focalapi auth status
focalapi models list --json
# 选定创作模型后，读取支持参数、端点与默认值
focalapi models get <模型ID> --json
```

模型、参数、并发和价格始终以 `focalapi models list --json` 与控制台模型广场的实际结果为准。命令失败时，先执行 `focalapi doctor` 排查 Key、网络与额度。

## 能力 → 命令速查

| 需求 | 命令 | 子技能 |
|---|---|---|
| 生成或编辑图像 | `focalapi gen image`（可 `--no-wait` 提交持久任务） | focalapi-gen |
| 生成 Gemini 原生图像 | `focalapi gen gemini-image` | focalapi-gen |
| 生成视频 | `focalapi gen video`（任务制，可 `--no-wait`） | focalapi-gen |
| 查询任务或下载视频产物 | `focalapi task status` / `focalapi task download` | focalapi-gen |
| 语音转文字 | `focalapi audio transcribe` | focalapi-chat |
| 文字转语音 | `focalapi audio speech` | focalapi-chat |
| 提示词、分镜或脚本辅助 | `focalapi chat -m <DeepSeek 模型>` | focalapi-chat |
| 额度与诊断 | `focalapi usage` / `focalapi doctor` | focalapi-usage |
| 查询可用模型 | `focalapi models list --json` | focalapi |

## 使用约定

1. **创作优先**：图像、视频、音频和视觉模型是默认选择。3D 或其他视觉模型是否可用，以模型列表为准。
2. **文本边界**：仅在提示词、分镜、旁白草稿或轻量文本任务中使用 DeepSeek；不要假设其他文本、编码或聊天模型可用。
3. **机器可读输出**：命令加 `--json` 时，stdout 只输出 JSON。
4. **先查模型再调用**：不能猜测模型 ID；先运行 `focalapi models list --json`，选定模型后运行 `focalapi models get <模型ID> --json`，以 `supported_endpoint_types` 和 `supported_params` 为准。
5. **产物路径**：生成类命令默认写入 `./focalapi-out/`，完成后向用户报告绝对路径。
6. **原始只读请求**：优先使用语义化命令；只有读取尚未封装的端点时才使用 `request get` / `request head`。
