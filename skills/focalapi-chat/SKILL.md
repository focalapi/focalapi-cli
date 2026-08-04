---
name: focalapi-chat
description: 用 focalapi 做对话、多模态理解（看图）、embedding 与 rerank。Use when 需要文本生成/总结/翻译/问答、理解图片内容、文本向量化或文档重排序。
---

# focalapi 对话与理解

## 对话

```bash
# 基础（模型名先从 focalapi models list 获取；演练用免费 focal-rehearsal-chat）
focalapi chat "用一句话总结 RAG" -m <model>

# 管道输入（处理长文本/文件内容）
cat report.md | focalapi chat -m <model> --system "你是严谨的技术编辑"

# 看图（多模态）
focalapi chat "描述这张图的 UI 布局" -m <多模态模型> --input @screenshot.png

# 机器可读输出（Agent 串联）
focalapi chat "提取关键日期" -m <model> --json
```

- `--stream` / `--no-stream` 控制流式（TTY 默认流式，`--json` 默认非流式）。
- `--input` 支持多张图片；txt/md/json 文件会作为文本拼入。
- 默认模型可用 `FOCALAPI_MODEL` 环境变量固定。

## 向量化

```bash
focalapi embed "待编码文本" -m <embedding模型> --json
focalapi embed -m <model> --input @doc.txt --json
```

## 重排序

```bash
focalapi rerank -m <rerank模型> --query "用户问题" --docs @docs.json --json
# docs.json 是字符串数组
```

## 音频

```bash
focalapi audio transcribe meeting.mp3 -m <转写模型>          # 语音→文字
focalapi audio speech "大家好" -m <TTS模型> --voice alloy -o out.mp3
```

## 排错

失败先 `focalapi doctor`；报 model_not_found 时 `focalapi models list --filter <关键字>` 确认模型名。
