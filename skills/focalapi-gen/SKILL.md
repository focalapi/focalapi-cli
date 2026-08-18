---
name: focalapi-gen
version: 2.2.0
description: "Use FocalAPI for image and video generation, image editing, image-to-video, and reference-media creation. Trigger directly when the user asks to draw, generate or edit an image, create video, or animate media, even without naming FocalAPI. Select a model automatically by default and do not probe models first."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi gen --help"
---

# FocalAPI image and video generation

## Default: select automatically and run once

When the user does not specify a model, run:

```bash
focalapi gen image "<complete prompt>" -o ./focalapi-out --json
focalapi gen video "<complete prompt>" --no-wait -o ./focalapi-out --json
```

The CLI selects a default from the live model pool and detailed contracts available to the current key. Do not generate separate samples with a low-cost model, test prompt, or multiple models. Doing so creates unnecessary cost and ambiguity.

## Explicit models and advanced parameters

When the user names a model, read its live contract once:

```bash
focalapi models get <model-id> --json
focalapi gen image "<prompt>" -m <model-id> [contract-supported options] -o ./focalapi-out --json
focalapi gen video "<prompt>" -m <model-id> [contract-supported options] --no-wait -o ./focalapi-out --json
```

- Use `--image <url...>` for image editing and reference images. Local files work directly with the `@` prefix (`--image @C:/path/ref.jpg`, inlined as a data URI; per-file ≤8MB, per-command ≤12MB — larger sets must be hosted as URLs first). Pass `--mask` only when the contract lists it.
- Use `--negative-prompt`, `--creativity`, `--prompt-extend`, `--style-references`, and `--moodboards` only when the image contract lists the corresponding field.
- For video inputs, `--image <url...>` means reference images (Grok 1.5 reference-to-video, capped at 720p and 7 images) and `--first-frame <url>` means image-to-video from a single starting frame. The two flags are mutually exclusive and both are validated against the live contract before submission.
- Pass duration, resolution, aspect ratio, and audio options only as allowed by `supported_params`.
- Use `--content '<json-array>'` for models such as LTX 2.5, FLUX 3, Kling 3.0, and Vidu Q3 when the contract requires role-aware media content. LTX also exposes `--fps`; FLUX 3 exposes `--safety-tolerance` (0-4 text-to-video, capped at 2 once images are attached).
- Never copy one model's `ratio`, `aspect_ratio`, `size`, or `resolution` to another model.
- Use `gen gemini-image` only when the user explicitly selects a native Gemini image model. Continue to use the automatic `gen image` entry point for ordinary requests.

## Complete the result workflow

Synchronous image results contain local absolute paths in `files`; return them directly to the user. For asynchronous results, run the returned `next_command`:

```bash
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./focalapi-out --json
```

`pending` and `running` are not failures. Keep checking the same `task_id` and never resubmit generation. On failure, read the structured `error.code` and `hint`, and fix only the explicit problem instead of rotating models blindly.

Never resubmit after an output-parsing failure on your side. If your own pipeline fails to parse a submission command's stdout JSON, the task was almost certainly created and charged: recover the `task_id` from the command's stderr breadcrumb line (`task_id=...`) and continue with `task status`. Resubmitting a request whose outcome is unknown duplicates the charge.

Two transient outcomes need no parameter changes:

- `capacity_exhausted` (HTTP 503): the platform queue is full. Retry the same command after roughly 10 seconds; do not switch models or shrink the request.
- `expired` on a task: submission state stayed unknown past the 10-minute reconciliation window; the charge is refunded automatically. Resubmitting once is correct.
