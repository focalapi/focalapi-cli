<div align="center">

# focalapi-cli

**给你的 AI Agent 赋予 focalapi 的创作模型能力**

[![npm](https://img.shields.io/npm/v/focalapi-cli?color=brightgreen&label=npm)](https://www.npmjs.com/package/focalapi-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

focalapi 的图像、视频、音频与视觉创作能力，可以通过 focalapi CLI + Skills 交给本地 Agent 调用；DeepSeek 仅作为提示词、分镜和轻量文本的备用能力。

```shell
npm i -g focalapi-cli
```

</div>

---

## focalapi-cli 能做什么

让你的 AI Agent 具备这些 focalapi 能力，并能在复杂任务中组合调用：

- **图片 / 视频生成**：文生图、图生图、文生视频，产物自动下载到本地；视频任务支持异步编排
- **音频**：语音转写（transcribe）、文字转语音（speech）
- **DeepSeek 文本辅助**：提示词、分镜、旁白和轻量脚本草稿
- **Agent 接入**：`focalapi connect` 把内置 Skills 装进本机 Agent，Agent 即刻学会调用 focalapi
- **治理闭环**：`usage` 额度用量、`doctor` 只读诊断（用免费演练模型做端到端自检，不花额度）

## 为什么需要 focalapi-cli

focalapi-cli 不是让你记住更多命令，而是把 focalapi 的模型能力变成 Agent 可以调用的工具箱。

```text
接入链路:
安装 CLI -> 登录（sk- key）-> connect 注入 Agent Skills -> Agent 自然语言调用能力

调用链路（Agent 视角）:
models list 选模型
  -> gen / audio / chat（DeepSeek 备用）调用
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

### DeepSeek 文本辅助

```shell
focalapi chat "把这个产品简介写成 6 镜头分镜" -m <DeepSeek模型>

cat brief.md | focalapi chat -m <DeepSeek模型> --system "你是专业的广告分镜师"

focalapi chat "提炼这张参考图的构图和色彩" -m <DeepSeek模型> --input @photo.jpg
```

### 生成图片 / 视频

```shell
# 先读取模型的端点、支持参数、默认值与范围；适合 Agent 在生成前自检
focalapi models search image --endpoint image-generation --json
focalapi models get seedream-4-5-251128
focalapi models get dreamina-seedance-2-0-260128 --json

focalapi gen image "未来城市海报" -m <图像模型> --size 1024x1024 -o ./out
focalapi gen image "产品主视觉" -m gpt-image-2 --size 1536x1024 --quality high --background opaque -o ./out
focalapi gen image "将背景改为雨夜" -m gpt-image-2 --image https://example.com/source.png \
  --mask https://example.com/mask.png --response-format b64_json -o ./out
# OpenAI 图像模型可选持久任务：立即获得 task_id，稍后查询 data[].url
focalapi gen image "产品主视觉" -m gpt-image-2 --size 1024x1024 --no-wait --json
focalapi task status <task_id> --json

# Gemini 图像模型是原生 Gemini 端点，不走 OpenAI 图像端点
focalapi gen gemini-image "一只水彩风格的橘猫" -m gemini-3.1-flash-image \
  --aspect-ratio 16:9 --image-size 2K -o ./out
# Gemini native generationConfig fields can be passed through --config; named flags cover --image, --system, --seed, --thinking-level, --temperature, and --top-p. responseFormat.image and a single candidate are fixed.

# 视频：默认等待完成并下载；异步编排用 --no-wait
focalapi gen video "海浪拍打礁石" -m <视频模型> --seconds 5
focalapi gen video "海浪拍打礁石" -m dreamina-seedance-2-0-260128 \
  --seconds 5 --resolution 720p --ratio 16:9 --generate-audio true --no-wait --json
focalapi gen video "让海浪缓慢推进" -m dreamina-seedance-2-0-260128 \
  --image https://example.com/frame.png --generate-audio false --watermark true \
  --return-last-frame true --callback-url https://example.com/callback \
  --execution-expires-after 7200 --safety-identifier customer-42 --priority 4 --no-wait --json
# Ark-compatible content (text, image_url, video_url, audio_url with roles) is available unchanged through metadata.content:
focalapi gen video "ignored when content is supplied" -m dreamina-seedance-2-0-260128 \
  --content '[{"type":"text","text":"A cinematic ocean wave."}]' --no-wait --json
focalapi gen video "海浪拍打礁石" -m <视频模型> --no-wait --json   # 拿 task_id
focalapi task status <task_id> --json
focalapi task download <task_id> -o ./out
```

`models get` 是生成前的权威检查入口：返回 `supported_endpoint_types`、`supported_params`，并在可用时提供官方文档链接。CLI 会在本地拒绝已知的不支持参数，例如 Seedream 4.5 的低于 3.69 MP 的尺寸、Seedance Fast/Mini 的 1080p、Seedance 2.5 超过 30 秒或将 `--ratio` 误传给 Grok 视频；不会把这些确定会失败的请求交给上游。同步图像生成时，等待进度输出到 stderr，因此 `--json` 的 stdout 始终保持为可解析 JSON。

### 当前模型的原生参数

模型 ID 与能力由 `models get` 实时决定；以下是当前 CLI 已封装的常用组合：

```shell
# Seedream：档位、水印、输出格式和提示词优化
focalapi gen image "未来城市夜景海报" -m seedream-5-0-260128 \
  --size 3k --watermark false --output-format jpeg --optimize-prompt disabled -o ./out

# Grok 图像：画面比例、档位与可复现种子
focalapi gen image "电影感海岸线" -m grok-imagine-image-quality \
  --aspect-ratio 16:9 --resolution 2k --seed 7 -o ./out

# Seedance 2.5：最长 30 秒，不支持 priority
focalapi gen video "产品旋转展示" -m dreamina-seedance-2-5-260628 \
  --seconds 12 --resolution 720p --ratio 16:9 --no-wait --json

# Grok 视频：使用 --aspect-ratio 和 --seed，不要使用 Seedance 的 --ratio
focalapi gen video "航拍海岸线" -m grok-imagine-video-1.5 \
  --seconds 6 --resolution 1080p --aspect-ratio 16:9 --seed 7 --no-wait --json
```

### 音频创作

```shell
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
focalapi connect list                 # 探测本机已支持的 Agent
focalapi connect install              # 向全部检测到的 Agent 安装 skills
focalapi connect install <agent-id>   # 只装指定 Agent
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
| DeepSeek 文本辅助 | `focalapi chat` |
| 图片 / 视频生成 | `focalapi gen image / gen video` |
| 任务查询与产物下载 | `focalapi task status / download`（图像任务使用 status 读取 `data[].url`） |
| 语音转写 / 合成 | `focalapi audio transcribe / speech` |
| 模型查询 | `focalapi models list / search / get` |
| 额度用量 | `focalapi usage` |
| 诊断排障 | `focalapi doctor` |
| Agent 接入 | `focalapi connect list / install / uninstall` |
| 版本与更新检查 | `focalapi version / update` |
| 原始只读 API 请求 | `focalapi request get /v1/models` |

每个命令都自带帮助：`focalapi <command> --help`。

### 原始只读请求

优先使用语义化命令（如 `models`、`chat`、`gen`）。当服务新增尚未封装的读取端点时，可使用：

```shell
focalapi request get /v1/models --json
focalapi request head /v1/models --json
```

该入口只接受站内路径与 `GET` / `HEAD`，不会隐藏任何写入操作。`--json` 时高阶命令通常直通上游响应；`request` 固定返回 `{ method, path, status, content_type, data }` 信封，错误仍为 `{ error: { code, message, hint? } }`，且不会输出完整 API Key。

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
