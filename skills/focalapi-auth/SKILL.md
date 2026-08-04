---
name: focalapi-auth
description: focalapi CLI 的安装、登录、Key 管理与连通性验证。Use when focalapi 命令报 missing_api_key/invalid_api_key 错误、需要配置 FOCALAPI_API_KEY、或首次安装接入 focalapi。
---

# focalapi 认证与接入

## 安装

```bash
npm i -g focalapi-cli
focalapi --version
```

要求 Node.js ≥ 18。

## 登录（三选一）

```bash
# 1. 显式传 key（Agent 环境推荐）
focalapi auth login --key sk-xxxx

# 2. 环境变量（不落盘，CI/沙箱推荐）
export FOCALAPI_API_KEY=sk-xxxx

# 3. 交互粘贴（仅终端）
focalapi auth login
```

Key 在 https://focalapi.com/console/token 创建。本地保存位置：`~/.focalapi/config.json`（权限 600）。

## 验证

```bash
focalapi auth status        # Key 有效性 + 额度 + 来源
focalapi doctor             # 网络→鉴权→演练模型→额度 全链路（免费）
```

## 自定义端点

私有化部署时：`export FOCALAPI_BASE_URL=https://你的域名`（或 `--base-url` flag，或登录时写入 profile）。

## 常见错误

| 错误码 | 含义 | 处理 |
|---|---|---|
| missing_api_key | 没配 Key | 按上面任一方式登录 |
| invalid_api_key | Key 无效/过期/被删 | 控制台重建 Key 后重新 login |
| insufficient_quota | 额度不足 | 控制台充值；`focalapi usage` 查明细 |
| network_error | 连不上 | 查网络/代理/BASE_URL；跑 `focalapi doctor` |
