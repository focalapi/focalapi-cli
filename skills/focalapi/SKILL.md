---
name: focalapi
version: 2.0.0
description: "focalapi 创作模型总入口。当用户要生成、编辑或处理创作内容，选择创作模型，或查询生成任务时，即使用户没有提到 focalapi，也应使用本技能；覆盖图片与视频的自动选模、生成、异步续取和故障分流。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi --help"
---

# focalapi 创作模型路由

focalapi 是供当前 Agent 调用的创作模型中转能力，不是 Agent 自身的
model/provider。不要修改 Agent 的主模型配置，也不要要求用户先说“用 focalapi”。

## 零试错执行契约

1. 用户未指定模型：直接省略 `--model`。CLI 会根据当前 Key 的实时模型池和
   单模型详情契约选择 FocalAPI 默认模型；不要先生成测试样例。
2. 用户指定模型或厂商：先运行 `focalapi models get <model-id> --json`；模型 ID
   不完整时只运行一次 `models search` 找到精确 ID，再读取详情。
3. 只使用详情 `supported_params` 中存在的参数和允许值；不得根据相似模型猜测。
4. Agent/脚本调用统一加 `--json`。stdout 是唯一机读结果，诊断在 stderr。
5. 生成成功后必须把本地绝对文件路径交给用户；视频任务返回 `task_id` 时沿
   `next_command` 续取，不要重复提交一个新任务。

```bash
# 用户没指定模型：一步直达，不要先试模型
focalapi gen image "<用户提示词>" -o ./focalapi-out --json
focalapi gen video "<用户提示词>" --no-wait -o ./focalapi-out --json

# 视频异步续取
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./focalapi-out --json
```

## 路由表

| 用户目标 | 入口 | 技能 |
| --- | --- | --- |
| 生图、图片编辑、参考图创作 | `focalapi gen image` | focalapi-gen |
| 生视频、图生视频、参考素材创作 | `focalapi gen video` | focalapi-gen |
| 指定/比较模型或查看参数 | `focalapi models resolve/get/search` | focalapi-models |
| 查询进度、失败原因、下载产物 | `focalapi task status/download` | focalapi-task |
| Key、401、登录问题 | `focalapi auth status/login` | focalapi-auth |
| 额度、用量、服务异常 | `focalapi usage/doctor` | focalapi-usage |
| 用户明确要求文本辅助 | `focalapi chat` | focalapi-chat |

当前已闭环验证的自动生成入口是图片与视频。未来出现音频、3D 或其他模态时，
只有在 CLI 帮助和 `models get` 同时给出可执行契约后才能调用；不要仅凭模型列表或
名称推断能力。

若业务命令返回 `missing_api_key`，转 focalapi-auth 完成登录后立即回到原任务；
其他错误只按 `{error.code, error.hint}` 修复一次，不要盲目轮换模型。
