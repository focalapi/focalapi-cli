# focalapi 非 deepseek 模型稳定性/性能基准测试报告

- 日期：2026-08-05
- 工具：focalapi-cli@0.1.0（全局安装，profile: default）
- 环境：Windows 本机 → https://api.focalapi.com（洛杉矶搬瓦工）
- Key：sk-ts***z8Xp（test 令牌，无限额度）
- 测试目标：除 deepseek-v4-flash/pro 外全部 13 个模型（图像 10 + 视频 3）的稳定性与性能
- 原则：**结论只基于参数正确、无需纠偏的测试**（seedream 系首次 1024² 失败系测试方参数错误，不计入）

## 测试方法

| 项 | 说明 |
|---|---|
| 图像 | 10 模型 × 2 次，同一提示词 "a cute orange cat sitting on a wooden windowsill, soft morning sunlight, photorealistic"；seedream 系 2048×2048（模型硬性要求 3.69–16.78MP），其余 1024×1024 |
| 视频 | 3 模型 × 1 次，5s 1280×720，任务制计时（submit→start→finish 三段时间戳），产物下载验证非 0 字节 |
| 复现 | `bash .hermes/tmp/img-bench2.sh`（在 focalapi-llm 工作区）；视频用 `focalapi gen video -m <model> --seconds 5 --size 1280x720 --no-wait` + `focalapi task status <task_id>` |

## 图像生成结果（10 模型 × 2 次）

| 模型 | run1 | run2 | 成功率 | 性能评价 |
|---|---|---|---|---|
| doubao-seedream-4-5-251128 | ✅ 121.0s | ✅ 31.9s | 2/2 | ⚠️ 波动 4 倍（排队差异） |
| doubao-seedream-5-0-lite-260128 | ✅ 72.1s | ✅ 62.4s | 2/2 | 中等 |
| doubao-seedream-5-0-pro-260628 | ✅ 131.4s | ✅ 189.4s | 2/2 | 最慢（2–3 分钟） |
| gemini-3.1-flash-image-preview | ❌ 1.5s | ❌ 1.4s | 0/2 | **不可用（上游 key 失效）** |
| gemini-3.1-flash-lite-image-preview | ❌ 1.6s | ❌ 1.9s | 0/2 | **不可用（上游 key 失效）** |
| gemini-3-pro-image-preview | ❌ 1.2s | ❌ 1.6s | 0/2 | **不可用（上游 key 失效）** |
| gpt-image-2 | ✅ 33.6s | ✅ 38.3s | 2/2 | 稳定 |
| grok-imagine-image | ✅ 31.0s | ✅ 28.0s | 2/2 | 稳定 |
| grok-imagine-image-pro | ✅ 19.8s | ✅ 17.5s | 2/2 | 快且稳 |
| grok-imagine-image-quality | ✅ 18.8s | ✅ 18.6s | 2/2 | 快且稳 |

- 产物：19 张 PNG 落盘 focalapi-llm/focalapi-bench-img/，全部非 0 字节（241KB–5.9MB）
- 结论：可用图像模型 7/10，成功率 14/14 = 100%；gemini 系 3 个模型全线故障

## 视频生成结果（3 模型，5s 720p，24fps 含音轨）

| 模型 | 提交→完成 | 排队 | 纯生成 | 单次扣费(quota) |
|---|---|---|---|---|
| doubao-seedance-2-0-260128 | 130s | 8s | 122s | 340,273 |
| doubao-seedance-2-0-fast-260128 | 129s | 8s | 121s | 273,698 |
| doubao-seedance-2-0-mini-260615 | 127s | 7s | 120s | 170,136 |

- 产物：3 个 MP4 落盘 focalapi-llm/focalapi-bench-vid/，4.5–7.5MB，全部有效
- 结论：3/3 成功；**fast 版无速度优势**（差 1s），仅便宜 20%；mini 便宜 50% 且速度相同

### 视频复测（同提示词、5 秒、720p、16:9、24fps、含音频）

