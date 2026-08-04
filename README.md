<div align="center">

# focalapi-cli

**给你的 AI Agent 赋予 focalapi 的全部模型能力**

[![npm](https://img.shields.io/npm/v/focalapi-cli?color=brightgreen&label=npm)](https://www.npmjs.com/package/focalapi-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

focalapi 的对话、图像生成、视频生成、联网搜索、音频、向量、Rerank、用量查询能力，都可以通过 focalapi CLI + Skills 交给 Claude Code、Codex、OpenCode、Hermes 等本地 Agent 调用。

```shell
npm i -g focalapi-cli
```

</div>

---

## focalapi-cli 能做什么

让你的 AI Agent 具备这些 focalapi 能力，并能在复杂任务中组合调用：

- **模型调用**：文本对话、多模态输入（图片理解）、流式输出、管道输入
- **图片 / 视频生成**：文生图、文生视频，产物自动下载到本地；视频任务支持异步编排
- **联网搜索**：`/v1/alpha/search`，给 Agent 接上实时信息
- **音频**：语音转写（transcribe）、文字转语音（speech）
- **向量 / 重排**：embeddings 与 rerank，检索链路两件套
- **Agent 接入**：`focalapi connect` 把内置 Skills 装进本机 Agent，Agent 即刻学会调用 focalapi
- **治理闭环**：`usage` 额度用量、`doctor` 只读诊断（用免费演练模型做端到端自检，不花额度）

## 为什么需要 focalapi-cli

focalapi-cli 不是让你记住更多命令，而是把 focalapi 的模型能力变成 Agent 可以调用的工具箱。

```text
接入链路:
安装 CLI -> 登录（sk- key）-> connect 注入 Agent Skills -> Agent 自然语言调用能力

调用链路（Agent 视角）:
models list 选模型
  -> chat / gen / search / embed / rerank 调用
  -> 产物落盘（图像/视频/音频）
  -> usage 看额度，doctor 做诊断
```

## 安装与初始化

```shell
# 1. 安装 CLI（Node.js >= 18）
npm i -g focalapi-cli
focalapi --version

# 2. 登录（Key 在 https://focalapi.com/console/token 创建）
focalapi auth login --key sk-xxxx

# 3. 自检（使用免费演练模型 focal-rehearsal-chat，不消耗额度）
focalapi doctor

# 4. 把 focalapi Skills 同步到本机 Agent
focalapi connect install
```

无终端交互的环境（CI、Agent 沙箱）用环境变量即可：

```shell
export FOCALAPI_API_KEY=sk-xxxx
# 私有化部署时：export FOCALAPI_BASE_URL=https://你的域名
```

## 常用任务

### 对话与多模态

```shell
focalapi chat "用一句话总结 RAG 的核心思想" -m focal-rehearsal-chat

cat report.md | focalapi chat -m <model> --system "你是严谨的技术编辑"

focalapi chat "描述这张图片" -m <多模态模型> --input @photo.jpg
```

### 生成图片 / 视频

```shell
focalapi gen image "未来城市海报" -m <图像模型> --size 1024x1024 -o ./out

# 视频：默认等待完成并下载；异步编排用 --no-wait
focalapi gen video "海浪拍打礁石" -m <视频模型> --seconds 5
focalapi gen video "海浪拍打礁石" -m <视频模型> --no-wait --json   # 拿 task_id
focalapi task status <task_id> --json
focalapi task download <task_id> -o ./out
```

### 搜索 / 向量 / 重排 / 音频

```shell
focalapi search "过去7天 AI 行业新闻" -m <搜索模型> --json
focalapi embed "待编码文本" -m <向量模型> --json
focalapi rerank -m <rerank模型> --query "问题" --docs @docs.json
focalapi audio transcribe meeting.mp3 -m <转写模型>
focalapi audio speech "大家好" -m <TTS模型> -o hello.mp3
```

### 额度与诊断

```shell
focalapi usage          # 令牌额度 + 本周期账单用量
focalapi auth status    # Key 有效性、来源、过期时间
focalapi doctor         # 全链路只读诊断，任何调用失败先跑它
```

## Agent 接入（connect）

```shell
focalapi connect list                 # 探测本机 Agent（Claude Code / Codex / OpenCode / Hermes）
focalapi connect install              # 向全部检测到的 Agent 安装 skills
focalapi connect install claude-code  # 只装指定 Agent
focalapi connect uninstall            # 按 manifest 精确卸载，不碰其他文件
```

`connect install` 把本仓库 [`skills/`](./skills) 下的技能包复制到各 Agent 的技能目录，并打印 provider 配置指引（把 Agent 的模型后端指向 focalapi）。技能装入后重启 Agent 会话，即可用自然语言驱动，例如「用 focalapi 画一张赛博朋克海报」。

## 面向 Agent 的设计约定

- 所有命令支持 `--json`：stdout 只输出 JSON（诊断走 stderr），可直接 `| jq`
- 非 TTY 环境自动禁用交互与动画，CI / 沙箱可无人值守运行
- 错误统一为 `{error: {code, message, hint}}` + 非零退出码
- API Key 绝不完整打印（一律 `sk-***尾4位` 脱敏）

## 命令入口

| 任务 | 命令 |
|---|---|
| 登录 / 状态 / 登出 | `focalapi auth login / status / logout` |
| 对话和多模态推理 | `focalapi chat` |
| 图片 / 视频生成 | `focalapi gen image / gen video` |
| 任务查询与产物下载 | `focalapi task status / download` |
| 联网搜索 | `focalapi search` |
| 语音转写 / 合成 | `focalapi audio transcribe / speech` |
| 向量化 / 重排序 | `focalapi embed / rerank` |
| 模型查询 | `focalapi models list / get` |
| 额度用量 | `focalapi usage` |
| 诊断排障 | `focalapi doctor` |
| Agent 接入 | `focalapi connect list / install / uninstall` |
| 版本与更新检查 | `focalapi version / update` |

每个命令都自带帮助：`focalapi <command> --help`。

## 配置

- 配置文件：`~/.focalapi/config.json`（权限 600），支持多 profile（`--profile`）
- 环境变量：`FOCALAPI_API_KEY`、`FOCALAPI_BASE_URL`、`FOCALAPI_MODEL`、`FOCALAPI_CONFIG_DIR`
- 优先级：命令行 flag > 环境变量 > 配置文件

## 本地 e2e 验证清单（需要真实 Key）

```shell
focalapi auth login --key sk-xxxx
focalapi doctor                                        # 全 ✓
focalapi chat "你好" -m focal-rehearsal-chat            # 免费演练模型
focalapi gen image "测试图" -m <图像模型> -o ./out
focalapi gen video "测试视频" -m <视频模型> --no-wait --json
focalapi task download <task_id>
focalapi connect install && focalapi connect uninstall # 幂等且清理干净
```

## 链接

- focalapi：<https://focalapi.com>
- Gitee：<https://gitee.com/xnn-ai/focalapi-cli>
- npm：<https://www.npmjs.com/package/focalapi-cli>
- 内置 Skills：[`./skills`](./skills)

## License

[Apache-2.0](./LICENSE)
