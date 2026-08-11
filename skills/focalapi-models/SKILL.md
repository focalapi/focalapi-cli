---
name: focalapi-models
version: 2.0.0
description: "Select FocalAPI creative models and inspect live parameter contracts. Use when the user does not specify a model, names a model or provider, compares models, or encounters a generation-parameter error. Use resolve to obtain a callable default and never infer capabilities from names or probe models one by one."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi models --help"
---

# FocalAPI model selection

## Shortest path

When the user does not specify a model, do not list every model or rank them yourself:

```bash
focalapi models resolve image --json
focalapi models resolve video --json
```

`resolve` reads the live list available to the current key, then reads detailed contracts for candidate models and returns:

- `model.id`: the exact ID accepted by generation commands;
- `endpoint_type`: the generation endpoint verified by model details;
- `model.supported_params`: available parameters, defaults, enumerations, and ranges;
- `next_command`: the next command with no guessing required.

Omitting `--model` from `focalapi gen image/video` uses the same selection logic internally.

## User-selected models

```bash
focalapi models get <complete-model-id> --json
```

Search once only when the user provides an incomplete provider or family name:

```bash
focalapi models search <keyword> --json
focalapi models get <selected-complete-id> --json
```

Rules:

1. `models get` is authoritative for endpoints and parameters. A list summary may show only a protocol family and cannot be used to infer modality.
2. Do not send generation requests to models one by one as an availability test. Discovery and detail queries are read-only preflight checks.
3. If an explicitly selected model is unavailable, present available candidates or return to `models resolve`; never replace it silently.
4. Return to the user's original generation task after the query instead of stopping at the model list.
