# Changelog

## 0.2.0 - 2026-08-11

- Added `models resolve image|video`, backed by the live model list and detailed contracts, so image and video generation can omit `--model` and automatically select a currently available default.
- Reworked Agent integration across 44 Agent targets with shared Skills-directory deduplication, custom `--path` support, transactional installation, digest verification, safe uninstall, and `connect verify`.
- Added best-effort synchronization for detected Agents after npm installation while keeping `focalapi connect` as the stable entry point that does not depend on lifecycle scripts.
- Rewrote all seven bundled Skills so creative requests route automatically even when the user does not name FocalAPI, without probing generation models or changing the Agent's primary model/provider.
- Added model information and `next_command` to asynchronous image and video results so Agents can continue the original task without resubmitting it.
- Fixed CLI process exit codes so Agents and scripts can reliably detect failures from `doctor` and `connect verify`.
