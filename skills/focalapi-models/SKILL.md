---
name: focalapi-models
description: 发现 focalapi 当前 Key 可用的模型、端点与参数契约。Use when 用户要找模型、确认模型参数、比较模型可用性，或模型调用报错。
---

# focalapi 模型发现与契约

模型供给会变化；禁止根据记忆、旧文档或相似模型推断 ID、端点和参数。

```bash
focalapi models list --json
focalapi models search <keyword> --endpoint <endpoint-type> --json
focalapi models get <model-id> --json
```

端点类型常用值：`image-generation`、`video-generation`、`chat-completion`。选择模型前确认：

1. 目标端点出现在 `supported_endpoint_types`。
2. `supported_params` 覆盖所需的尺寸、时长、比例、参考图和异步能力。
3. 默认值、枚举与范围适合本次任务和额度。

命令失败时：

- `models get` 返回模型不可用：重新运行 `models list --json`，不要重试同一个 ID。
- 认证、网络或额度不明：运行 `focalapi doctor --json`，再运行 `focalapi usage --json`。
- 仅需检查尚未封装的只读端点：`focalapi request get <path> --json`；不得调用写方法。
