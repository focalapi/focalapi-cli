---
name: focalapi-auth
version: 2.0.0
description: "Handle focalapi-cli installation, first sign-in, key status, and 401/authentication errors. Trigger only during initial setup or when a business command explicitly returns missing_api_key or invalid_api_key. Return to the original creative task after authentication succeeds."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi auth --help"
---

# FocalAPI authentication

```bash
npm i -g focalapi-cli
focalapi auth login --key <sk-key>
focalapi auth status --json
focalapi connect
```

Create a key at `https://focalapi.com/console/token`. Never reveal the complete key in a response, log, or echoed command. Prefer `FOCALAPI_API_KEY` in CI and sandbox environments.

Do not run `auth status` before every business command. After an authentication error, follow this fixed path:

- `missing_api_key`: sign in or set `FOCALAPI_API_KEY`.
- `invalid_api_key`: ask the user to verify or create a key in the console, then sign in again.
- `upstream_auth_failed`: the FocalAPI key may be valid. Preserve the request ID and escalate to the service operator; do not repeatedly replace the user's key.

Retry the original business command immediately after authentication succeeds. Signing in is not the end of the task.
