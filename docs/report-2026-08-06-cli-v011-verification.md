# focalapi-cli v0.1.1 performance and reliability verification

- Date: 2026-08-06
- Version: focalapi-cli@0.1.1 published on npm; focalapi.com deployed at f66a2ae06
- Method: a complete **new-user workflow** with no prior CLI knowledge, using only help and error messages, plus a full-model stability regression
- Key: sk-ts***z8Xp, an unlimited test token
- Baseline: `docs/benchmark-report-2026-08-05.md`, the initial v0.1.0 run

## Executive summary

1. **The Gemini image failure (P1) was fixed and verified end to end.** Three Gemini models on the legacy path plus the new native `generateContent` path produced images in 4/4 attempts, compared with 6/6 failures previously.
2. **The zero-guesswork new-user goal was met.** Help and error messages alone were sufficient to complete sign-in → model discovery → chat → image → video submission/polling/download → usage → diagnostics. Invalid parameters were rejected locally with the correct range; none reached an upstream 400.
3. **The stability regression was fully green.** Images passed 6/6, video passed 1/1, chat and doctor worked, `make test` passed 42 checks, and all 57 CLI tests passed.
4. Three non-blocking guidance gaps remained: discovering an audio model, documenting the video-seconds range, and the absence of an audio-model supply.

## Test matrix

| Area | Case | Result | Evidence |
|---|---|---|---|
| Installation/version | Latest npm version equals local version | ✅ | Both were 0.1.1. |
| No-key guidance | Run with an empty profile | ✅ | `missing_api_key`, the sign-in command, and the key-creation URL were shown. |
| Discoverability | Top-level help | ✅ | Clear creative-workflow positioning and one-line descriptions for all 12 commands. |
| Sign-in | `auth login/status` | ✅ | Doctor confirmed `config` as the key source. |
| Model queries | `models list/get` | ✅ | 16 models; details returned contract-level `supported_params`. |
| Chat | `chat deepseek-v4-flash` | ✅ | Valid response and token statistics. |
| Images, legacy path | 3 Gemini, 2 Seedream, gpt-image-2, and 1 Grok model | ✅ 7/7 | All produced valid 1.6–5.9 MB PNG files. |
| Images, new path | `gen gemini-image` using native `generateContent` | ✅ | Image generation succeeded. |
| Video | Seedance Mini, 5 seconds: submit → poll → download | ✅ | Completed in 195s with a valid 7.7 MB MP4. |
| Usage | `usage` | ✅ | Period usage formatted as `1,866.3856`. |
| Diagnostics | `doctor` | ✅ | All four checks passed: key, network, rehearsal model, and quota. |
| Parameter boundary | Video `--seconds 1` and `30` | ✅ Rejected locally | `seconds must be 4-15 (received: 1)` with no upstream round trip. |
| Parameter boundary | Seedream `--size 1024x1024` | ✅ Rejected locally | `does not support size=1024x1024; supported: 3.69-16.78 MP`. |

## New-user zero-guesswork journey

The walkthrough assumed an Agent that had never seen the CLI and used only help text and errors:

| Step | Guidance source | Trial and error required | Notes |
|---|---|---|---|
| Understand capabilities | `focalapi --help` | No | Commands and one-line responsibilities established the creative-workflow focus. |
| Configure a key | No-key error | No | Included `auth login --key` and the key-creation URL. |
| Select a model | `models list` | No | Listed 16 models and providers; `models get` exposed parameter contracts. |
| Generate an image | `gen image --help` | No | Documented all 11 options, including quality, background, mask, and `n`. |
| Correct an image parameter | Local validation | No | Rejected the request and supplied the supported megapixel range. |
| Generate video | `gen video --help` | No | Documented 16 options and printed task-status/download continuation commands after submission. |
| Correct video duration | Local validation | No | `seconds must be 4-15` gave the accepted range directly. |
| Continue a task | Submission output | No | The displayed commands could be copied to poll and download. |
| Understand a wait | Progress output | No | Elapsed 10/20-second messages removed ambiguity about a hang. |
| Diagnose an error | Error-code model | No | `upstream_auth_failed` distinguished an upstream failure from the user's key. |

