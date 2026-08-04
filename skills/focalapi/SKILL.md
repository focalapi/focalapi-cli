---
name: focalapi
description: focalapi 能力总入口。Use when 用户要求使用 focalapi / focalapi-cli，或需要调用 focalapi 的对话、图像、视频、搜索、音频、向量、重排、用量等任意模型能力。先读本技能确定该用哪个子技能/命令。
---

# focalapi 能力总览

focalapi 是统一的 AI 模型 API 网关（OpenAI 兼容），`focalapi` CLI 让 Agent 一条命令调用全部能力。

## 前置检查

```bash
focalapi --version          # 确认 CLI 已安装
focalapi auth status        # 确认 Key 有效、看额度
focalapi doctor             # 全链路自检（用免费演练模型，不花额度）
```

任何命令失败，先跑 `focalapi doctor` 按提示修复（Key 缺失 → `focalapi auth login --key <sk-...>`）。

## 能力 → 命令速查

| 需求 | 命令 | 子技能 |
|---|---|---|
| 对话/总结/翻译/看图 | `focalapi chat` | focalapi-chat |
| 生成图片 | `focalapi gen image` | focalapi-gen |
| 生成视频 | `focalapi gen video`（任务制，可 `--no-wait`） | focalapi-gen |
| 联网搜索 | `focalapi search` | focalapi-search |
| 语音转文字 | `focalapi audio transcribe` | focalapi-chat |
| 文字转语音 | `focalapi audio speech` | focalapi-chat |
| 文本向量化 | `focalapi embed` | focalapi-chat |
| 文档重排序 | `focalapi rerank` | focalapi-chat |
| 额度/用量 | `focalapi usage` / `focalapi auth status` | focalapi-usage |
| 诊断排障 | `focalapi doctor` | focalapi-usage |

## Agent 使用约定

1. **机器可读输出**：所有命令加 `--json`，stdout 是纯净 JSON，可直接 `jq` 解析。
2. **模型选择**：先 `focalapi models list --json` 拿当前 Key 可用模型，不要猜模型名。
3. **演练模型**：`focal-rehearsal-chat` 免费，适合做链路验证和演示。
4. **产物路径**：生成类命令默认写入 `./focalapi-out/`，把绝对路径告诉用户。
5. **非交互**：本 CLI 在非 TTY 环境全自动（无提示无动画），认证用环境变量 `FOCALAPI_API_KEY` 或已保存的配置。
