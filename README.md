<div align="center">

# focalapi-cli

**Give any AI Agent direct access to FocalAPI creative models**

[![npm](https://img.shields.io/npm/v/focalapi-cli?color=brightgreen&label=npm)](https://www.npmjs.com/package/focalapi-cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

```shell
npm i -g focalapi-cli
```

</div>

focalapi-cli turns FocalAPI's creative-model gateway into commands and Skills that an Agent can run directly. Users describe the outcome they want; the Agent does not need to probe models, guess parameters, handcraft requests, or switch platforms first.

It does not configure FocalAPI as the Agent's primary model or provider. Agents such as Codex, Claude Code, and Cursor keep their existing reasoning models and call FocalAPI only for creative tasks such as image and video generation.

## Connect in three steps

```shell
# 1. Install. Skills are synchronized automatically when lifecycle scripts are allowed.
npm i -g focalapi-cli

# 2. Configure a FocalAPI key.
focalapi auth login --key sk-xxxx

# 3. Connect every detected Agent, then verify the installation. The operation is idempotent.
focalapi connect
focalapi connect verify --json
```

Create a key at <https://focalapi.com/console/token>. CI and sandbox environments can use `FOCALAPI_API_KEY`; self-hosted deployments can set `FOCALAPI_BASE_URL`.

If an npm security policy blocks lifecycle scripts, run `focalapi connect` explicitly. This is also the stable manual integration entry point. Set `FOCALAPI_SKIP_POSTINSTALL=1` to intentionally skip automatic post-install integration.

## Zero-guesswork Agent workflows

When no model is specified, the CLI reads the live model pool and detailed model contract available to the current key, selects the maintained FocalAPI default, and sends only one real generation request.

```shell
# Automatically select the current default image model.
focalapi gen image "Product hero image, soft studio lighting" -o ./out --json

# Automatically select the current default video model and return a task ID immediately.
focalapi gen video "Ocean waves hitting rocks, cinematic" --no-wait -o ./out --json

# Continue from next_command in the generation response without resubmitting the task.
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./out --json

# Stop a task that is still queued; cancelled tasks are refunded automatically.
focalapi task cancel <task-id> --json
```

When the user specifies a model, read its authoritative contract first:

```shell
focalapi models get <model-id> --json
focalapi gen image "<prompt>" -m <model-id> [contract-supported options] -o ./out --json
```

The CLI can also resolve a model without generating anything:

```shell
focalapi models resolve image --json
focalapi models resolve video --json
```

`resolve` returns the exact `model.id`, verified `endpoint_type`, complete `supported_params`, candidate models, and a `next_command`. When a list summary and detailed contract disagree, the detailed contract is authoritative.

The maintained creative defaults are aligned with the current catalog: Seedream 5.0, GPT Image 2, Gemini 3.1 Image, Grok Imagine Image 2.0, Kling Image 3.0, Qwen Image 3.0, and Krea 2 for images; Seedance 2.5 (480p/720p/1080p), Kling 3.0, Vidu Q3, Gemini Omni Flash, Grok Imagine Video 1.5, LTX 2.5, and FLUX 3 for video. Availability still depends on the current key, so runtime model details always take precedence over this overview.

## Agent integration

```shell
focalapi connect                         # Install or repair every detected Agent.
focalapi connect list                    # Inspect supported, detected, and installed targets.
focalapi connect install codex cursor    # Install for selected Agents.
focalapi connect install --path <dir>    # Install to an unlisted or project-level Skills directory.
focalapi connect verify --json           # Verify Skill integrity and authentication readiness.
focalapi connect uninstall               # Remove only managed Skills that the user has not modified.
```

The built-in catalog currently covers 44 Agent targets, including Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, OpenClaw, Cline, Windsurf, Warp, Trae, Qwen Code, Kimi CLI, and Hermes. Targets such as Codex, Cline, Pi, and Warp that share `~/.agents/skills` are deduplicated by path, so the Skills are installed only once.

Installation is transactional: the current `focalapi-*` catalog is written as one unit, and any failed step rolls back the operation. The manifest records a SHA-256 directory digest for each Skill. By default, uninstall removes only managed Skills whose digest has not changed and preserves user-modified content.

The Skill routing contract requires Agents to:

- trigger FocalAPI for creative tasks even when the user does not name it;
- omit `--model` when no model is specified, letting the CLI select one without generating test samples;
- use only the live parameter contract returned by `models get` for an explicitly selected model;
- reuse the original `task_id` for asynchronous work instead of charging for duplicate submissions while a task is `pending`;
- return to the original task after resolving an authentication error rather than stopping at diagnostics.

## Current capability boundary

The fully validated automatic generation paths currently cover images and video, including image editing, reference-image creation, text-to-video, and image-to-video. The CLI retains text and audio commands, but an Agent may use them only when both the live model details and CLI help expose an executable contract. It never infers future audio, 3D, or other modality support from model names alone.

## Stable output for Agents

- All automation commands support `--json`; stdout contains JSON only, while progress and diagnostics go to stderr.
- Errors use `{ error: { code, message, hint, request_id? } }`.
- API keys are always redacted.
- Image results return local `files`; asynchronous video results return `task_id` and `next_command`.
- Local validation rejects known invalid billing multipliers and model parameters before sending a request.

## Command map

| Task | Command |
| --- | --- |
| Generate images with automatic or explicit model selection | `focalapi gen image` |
| Generate video with automatic or explicit model selection | `focalapi gen video` |
| Resolve models and inspect live contracts | `focalapi models resolve/get/search/list` |
| Check, cancel (queued), and download asynchronous tasks | `focalapi task status/cancel/download` |
| Sign in and inspect key status | `focalapi auth login/status/logout` |
| Inspect quota, usage, and diagnostics | `focalapi usage`, `focalapi doctor` |
| Connect Agent Skills | `focalapi connect` |
| Make read-only raw API requests | `focalapi request get/head` |

Every command includes built-in help: `focalapi <command> --help`.

## Development validation

```shell
npm install
npx tsc --noEmit
npm run build
npm test
```

## Links

- FocalAPI: <https://focalapi.com>
- GitHub: <https://github.com/focalapi/focalapi-cli>
- npm: <https://www.npmjs.com/package/focalapi-cli>
- Bundled Skills: [`./skills`](./skills)

## License

[Apache-2.0](./LICENSE)