**Conclusion: zero guesswork.** Every invalid user input was rejected locally with the correct range, and every asynchronous flow supplied its next command.

## Gemini P1 fix verification

| Model | Initial test on 2026-08-05 | Retest on 2026-08-06 | Time |
|---|---|---|---|
| gemini-3.1-flash-image-preview | ❌ 6/6 `invalid_api_key` | ✅ Image produced | ~13s |
| gemini-3.1-flash-lite-image-preview | ❌ | ✅ Image produced | ~13s |
| gemini-3-pro-image-preview | ❌ | ✅ Image produced | ~27s |
| New Gemini image path using the native endpoint | — | ✅ Image produced | ~10s |

The error chain evolved from misleading `invalid_api_key`, to `authentication_failed`, to diagnosable `upstream_auth_failed`, and finally to successful generation after the upstream fix.

## Performance data from the 2026-08-06 retest

| Model | Time | 2026-08-05 baseline | Assessment |
|---|---|---|---|
| grok-imagine-image-quality | 24s | 18–19s | Consistently fast |
| gpt-image-2 | 36s | 34–38s | Stable |
| doubao-seedream-5-0-lite at 2048² | 45s | 62–72s | Within the observed range |
| doubao-seedream-5-0-pro at 2048² | ~45s | 131–189s | Materially improved, with queue effects |
| gemini-3.1-flash-image-preview | ~13s | Unavailable | Fast after recovery |
| doubao-seedance-2-0-mini, 5-second video | 195s including polling granularity | 127s | Queue variation |

## Final issue status

| ID | Issue | Status |
|---|---|---|
| C1 | Model parameter constraints were absent | ✅ Implemented in both the CLI validator and platform `supported_params`. |
| C2 | Errors were not diagnosable | ✅ Added `upstream_auth_failed`, `request_id`, and upstream code. |
| C3 | Usage printed raw JSON | ✅ Formatted. |
| C4 | No progress feedback | ✅ Added elapsed-time output. |
| C5 | `null` displayed as a string | ✅ Displays `-`. |
| P1 | Gemini images were unavailable | ✅ Fixed through the upstream key and native endpoint path. |
| P2 | List/detail data disagreed | ✅ Consistent. |
| P3 | Metadata lacked parameter constraints | ✅ Added `supported_params` and documentation. |
| P4 | Image latency varied | ⏳ Queue-related, not a defect. |
| P5 | Seedance Fast did not match observed speed | ⏳ Upstream scheduling, not a defect. |
| **N1 (new)** | Audio `-m` had no default or model-source guidance | ⚠️ Recommended: mark audio models in `models list` or add an example to audio help. |
| **N2 (new)** | Video `--seconds` help said 1–3600 while actual models allowed 4–15 | ⚠️ Recommended: state that the model-specific range comes from `models get`. Local validation already protected the request, so priority was low. |
| **N3 (new)** | No production audio, search, embedding, or rerank model supply | ⚠️ Platform supply issue; the CLI should state clearly when no model is available. |

## Insights

- **Guidance is product behavior.** Errors that include valid ranges, such as `seconds must be 4-15`, and asynchronous output that includes continuation commands are more effective than standalone parameter documentation because correction happens at the failure point.
- **Semantic error-code evolution matters.** Moving from `invalid_api_key` to `upstream_auth_failed` showed that codes should identify the responsible layer, not only the symptom, so an Agent can decide whether to retry, replace a key, or escalate.
- **Dual Gemini paths**—the legacy OpenAI-compatible route and the native `generateContent` route—balanced compatibility with protocol correctness and provided a reference solution for protocol mismatch.
- P4/P5 performance varied with the Comfy queue rather than CLI or platform code. Any SLA should be based on p95 measurements instead of an average.

## Recommendations

1. Apply the low-cost N1/N2 help improvements; N3 resolves when the platform adds a model supply.
2. Preserve the new-user journey as a CI smoke test. `focalapi doctor` and parameter-boundary assertions already existed in the 57-test suite.
3. Investigating P4/P5 further requires platform-side queue-depth and wait-time metrics.
