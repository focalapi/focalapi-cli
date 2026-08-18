---
name: focalapi-usage
version: 2.0.0
description: "Inspect FocalAPI quota, usage, and billing, or diagnose network, authentication, and service errors. Use when the user asks about spend or balance, or when a failed business command needs an error-code-driven resolution. Do not add mandatory diagnostics before normal generation."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi usage --help"
---

# FocalAPI usage and diagnostics

```bash
focalapi usage --json
focalapi auth status --json
focalapi doctor --json
```

- For quota, balance, usage, or billing questions, run `usage`.
- For `missing_api_key` or `invalid_api_key`, route to focalapi-auth.
- For `insufficient_quota`, run `usage`, explain the shortfall, and do not add funds automatically.
- For `capacity_exhausted` (HTTP 503), wait about 10 seconds and retry the exact same command; the queue admission gate is full and parameters are not the problem.
- For `network_error`, `timeout`, or 5xx errors, run `doctor` once and follow `checks[].hint`.
- For `invalid_request`, return to the live `models get` parameter contract and do not resend the same request.
- For `upstream_auth_failed`, preserve the request ID and escalate to the service operator; do not ask the user to replace the FocalAPI key.

Do not run `doctor` or a free rehearsal before a normal business command that has not failed. The Agent should complete the user's creative goal directly and avoid unrelated calls.
