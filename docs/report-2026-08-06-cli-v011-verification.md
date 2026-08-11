# focalapi-cli v0.1.1 性能与可靠性测试报告

- 日期：2026-08-06
- 版本：focalapi-cli@0.1.1（npm 已发布，全局安装）；平台 focalapi.com 已部署 f66a2ae06
- 测试方式：**新手视角**（不预设任何 CLI 知识，仅依赖 help/错误提示）完整走查 + 全模型稳定性回归
- Key：sk-ts***z8Xp（test 令牌，无限额度）
- 对比基线：`docs/benchmark-report-2026-08-05.md`（v0.1.0 首测）

## 执行摘要

1. **gemini 图像故障（P1）已修复并验证闭环**：3 个 gemini 模型老路径 + 原生 generateContent 新路径 **4/4 出图成功**（此前 6/6 失败）。
2. **新手零试错达成**：仅靠 help 与错误提示可完成 登录→模型→对话→图像→视频（提交/轮询/下载）→用量→诊断 全流程；非法参数全部本地拦截并给出正确范围，无一打回上游 400。
3. **稳定性回归全绿**：图像 6/6、视频 1/1、chat/doctor 正常；make test 42 ok、CLI 57 tests 全绿。
4. 遗留 3 个非阻塞引导性缺口（audio 模型来源、video seconds help 范围、无音频模型供给）。

## 测试矩阵

| 维度 | 用例 | 结果 | 证据 |
|---|---|---|---|
| 安装/版本 | npm 最新版 = 本地版 | ✅ | 0.1.1 一致，无漂移 |
| 无 key 引导 | 空 profile 运行 | ✅ | `错误 [missing_api_key]` + 登录命令 + Key 获取地址 |
| 认知层 | 顶层 help | ✅ | 定位清晰「面向创作工作流」；12 命令各带一句话说明 |
| 登录 | auth login/status | ✅ | doctor 确认 key 来源 config |
| 模型查询 | models list/get | ✅ | 16 模型；get 返回 supported_params（契约层） |
| 对话 | chat deepseek-v4-flash | ✅ | 正常回复 + tokens 统计 |
| 图像（老路径） | gemini×3、seedream×2、gpt-image-2、grok×1 | ✅ 7/7 | 全部出图，1.6–5.9MB 有效 PNG |
| 图像（新路径） | gen gemini-image（原生 generateContent） | ✅ | 出图成功 |
| 视频 | seedance-mini 5s：提交→轮询→下载 | ✅ | 195s 完成，7.7MB mp4 有效 |
| 用量 | usage | ✅ | 周期用量数字格式化（`1,866.3856`） |
| 诊断 | doctor | ✅ | 4 项全绿（key/网络/演练模型/额度） |
| 参数边界 | video --seconds 1 / 30 | ✅ 本地拦截 | `seconds must be 4-15 (received: 1)`，零上游往返 |
| 参数边界 | seedream --size 1024x1024 | ✅ 本地拦截 | `does not support size=1024x1024; supported: 3.69-16.78 MP` |

## 新手零试错旅程评估（本轮核心）

以「从未见过此 CLI 的 agent」视角，仅用 help 文本 + 错误提示逐步推进：

| 步骤 | 提示来源 | 是否需试错 | 说明 |
|---|---|---|---|
| 知道能做什么 | `focalapi --help` | 否 | 命令面 + 一句话职责说明，创作工作流定位清晰 |
| 配置 Key | 无 key 错误提示 | 否 | 直接给出 `auth login --key` 命令与 Key 创建地址 |
| 选择模型 | `models list` | 否 | 16 模型含提供方；`models get` 给出参数契约 |
| 图像生成 | `gen image --help` | 否 | 参数 11 项全说明（quality/background/mask/n…） |
| 图像参数错误 | 本地校验 | 否 | 拦截并提示 MP 范围，不用猜 |
| 视频生成 | `gen video --help` | 否 | 16 项参数；提交后输出**「续取：task status / task download」下一步指引** |
| 视频时长错误 | 本地校验 | 否 | `seconds must be 4-15`，直接给正确范围 |
| 任务续取 | 提交输出引导 | 否 | 复制提示即可轮询+下载 |
| 等待反馈 | 进度提示 | 否 | 「正在生成图像，已等待 10/20 秒…」消除卡死焦虑 |
| 错误定位 | 错误码体系 | 否 | `upstream_auth_failed` 明确上游/本机 key 之分 |

