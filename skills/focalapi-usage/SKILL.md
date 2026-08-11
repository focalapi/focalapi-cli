---
name: focalapi-usage
version: 2.0.0
description: "查询 focalapi 额度、用量与账单，或诊断网络、鉴权和服务错误。当用户问消费/余额，或业务命令失败且需要按错误码闭环时使用；正常生成前不强制增加诊断步骤。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi usage --help"
---

# focalapi 用量与诊断

```bash
focalapi usage --json
focalapi auth status --json
focalapi doctor --json
```

- 用户问额度、余额、用量或账单：运行 `usage`。
- `missing_api_key` / `invalid_api_key`：转 focalapi-auth。
- `insufficient_quota`：运行 `usage`，说明缺口，不自动充值。
- `network_error` / `timeout` / 5xx：运行一次 `doctor`，按 checks[].hint 处理。
- `invalid_request`：回到 `models get` 的实时参数契约；不要重复发送同一请求。
- `upstream_auth_failed`：保留 request ID 并反馈服务方，不要让用户更换本站 Key。

正常业务命令没有报错时不要先跑 doctor 或免费演练；Agent 应直接完成用户的创作
目标，减少无关调用。
