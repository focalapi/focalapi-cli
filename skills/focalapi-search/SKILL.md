---
name: focalapi-search
description: 用 focalapi 联网搜索。Use when 需要实时信息、新闻、资料检索、事实核查，或用户明确要求"搜一下/查一下"。
---

# focalapi 联网搜索

```bash
focalapi search "过去7天 AI 行业重要新闻" -m <搜索模型> --json
```

- 端点为 `/v1/alpha/search`（alpha 级，响应结构由上游定义）；`--json` 原样透传，pretty 模式尽力解析为结果表格。
- 搜索模型名先确认：`focalapi models list --filter search`。

## 自定义请求体（逃生门）

上游格式变更或需要高级参数时，用 `--raw` 直接控制请求体：

```bash
focalapi search "查询" -m <model> --raw '{"query":"...","search_depth":"advanced"}' --json
focalapi search x -m <model> --raw @body.json
```

## 典型编排

搜索 → 把 `--json` 结果交给 `focalapi chat` 做摘要/分析：

```bash
focalapi search "主题" -m <搜索模型> --json > results.json
cat results.json | focalapi chat -m <对话模型> --system "把输入的搜索结果整理成 5 条要点"
```
