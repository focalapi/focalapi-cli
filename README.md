<div align="center">

# focalapi-cli

**让任意 AI Agent 直接调用 focalapi 创作模型**

[![npm](https://img.shields.io/npm/v/focalapi-cli?color=brightgreen&label=npm)](https://www.npmjs.com/package/focalapi-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

```shell
npm i -g focalapi-cli
```

</div>

focalapi-cli 把 focalapi 的创作模型中转能力变成 Agent 可直接执行的命令和
Skills。用户只需描述目标；Agent 不需要先试模型、猜参数、手写请求或切换平台。

它不会把 focalapi 配成 Agent 自身的主模型/provider。Codex、Claude Code、
Cursor 等 Agent 保持原来的推理模型，只在图片、视频等创作任务中调用 focalapi。

## 三步接入

```shell
# 1. 安装；安装器允许 lifecycle script 时会自动同步 Skills
npm i -g focalapi-cli

# 2. 配置 focalapi Key
focalapi auth login --key sk-xxxx

# 3. 接入全部已检测 Agent（幂等，自动安装过也可重复执行）并验证
focalapi connect
focalapi connect verify --json
```

Key 在 <https://focalapi.com/console/token> 创建。CI/沙箱可使用
`FOCALAPI_API_KEY`，私有化部署可设置 `FOCALAPI_BASE_URL`。

如 npm 的安全策略阻止 lifecycle script，显式执行上面的 `focalapi connect` 即可；
这也是稳定的接入入口。如需主动跳过安装后的自动接入，设置
`FOCALAPI_SKIP_POSTINSTALL=1`。

## Agent 零试错调用

不指定模型时，CLI 会读取当前 Key 的实时模型池与单模型详情契约，选择
focalapi 维护的默认模型；只产生一次真实生成请求。

```shell
# 自动选择当前可用的默认图像模型
focalapi gen image "产品主视觉，工作室柔光" -o ./out --json

# 自动选择当前可用的默认视频模型，立即返回任务 ID
focalapi gen video "海浪拍打礁石，电影感" --no-wait -o ./out --json

# 沿生成结果里的 next_command 续取，不重复提交
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./out --json
```

用户明确指定模型时，先读取权威契约：

```shell
focalapi models get <model-id> --json
focalapi gen image "<prompt>" -m <model-id> [契约允许的参数] -o ./out --json
```

也可以只让 CLI 选模、暂不生成：

```shell
focalapi models resolve image --json
focalapi models resolve video --json
```

`resolve` 返回精确 `model.id`、已确认的 `endpoint_type`、完整
`supported_params`、候选模型与 `next_command`。模型列表摘要和详情不一致时，
详情契约始终是权威。

## Agent 接入

```shell
focalapi connect                         # 安装/修复全部已检测 Agent
focalapi connect list                    # 只读查看支持、检测与安装状态
focalapi connect install codex cursor    # 指定 Agent
focalapi connect install --path <dir>    # 未收录 Agent / 项目级 Skills 目录
focalapi connect verify --json           # Skills 完整性 + 认证就绪状态
focalapi connect uninstall               # 只移除未被用户修改的托管 Skills
```

当前内置 44 个 Agent 目标，覆盖 Claude Code、Codex、Cursor、Gemini CLI、
GitHub Copilot、OpenCode、OpenClaw、Cline、Windsurf、Warp、Trae、Qwen Code、
Kimi CLI、Hermes 等。Codex、Cline、Pi、Warp 等共享 `~/.agents/skills` 的目标
会按路径自动去重，只安装一份。

安装采用事务式更新：当前 `focalapi-*` catalog 整体写入，任一步失败会回滚；
manifest 记录每个 Skill 的 SHA-256 目录摘要。默认卸载仅删除摘要未变化的托管
Skills，用户修改过的内容保留。

Skills 的路由契约明确要求：

- 用户没点名 focalapi 也会在创作任务中自动触发；
- 未指定模型时省略 `--model`，由 CLI 自动选择，不先生成测试样例；
- 指定模型时只按 `models get` 的实时参数契约调用；
- 异步任务复用原 `task_id`，不因 `pending` 重复扣费；
- 业务命令报鉴权错误时完成登录后回到原任务，不停在排障步骤。

## 当前能力边界

当前已闭环验证的自动生成入口是图片和视频，包括图片编辑、参考图创作、文生
视频和图生视频。CLI 仍保留文本、音频等命令，但只有实时模型详情与 CLI 帮助
共同给出可执行契约时 Agent 才会调用；不会根据模型名字猜测未来的音频、3D 或
其他模态能力。

## 面向 Agent 的稳定输出

- 所有自动化命令支持 `--json`，stdout 只输出 JSON，进度与诊断走 stderr；
- 错误统一为 `{ error: { code, message, hint, request_id? } }`；
- API Key 始终脱敏；
- 图片结果返回本地 `files`，视频异步结果返回 `task_id` 与 `next_command`；
- 本地校验会在发请求前拒绝已知的非法计费乘数和模型参数。

## 命令入口

| 任务 | 命令 |
| --- | --- |
| 自动/指定模型生成图片 | `focalapi gen image` |
| 自动/指定模型生成视频 | `focalapi gen video` |
| 自动选模与实时契约 | `focalapi models resolve/get/search/list` |
| 异步任务查询与下载 | `focalapi task status/download` |
| 登录与 Key 状态 | `focalapi auth login/status/logout` |
| 额度、用量与诊断 | `focalapi usage`, `focalapi doctor` |
| Agent Skills 接入 | `focalapi connect` |
| 只读原始 API | `focalapi request get/head` |

每个命令都有内置帮助：`focalapi <command> --help`。

## 开发验证

```shell
npm install
npx tsc --noEmit
npm run build
npm test
```

## 链接

- focalapi：<https://focalapi.com>
- Gitee：<https://gitee.com/xnn-ai/focalapi-cli>
- npm：<https://www.npmjs.com/package/focalapi-cli>
- 内置 Skills：[`./skills`](./skills)

## License

[Apache-2.0](./LICENSE)
