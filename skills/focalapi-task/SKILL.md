---
name: focalapi-task
version: 2.1.0
description: "Continue asynchronous FocalAPI image or video tasks, cancel queued tasks, and download their outputs. Use when a generation response contains task_id or next_command, or when the user asks about progress, failure reasons, cancellation, or result files. Reuse the original task_id and never generate again."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi task --help"
---

# Complete asynchronous FocalAPI tasks

After a generation command returns `task_id`, prefer the response's `next_command`:

```bash
focalapi task status <task-id> --json
focalapi task download <task-id> -o ./focalapi-out --json
focalapi task cancel <task-id> --json
```

- `pending` or `running`: this is still the same valid task. Check it later and do not resubmit generation.
- `success`: run download, verify that the file exists, and return its absolute path to the user.
- `failed`: show the upstream error summary and hint. Generate again only when an explicit parameter or content issue requires it. A raw status of `expired` means the submission state stayed unknown past the reconciliation window; the charge was refunded automatically.
- `cancelled`: the task was stopped; a cancelled queued task is refunded. Do not download or resubmit unless the user asks for a new attempt.
- `unknown`: preserve the raw response and run `focalapi doctor --json`; never fabricate a success state.

Task IDs are case-sensitive and mix `l`/`1`/`I` and `O`/`0`. Copy them exactly from the submission output — stdout JSON or the stderr `task_id=` breadcrumb — instead of retyping.

`task cancel` only works while a task is still queued (`pending`). A 409 `task_already_running` means generation already started and cannot be stopped — keep tracking with `task status`. Cancellation failures return explicit codes (`task_already_finished`, `task_cancel_failed`); follow `error.hint` instead of retrying blindly.

Polling must be bounded. When the user does not ask for blocking wait behavior, report the current status and `task_id`.
