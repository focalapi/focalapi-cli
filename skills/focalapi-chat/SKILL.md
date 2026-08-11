---
name: focalapi-chat
version: 2.0.0
description: "Supplementary FocalAPI text and audio commands. Use only when the user explicitly requests text assistance through FocalAPI or when the live model contract confirms an available audio model. Route image and video creation to focalapi-gen."
metadata:
  requires:
    bins: ["focalapi"]
  cliHelp: "focalapi chat --help"
---

# Supplementary FocalAPI capabilities

This Skill is not the default route for creative requests. Route images, video, image editing, and image-to-video work to `focalapi-gen`.

When the user explicitly requests text assistance, get an available text model from the live list before calling it:

```bash
focalapi models list --json
focalapi chat "<user text task>" -m <text-model-from-list> --json
```

Use audio commands only when both `focalapi models get <model-id> --json` and `focalapi audio --help` confirm an executable contract:

```bash
focalapi audio transcribe <file> -m <model-id> --json
focalapi audio speech "<text>" -m <model-id> -o <file> --json
```

A name appearing in the model list does not prove that the CLI supports calling it. If the current key has no audio model contract, state that audio is unavailable; do not try a similar model or an external API.
