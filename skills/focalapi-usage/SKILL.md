---
name: focalapi-usage
description: 查询 focalapi 额度/用量/账单，以及用 doctor 做链路诊断。Use when 用户问余额、用量、花了多少、Key 什么时候过期，或任何 focalapi 调用失败需要排障。
---

# focalapi 用量与诊断

## 额度与用量

```bash
focalapi auth status            # Key 有效性 + 剩余额度 + 过期时间
focalapi usage                  # 令牌额度 + 本周期账单用量
focalapi usage --start 2026-08-01 --end 2026-08-05 --json
```

额度字段说明：`total_granted` 总额度、`total_used` 已用、`total_available` 剩余、`unlimited_quota` 为 true 表示不限额。

## 诊断（doctor）

任何 focalapi 调用失败，第一步永远是：

```bash
focalapi doctor            # 人读报告
focalapi doctor --json     # 机读报告（checks 数组，每项 ok/detail/hint）
```

检查链：Key 解析 → 网络与鉴权（GET /v1/models）→ 端到端推理（focal-rehearsal-chat 免费演练模型，不耗额度）→ 额度。

- 全部 ✓：链路正常，问题在调用参数（对照命令 --help）。
- 任一 ✗：按该项 hint 修复；退出码非零适合脚本判断。

## 成本控制建议

- 演示/联调一律用 `focal-rehearsal-chat`（免费）。
- 生成类操作前先 `focalapi usage` 确认额度充足。
- 视频是任务制计费，优先用 `--seconds` 显式控制时长。
