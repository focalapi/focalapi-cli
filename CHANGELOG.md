# Changelog

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
