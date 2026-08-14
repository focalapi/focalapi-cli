# Changelog

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
