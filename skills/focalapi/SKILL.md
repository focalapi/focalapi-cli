---
name: focalapi
version: 2.0.0
description: "Primary router for FocalAPI creative models. Use when the user wants to generate, edit, or process creative media, choose a creative model, or inspect a generation task, even when the user does not mention FocalAPI. Covers automatic image and video model selection, generation, asynchronous continuation, and error routing."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi --help"
---

# FocalAPI creative-model routing

FocalAPI is a creative-model gateway for the current Agent to call. It is not the Agent's own model or provider. Do not change the Agent's primary model configuration or require the user to say “use FocalAPI” first.

## Zero-guesswork execution contract

1. If the user does not specify a model, omit `--model`. The CLI selects a FocalAPI default from the live model pool and detailed contracts available to the current key. Do not generate a test sample first.
2. If the user specifies a model or provider, run `focalapi models get <model-id> --json` first. If the model ID is incomplete, run `models search` once to find the exact ID, then read its details.
3. Use only parameters and values listed in the detailed `supported_params`. Never infer support from a similar model.
4. Add `--json` for Agent and script calls. stdout is the only machine-readable result; diagnostics go to stderr. Do not merge the two streams (`2>&1`) before parsing. Programmatic callers on Windows must invoke the CLI through a shell (`cmd /c focalapi ...` or `shell=True`) because npm installs a `.cmd` shim.
5. After successful generation, return local absolute file paths to the user. If a video response contains `task_id`, follow `next_command`; never submit the same task again.

```bash
# No model specified: run once without probing models first.
focalapi gen image "<user prompt>" -o ./focalapi-out --json
focalapi gen video "<user prompt>" --no-wait -o ./focalapi-out --json

# Continue an asynchronous video task.
focalapi task status <task-id> --wait --json    # built-in polling; never write your own poll script
focalapi task list --json                       # recover recent task IDs after a lost output
focalapi task cancel <task-id> --json   # queued tasks only; cancelled tasks are refunded
```

## Routing table

| User goal | Entry point | Skill |
| --- | --- | --- |
| Generate or edit images; create from reference images | `focalapi gen image` | focalapi-gen |
| Generate video; animate images or reference media | `focalapi gen video` | focalapi-gen |
| Select, compare, or inspect model parameters | `focalapi models resolve/get/search` | focalapi-models |
| Inspect progress or failures; wait, list, cancel queued tasks; download results | `focalapi task status/wait/list/cancel/download` | focalapi-task |
| Resolve key, sign-in, or 401 issues | `focalapi auth status/login` | focalapi-auth |
| Inspect quota, usage, or service failures | `focalapi usage/doctor` | focalapi-usage |
| Provide text assistance explicitly requested by the user | `focalapi chat` | focalapi-chat |

The fully validated automatic generation paths currently cover images and video. Audio, 3D, or another modality may be used only after both CLI help and `models get` expose an executable contract. Never infer a capability from a model list or name alone.

If a business command returns `missing_api_key`, route to focalapi-auth and return to the original task immediately after sign-in. For other errors, follow `{error.code, error.hint}` once; do not rotate models blindly.
