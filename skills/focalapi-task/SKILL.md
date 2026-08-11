---
name: focalapi-task
version: 2.0.0
description: "Continue asynchronous FocalAPI image or video tasks and download their outputs. Use when a generation response contains task_id or next_command, or when the user asks about progress, failure reasons, or result files. Reuse the original task_id and never generate again."
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
```

- `pending` or `running`: this is still the same valid task. Check it later and do not resubmit generation.
- `success`: run download, verify that the file exists, and return its absolute path to the user.
- `failed`: show the upstream error summary and hint. Generate again only when an explicit parameter or content issue requires it.
- `unknown`: preserve the raw response and run `focalapi doctor --json`; never fabricate a success state.

Polling must be bounded. When the user does not ask for blocking wait behavior, report the current status and `task_id`.
