# Changelog

## 0.6.2 - 2026-08-26

- Image downloads now retry across three windows (600s/600s/900s) instead of a single 300s abort. The stability probe proved the 300s window was failing deliveries over slow proxied links while the platform had already generated and billed the image (server-side completion 43-47s; the abort text was Node's own AbortSignal message, not an upstream error).
- When all download attempts fail, the error carries the artifact URL and an explicit warning that resubmission would charge again - the image is already produced.

## 0.6.1 - 2026-08-26

- Resilient task polling: `task status --wait`, `gen video` waits, and every internal poll now tolerate up to 5 consecutive network failures with backoff. A dropped status query no longer kills a running task's wait - polling again is free and can never double-charge - and a give-up error carries the exact `task status <id> --wait --download` recovery command.
- `gen image` sync waits enrich network errors with recovery guidance: a disconnected request may already be charged, so the error now points to `task list` before any resubmission instead of leaving users to guess.

## 0.6.0 - 2026-08-26

- Retired `gen omni-video` with a local redirect to `gen video -m gemini-omni-flash-preview`: the gateway rejects the Interactions endpoint for this model in every shape (video matrix evidence 2026-08-26). All four capabilities (t2v/first-frame/reference/edit) ride the video facade.
- Added task-parameter flags to `gen video`, mapped to the task DTO's top-level fields with local enum validation: `--omni-reference-task-type` (seedance 2.5 edit/extend semantics were unreachable — auto-inference conflicts with the default duration), `--voice`/`--avatar` (HeyGen, enums now published by the platform), `--operation` (Bria), `--enhance-model` (HitPaw), and `--upscaler-model` (Topaz).
- Added local constraint tables for the August video wave (wan2.7 ×4, pixverse-v5, kling-v3-omni, luma-ray-3-2, MiniMax-H3, HeyGen ×2, happyhorse ×4, topaz/hitpaw video, beeble, bria, veo 3.1 ×3): duration tiers and resolutions are validated locally, and source-length families (heygen, topaz/hitpaw video, beeble, bria, happyhorse video-edit) reject `--seconds` up front instead of round-tripping a guaranteed 400.

## 0.5.1 - 2026-08-26

- Added `@file` support to `--style-references` and `--moodboards`: the JSON array can now be read from a file instead of inline argv. Windows `cmd` mangles embedded double quotes in JSON arguments (matrix-run evidence 2026-08-25), and the file source sidesteps shell quoting entirely.

## 0.5.0 - 2026-08-25

- Fixed `krea-2-medium/-turbo/large` reference-image validation: the local table said 0 while the platform contract accepts up to 10 reference images (each maps to a Krea style reference), so every `gen image --image` edit was rejected locally without reaching the server (2026-08-25 live audit P01).
- Added local constraints for the August image wave so invalid parameters are intercepted before submission: `topaz-image-reimagine`/`-bloom-2`/`-wonder-3-5`, `wavespeed-seedvr2-upscale`/`-ultimate-upscale`, `quiver-text-to-svg`/`-image-to-svg`, `hitpaw-image-enhance`/`-portrait-enhance`, `beeble-switchx-image-720p`/`-1080p`, `recraft-v4`/`-v4-pro`.
- Enforce the exact-one-input-image requirement locally for the enhance/upscale/vectorize/switch families instead of surfacing the server 400.
- Map `--resolution` to the `target_resolution` wire field for WaveSpeed upscales (the generic `resolution` field is silently ignored by that family).
- Send Topaz `--creativity` as an integer 1-9 (the platform contract takes a number; the Krea string modes are unchanged).
- Validate Recraft sizes against the official V4 tables (non-pro caps at ~1.5K, pro at ~3K) and reject reference images locally (the channel is text-to-image only).
- Intercept `gen image` on Gemini image models with a direct pointer to `gen gemini-image` (native generateContent endpoint) instead of an opaque upstream failure (audit P07).

## 0.4.1 - 2026-08-18

- Added `@file` syntax for local reference media on all gen paths (`--image @C:/path/ref.jpg`): the file is read and inlined as a data URI with per-file 8MB and per-command 12MB guards — local files no longer require manual hosting.
- Bare local paths (e.g., `C:/...` without `@`) are intercepted locally with actionable guidance to add the `@` prefix or host the file, instead of round-tripping to the server's 400.
- Added `--content @file.json` and `--content -` (stdin) for gen video, bypassing the Windows ~32KB argv limit for multi-image content arrays; capped at 64MB.
- Added `task download --direct`: fetches the task's upstream artifact URL directly (CDN/edge typically beats the cross-border gateway hop; measured 328KB/s client-side vs 26MB/s server-local) and falls back to the gateway proxy automatically.
- Added grok video prompt budget validation: the upstream 4096-character limit applies to the composite of text plus ~500 characters per reference image — the CLI mirrors the gateway's calibrated gate and rejects locally before submission.

## 0.4.0 - 2026-08-18

- Added `task status --wait [--download]`: built-in bounded polling with elapsed-time reporting and an optional auto-download, so agents never need to write their own poller (the audited agent session's custom script crashed on the Windows `.cmd` shim and stalled blind).
- Added `task list [--status] [--action] [--limit] [--offset]` backed by `GET /v1/tasks`, so a caller that lost a submission output can reconcile recent tasks instead of resubmitting and double-charging.
- Added `--idempotency-key` to `gen video` and async `gen image`: same-key retries replay the original task server-side without a second charge. Keys are auto-generated when omitted, breadcrumbed on stderr (`idempotency_key=...`), and the server's `idempotent_replay` marker is surfaced in both JSON output and stderr.
- Aligned `task download --json` output with `gen image` by exposing `files[]` alongside the legacy `file`.
- Added a stderr warning for double-encoded reference URLs (`%25XX`) before submission — the top cause of 403 `invalid_reference_url` from presigned URLs.

## 0.3.1 - 2026-08-18

- Added `--duration` as an alias of `--seconds` on `gen video` so the API contract field name works directly; conflicting values are rejected locally.
- Emitted a stderr breadcrumb (`task_id=...`) for every `--no-wait` submission so callers that fail to parse stdout JSON can recover the task instead of resubmitting and double-charging.
- Added case-sensitive ID transcription guidance to `task status`/`task cancel` 404 errors (`l`/`1`/`I`, `O`/`0`) with an explicit warning against blind resubmission.
- Updated the bundled Agent Skills with resubmission discipline, the Windows `.cmd` shim invocation requirement, and exact task-ID copying guidance.

## 0.3.0 - 2026-08-18

- Added `task cancel` for queued tasks through `DELETE /v1/video/generations/{task_id}`, including the 409 `task_already_running` / `task_already_finished` and 502 `task_cancel_failed` contract with actionable hints.
- Added `gen video --first-frame <url>` for image-to-video and made `--image` the reference-media channel; Grok 1.5 reference-to-video is capped at 720p and 7 images locally, the legacy Grok video model rejects references outright, and the two flags are mutually exclusive.
- Accepted the new Seedance 2.5 1080p tier and wired per-model reference-image caps (Seedance, Omni, Kling, Vidu, LTX, FLUX).
- Aligned Gemini image validation: `gemini-2.5-flash-image` accepts at most 1 `inlineData` reference, `gemini-3.1-flash-image` gains the 15-value ratio surface and `thinkingLevel`/`temperature`/`topP`, and seeds are capped at `Number.MAX_SAFE_INTEGER`.
- Corrected `seedream-4-0-250828` default size to `2k`, lowered the Vidu seed ceiling to 2147483647, and capped FLUX 3 `safety_tolerance` at 2 whenever images are attached.
- Normalized task statuses `cancelled`, `expired`, and the `queued_*` family, with refund-aware messaging for expired tasks.
- Mapped the platform's 503 `capacity_exhausted` signal to a stable retryable error code with a retry hint instead of a generic server error.
- Refreshed the bundled Agent Skills and README with the cancel workflow, capacity retry guidance, and the Grok video mode contract.

## 0.2.2 - 2026-08-14

- Removed the retired Veo 3.1 preview models from automatic video selection and local validation.
- Aligned automatic selection with the current Seedance, Kling, Vidu, Grok, LTX, FLUX, MiniMax, Seedream, Gemini, Qwen, and Krea catalog.
- Added local parameter validation and CLI options for the current Krea, Kling, Qwen, Grok Image 2.0, LTX 2.5, FLUX 3, Vidu Q3, and MiniMax H3 contracts.
- Refreshed bundled Agent Skills so explicit-model workflows use the current model families and role-aware content fields.

## 0.2.1 - 2026-08-11

- Prepared the public GitHub repository metadata and refreshed the project documentation for external contributors.
- Rewrote bundled Agent Skills and source comments in English while preserving the existing CLI commands and runtime behavior.
- Clarified that audio transcription and speech synthesis require an explicit model selected from the current key's live model list.
- Added the CLI verification report and kept local benchmark artifacts out of the published repository.

## 0.2.0 - 2026-08-11

- Added `models resolve image|video`, backed by the live model list and detailed contracts, so image and video generation can omit `--model` and automatically select a currently available default.
- Reworked Agent integration across 44 Agent targets with shared Skills-directory deduplication, custom `--path` support, transactional installation, digest verification, safe uninstall, and `connect verify`.
- Added best-effort synchronization for detected Agents after npm installation while keeping `focalapi connect` as the stable entry point that does not depend on lifecycle scripts.
- Rewrote all seven bundled Skills so creative requests route automatically even when the user does not name FocalAPI, without probing generation models or changing the Agent's primary model/provider.
- Added model information and `next_command` to asynchronous image and video results so Agents can continue the original task without resubmitting it.
- Fixed CLI process exit codes so Agents and scripts can reliably detect failures from `doctor` and `connect verify`.
