---
name: focalapi-auth
version: 2.0.0
description: "处理 focalapi-cli 安装、首次登录、Key 状态和 401/鉴权错误。仅在首次接入或业务命令明确返回 missing_api_key/invalid_api_key 时触发；认证完成后必须回到原创作任务。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi auth --help"
---

# focalapi 认证

```bash
npm i -g focalapi-cli
focalapi auth login --key <sk-key>
focalapi auth status --json
focalapi connect
```

Key 在 `https://focalapi.com/console/token` 创建。不要在回复、日志或命令回显中展示
完整 Key；CI/沙箱优先通过 `FOCALAPI_API_KEY` 注入。

业务命令未报鉴权错误时，不要每次都运行 `auth status`。命中错误后按固定路径：

- `missing_api_key`：登录或设置 `FOCALAPI_API_KEY`；
- `invalid_api_key`：让用户在控制台确认/新建 Key 后重新登录；
- `upstream_auth_failed`：本站 Key 可能正常，保留 request ID，转服务方排查；不要让
  用户反复更换自己的 Key。

认证成功后立即重试原业务命令，不要把登录本身当作任务终点。