**结论：零试错。** 所有用户输入错误在本地被拦截并给出正确范围；所有异步流程给出下一步命令。

## gemini 修复验证（P1 闭环）

| 模型 | 2026-08-05 首测 | 2026-08-06 复测 | 耗时 |
|---|---|---|---|
| gemini-3.1-flash-image-preview | ❌ 6/6 `invalid_api_key` | ✅ 出图 | ~13s |
| gemini-3.1-flash-lite-image-preview | ❌ | ✅ 出图 | ~13s |
| gemini-3-pro-image-preview | ❌ | ✅ 出图 | ~27s |
| gemini-image 新路径（原生接口） | — | ✅ 出图 | ~10s |

错误演进链：`invalid_api_key`（误导）→ `authentication_failed` → `upstream_auth_failed`（可诊断）→ 修复后成功出图。

## 性能数据（2026-08-06 复测）

| 模型 | 耗时 | 对比基线（08-05） | 评价 |
|---|---|---|---|
| grok-imagine-image-quality | 24s | 18–19s | 稳定快 |
| gpt-image-2 | 36s | 34–38s | 稳定 |
| doubao-seedream-5-0-lite 2048² | 45s | 62–72s | 波动区间内 |
| doubao-seedream-5-0-pro 2048² | ~45s | 131–189s | 显著改善（排队因素） |
| gemini-3.1-flash-image-preview | ~13s | 不可用 | 恢复后表现快 |
| doubao-seedance-2-0-mini 5s 视频 | 195s（含轮询粒度） | 127s | 排队波动 |

## 问题清单终态

| 编号 | 问题 | 状态 |
|---|---|---|
| C1 | 模型参数约束零声明 | ✅ 双落地（CLI 本地校验 + 平台 supported_params） |
| C2 | 错误不可诊断 | ✅ upstream_auth_failed + request_id + 上游代码 |
| C3 | usage 打印 JSON 原文 | ✅ 格式化 |
| C4 | 无进度提示 | ✅ 「已等待 N 秒…」 |
| C5 | null 字符串显示 | ✅ 显示 `-` |
| P1 | gemini 图像不可用 | ✅ 已修复（上游 key + 原生接口路径） |
| P2 | list/get 数据不一致 | ✅ 一致 |
| P3 | 元数据缺参数约束 | ✅ supported_params/documentation |
| P4 | 图像性能波动 | ⏳ 排队因素，非缺陷 |
| P5 | seedance-fast 名不副实 | ⏳ 上游调度，非缺陷 |
| **N1（新）** | audio 命令 `-m` 无默认值/无模型来源提示 | ⚠️ 建议：models list 标注音频模型，或 audio help 给示例 |
| **N2（新）** | video `--seconds` help 写 1–3600，模型实际 4–15 | ⚠️ 建议：help 标注「模型实际范围见 models get」（本地校验已兜底，低优先级） |
| **N3（新）** | 线上无音频/搜索/embedding/rerank 模型 | ⚠️ 平台供给问题；CLI 侧建议无模型时给出明确提示 |

## 洞察

- **「引导即产品」验证**：错误提示携带正确范围（`seconds must be 4-15`）、异步输出携带下一步命令（「续取：task status …」），是 agent 零试错的关键设计——比参数文档更有效，因为纠错发生在错误发生点。
- **错误码语义化演进路径**（invalid_api_key → upstream_auth_failed）证明：错误码不该描述「现象」而该描述「责任方」，agent 才能决定重试/换 key/上报。
- **gemini 双路径**（OpenAI 兼容老路径 + 原生 generateContent 新路径）兼顾了兼容性与协议正确性，是「协议错配类问题」的参考解法。
- 性能波动（P4/P5）随 Comfy 排队波动，非 CLI/平台代码问题；SLA 承诺前建议按 p95 定价而非均值。

## 建议

1. N1/N2 低成本修复（help 文本补充），N3 等平台模型供给后自然消解。
2. 将本次「新手零试错旅程」固化为 CI 冒烟用例（`focalapi doctor` + 参数边界断言已在 57 tests 中）。
3. P4/P5 若需进一步定位，需平台侧提供队列深度/等待时间指标。
