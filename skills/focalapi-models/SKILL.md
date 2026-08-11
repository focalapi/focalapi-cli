---
name: focalapi-models
version: 2.0.0
description: "focalapi 创作模型选择与实时参数契约。当用户未指定模型、点名厂商/模型、比较模型，或生成参数报错时使用；默认用 resolve 直接得到可调用模型，禁止靠模型名猜能力或逐个试。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi models --help"
---

# focalapi 模型选择

## 最短路径

用户未指定模型时，不需要先列全量模型，也不需要 Agent 自己排序：

```bash
focalapi models resolve image --json
focalapi models resolve video --json
```

`resolve` 会读取当前 Key 的实时列表，再读取候选模型的详情契约，返回：

- `model.id`：可直接传给生成命令的精确 ID；
- `endpoint_type`：已由详情确认的生成端点；
- `model.supported_params`：本次可用参数、默认值、枚举和范围；
- `next_command`：无需猜测的下一条命令。

如果调用 `focalapi gen image/video` 时省略 `--model`，CLI 内部执行同一选择逻辑。

## 用户指定模型

```bash
focalapi models get <完整模型-id> --json
```

只有用户给的是不完整厂商/系列名时，才先做一次搜索：

```bash
focalapi models search <keyword> --json
focalapi models get <选中的完整-id> --json
```

规则：

1. `models get` 是端点和参数的最终权威；列表摘要可能只展示协议族，不能据此猜模态。
2. 不逐个模型发生成请求做可用性测试；模型发现与详情查询是只读预检。
3. 指定模型不可用时，把可用候选交给用户或回到 `models resolve`，不要偷偷换模型。
4. 查询完成后回到用户原始生成任务，不要停在模型清单。
