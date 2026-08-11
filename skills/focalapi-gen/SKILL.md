---
name: focalapi-gen
version: 2.0.0
description: "用 focalapi 完成图片/视频生成、图片编辑、图生视频和参考素材创作。当用户表达画图、生图、改图、生成视频或让素材动起来时直接触发，即使未提 focalapi；默认自动选模，不先试模型。"
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi gen --help"
---

# focalapi 图片与视频生成

## 默认：自动选模，一次执行

用户没有指定模型时，直接运行：

```bash
focalapi gen image "<完整提示词>" -o ./focalapi-out --json
focalapi gen video "<完整提示词>" --no-wait -o ./focalapi-out --json
```

CLI 会用当前 Key 的实时模型池与详情契约选择默认模型。不要先用低成本模型、
测试提示词或多个模型各生成一次；这会产生不必要的费用和歧义。

## 指定模型或高级参数

用户点名模型时，先读一次实时契约：

```bash
focalapi models get <model-id> --json
focalapi gen image "<prompt>" -m <model-id> [契约允许的参数] -o ./focalapi-out --json
focalapi gen video "<prompt>" -m <model-id> [契约允许的参数] --no-wait -o ./focalapi-out --json
```

- 图片编辑/参考图使用 `--image <url...>`；mask 仅在契约列出时传 `--mask`。
- 视频参考图使用 `--image <url...>`；时长、清晰度、画面比例和音频开关只按
  `supported_params` 传递。
- 不把一个模型的 `ratio`、`aspect_ratio`、`size` 或 `resolution` 复制给另一模型。
- Gemini 原生图片仅在用户明确选中对应模型时使用 `gen gemini-image`；普通任务
  继续使用自动入口 `gen image`。

## 结果闭环

图片同步结果的 `files` 是本地绝对路径，直接交付用户。异步结果按返回的
`next_command` 执行：

```bash
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./focalapi-out --json
```

`pending` / `running` 不是失败；继续查询同一个 `task_id`，不得重新提交生成。
失败时读取结构化 `error.code` 和 `hint`，只修复明确问题，不盲目换模型。