| 模型 | 提交→完成 | 排队 | 纯生成 | completion_tokens | 最终 quota |
|---|---:|---:|---:|---:|---:|
| doubao-seedance-2-0-260128 | 171s | 21s | 150s | 108,000 | 340,273 |
| doubao-seedance-2-0-fast-260128 | 153s | 35s | 118s | 108,000 | 273,698 |
| doubao-seedance-2-0-mini-260615 | 122s | 34s | 88s | 108,000 | 170,136 |

- 三个任务均成功，返回的 `total_tokens` 与 `completion_tokens` 均为 108,000；最终 quota 与官方 46/37/23 元每百万 Token 的相对价格完全一致，没有出现 10 倍加价或对音频再次加倍率。
- 复测的 Fast/Mini 为相近时间提交，排队条件并非严格受控，因此不能把本轮的 118s 解读为官方速度 SLA。两轮合看，Fast 的速度优势不稳定；应将其视为价格档位，而不是对用户承诺固定倍数的低延迟档。

## 问题清单

### CLI 缺陷（focalapi-cli@0.1.0）

| # | 问题 | 证据 | 建议修复 |
|---|---|---|---|
| C1 | **模型参数约束零声明** | `models get` 无尺寸/时长范围；seedream 传 1024² 得 400 才知道要求 3.69–16.78MP。对照 ark-cli：工作流强制「models get 查 supported_params → 再生成」 | CLI 内置模型约束表（或平台 API 补字段），gen 前校验并报"该模型支持 X-Y MP / 4-15s" |
| C2 | **错误信息不可诊断** | gemini 失败仅显示 `openai_error`，错误码误标 `invalid_api_key`（用户 key 有效，系上游通道 key 失效）→ 误导用户换自己的 key | 透传上游原始 message + request id；错误码与真实原因解耦 |
| C3 | **usage 表格打印 JSON 原文** | 周期用量显示 `{"object":"list","total_usage":1667.9882}` | 解析 billing 对象后格式化展示 |
| C4 | **同步图像生成无进度提示** | seedream-5-0-pro 干等 3 分钟零输出，无法区分卡死/生成中 | 输出"生成中…（已等待 Ns）"或进度轮询 |
| C5 | **models get 表格对象值原样 JSON.stringify** | `supported_endpoint_types` 显示 `"null"` 字符串 | 与 C3 一并修 |

### 平台问题（focalapi.com API / 后端）

| # | 问题 | 证据 | 备注 |
|---|---|---|---|
| P1 | **gemini 3 个图像模型全线不可用** | 6/6 请求 1.2–1.9s 失败 `invalid_api_key` | **已知问题复现**：2026-08-05 e2e 已记录"gemini-*-image 渠道 401（上游账户鉴权失效）"，至今未修复；建议修复或下架 |
| P2 | **models list 与 get 数据不一致** | list 返回 `supported_endpoint_types:[image-generation,openai]`，`GET /v1/models/{id}` 返回 `null` | 后端 model_meta 序列化不一致 |
| P3 | **模型元数据缺参数约束** | `/v1/models/{id}` 无尺寸/时长/数量范围字段（ark 平台有 supported_params） | 平台侧补元数据是 C1 的上游解 |
| P4 | **图像性能波动大** | seedream-4-5 同参数 121s vs 32s；5-0-pro 131s vs 189s | 同步接口对 agent 调用方不友好，建议提供任务制兜底 |
| P5 | **seedance-fast 名不副实** | 完成时间与标准版相同（差 1s），仅扣费低 20% | 定价/命名需复核，或上游并发限制所致 |

## 洞察

- **性能分层**：grok 系（18–31s）> gpt-image-2（34–38s）> seedream 系（32–189s）。推荐图像首选 grok-imagine-pro/quality；seedream-5-0-pro 除非要高质量否则 3 分钟等待不值。
- **seedance 选 mini**：速度无差别、价格砍半；fast 是伪需求。
- **错误链路黑盒是 agent 集成最大风险**（C2/P1）：`openai_error` 折叠错误让调用方无法区分重试/换 key/放弃，属最优先修复项。

## 附注

- 本报告为稳定性基准，非峰值压力测试；性能波动含排队因素（Comfy Cloud 队列）。
- 测试脚本：focalapi-llm/.hermes/tmp/img-bench2.sh（v1 为参数错误版本已废弃）；如需长期复用建议正式化进 focalapi-cli 仓（scripts/bench + npm run bench）。
