# FocalAPI non-DeepSeek model stability and performance benchmark

- Date: 2026-08-05
- Tool: focalapi-cli@0.1.0, installed globally with the `default` profile
- Environment: local Windows machine → https://api.focalapi.com (Los Angeles VPS)
- Key: sk-ts***z8Xp, an unlimited test token
- Scope: all 13 models other than deepseek-v4-flash/pro (10 image and 3 video models)
- Rule: **conclusions use only tests with correct parameters that required no correction**. The first Seedream attempts at 1024² failed because the test parameters were invalid and are excluded.

## Method

| Area | Method |
|---|---|
| Images | 10 models × 2 runs with the same prompt, "a cute orange cat sitting on a wooden windowsill, soft morning sunlight, photorealistic". Seedream used 2048×2048 because the models require 3.69–16.78 MP; other models used 1024×1024. |
| Video | 3 models × 1 run at 5 seconds and 1280×720. Task timing recorded submit, start, and finish timestamps, and every downloaded artifact was verified as non-empty. |
| Reproduction | `bash .hermes/tmp/img-bench2.sh` from the focalapi-llm workspace. Video used `focalapi gen video -m <model> --seconds 5 --size 1280x720 --no-wait` followed by `focalapi task status <task_id>`. |

## Image results (10 models × 2 runs)

| Model | Run 1 | Run 2 | Success rate | Assessment |
|---|---|---|---|---|
| doubao-seedream-4-5-251128 | ✅ 121.0s | ✅ 31.9s | 2/2 | ⚠️ 4× variation caused by queue differences |
| doubao-seedream-5-0-lite-260128 | ✅ 72.1s | ✅ 62.4s | 2/2 | Moderate |
| doubao-seedream-5-0-pro-260628 | ✅ 131.4s | ✅ 189.4s | 2/2 | Slowest at 2–3 minutes |
| gemini-3.1-flash-image-preview | ❌ 1.5s | ❌ 1.4s | 0/2 | **Unavailable because the upstream key was invalid** |
| gemini-3.1-flash-lite-image-preview | ❌ 1.6s | ❌ 1.9s | 0/2 | **Unavailable because the upstream key was invalid** |
| gemini-3-pro-image-preview | ❌ 1.2s | ❌ 1.6s | 0/2 | **Unavailable because the upstream key was invalid** |
| gpt-image-2 | ✅ 33.6s | ✅ 38.3s | 2/2 | Stable |
| grok-imagine-image | ✅ 31.0s | ✅ 28.0s | 2/2 | Stable |
| grok-imagine-image-pro | ✅ 19.8s | ✅ 17.5s | 2/2 | Fast and stable |
| grok-imagine-image-quality | ✅ 18.8s | ✅ 18.6s | 2/2 | Fast and stable |

- Artifacts: 19 non-empty PNG files, 241 KB–5.9 MB, written to `focalapi-llm/focalapi-bench-img/`.
- Conclusion: 7 of 10 image models were available, with 14/14 successful requests. All three Gemini models failed.

## Video results (3 models, 5 seconds, 720p, 24 fps with audio)

| Model | Submit → finish | Queue | Generation | Charge per request (quota) |
|---|---|---|---|---|
| doubao-seedance-2-0-260128 | 130s | 8s | 122s | 340,273 |
| doubao-seedance-2-0-fast-260128 | 129s | 8s | 121s | 273,698 |
| doubao-seedance-2-0-mini-260615 | 127s | 7s | 120s | 170,136 |

- Artifacts: three valid 4.5–7.5 MB MP4 files written to `focalapi-llm/focalapi-bench-vid/`.
- Conclusion: 3/3 succeeded. The fast variant had no measurable speed advantage (1 second difference) and was only 20% cheaper. Mini was 50% cheaper at the same speed.

### Video retest with the same prompt, 5 seconds, 720p, 16:9, 24 fps, and audio

| Model | Submit → finish | Queue | Generation | completion_tokens | Final quota |
|---|---:|---:|---:|---:|---:|
| doubao-seedance-2-0-260128 | 171s | 21s | 150s | 108,000 | 340,273 |
| doubao-seedance-2-0-fast-260128 | 153s | 35s | 118s | 108,000 | 273,698 |
| doubao-seedance-2-0-mini-260615 | 122s | 34s | 88s | 108,000 | 170,136 |

All three tasks succeeded. Returned `total_tokens` and `completion_tokens` were both 108,000. Final quotas matched the relative official prices of RMB 46/37/23 per million tokens, with no 10× markup or extra audio multiplier.

The Fast and Mini retests were submitted at similar times, but queue conditions were not strictly controlled. The 118-second Fast result therefore cannot be treated as an official latency SLA. Across both rounds, the speed advantage was inconsistent; Fast should be considered a pricing tier rather than a guaranteed fixed-multiple low-latency tier.

## Findings

### CLI defects in focalapi-cli@0.1.0

| ID | Issue | Evidence | Recommended fix |
|---|---|---|---|
| C1 | **Model parameter constraints were absent** | `models get` exposed no size or duration ranges. Passing 1024² to Seedream returned a 400 before revealing its 3.69–16.78 MP requirement. In comparison, the Ark CLI workflow requires `models get` to inspect `supported_params` before generation. | Add a CLI model-constraint table or expose the fields through the platform API, then validate before generation and report the supported megapixel or duration range. |
| C2 | **Errors were not diagnosable** | Gemini failures showed only `openai_error`, while `invalid_api_key` incorrectly blamed the user's valid key instead of the upstream channel key. | Preserve the upstream message and request ID, and separate the error code from the observed symptom. |
| C3 | **Usage printed raw JSON in the table** | Period usage displayed `{"object":"list","total_usage":1667.9882}`. | Parse and format the billing object. |
| C4 | **Synchronous image generation had no progress feedback** | seedream-5-0-pro produced no output for three minutes, making a live request indistinguishable from a hang. | Print elapsed generation time or expose progress polling. |
| C5 | **`models get` stringified object values directly** | `supported_endpoint_types` displayed the string `"null"`. | Fix this with C3. |

### Platform issues in the focalapi.com API/backend

| ID | Issue | Evidence | Notes |
|---|---|---|---|
| P1 | **All three Gemini image models were unavailable** | 6/6 requests failed in 1.2–1.9 seconds with `invalid_api_key`. | This reproduced a known 2026-08-05 end-to-end finding: the `gemini-*-image` channel returned 401 because upstream account authentication had expired. Repair or remove the models. |
| P2 | **`models list` and `models get` disagreed** | The list returned `supported_endpoint_types:[image-generation,openai]`, while `GET /v1/models/{id}` returned `null`. | Backend `model_meta` serialization was inconsistent. |
| P3 | **Model metadata lacked parameter constraints** | `/v1/models/{id}` exposed no size, duration, or quantity range, while the Ark platform exposed `supported_params`. | Platform metadata is the upstream solution for C1. |
| P4 | **Image latency varied widely** | seedream-4-5 took 121s and 32s with identical parameters; seedream-5-0-pro took 131s and 189s. | A task-based fallback would make synchronous APIs easier for Agents to use. |
| P5 | **The Seedance Fast name did not match observed latency** | Completion time was effectively the same as the standard variant, with only a 20% lower charge. | Review pricing and naming, or investigate upstream concurrency limits. |

## Insights

- **Performance tiers:** Grok (18–31s) > gpt-image-2 (34–38s) > Seedream (32–189s). Prefer grok-imagine-pro/quality for images; the three-minute Seedream 5.0 Pro wait was not worthwhile unless its quality was required.
- **Prefer Seedance Mini:** it was half the price with no observed speed loss. The Fast tier did not establish a stable latency benefit.
- **Opaque error propagation was the largest Agent-integration risk** (C2/P1). Collapsing errors into `openai_error` prevented callers from deciding whether to retry, replace a key, or stop, making this the highest-priority fix.

## Notes

- This is a stability benchmark, not a peak-load stress test. Latency variation includes Comfy Cloud queue time.
- Test script: `focalapi-llm/.hermes/tmp/img-bench2.sh`. Version 1 used invalid parameters and was retired. A reusable version should live in focalapi-cli under `scripts/bench` with an `npm run bench` entry point.

## Fix verification loop (2026-08-06; CLI d34e33e and LLM f66a2ae06 pushed and deployed)

| Issue | Status | Retest evidence |
|---|---|---|
| C1 model constraints | ✅ Implemented in both layers | The CLI model-capability table rejects invalid sizes locally. Platform `models get` returns `supported_params`, including the implicit Seedream 3.69–16.78 MP contract, Seedance duration min=4/max=15, and resolution/ratio enumerations. |
| C2 undiagnosable errors | ✅ Fixed | Added `upstream_auth_failed`, which states that upstream authentication failed and does not imply an invalid FocalAPI key, plus `request_id` and upstream-code propagation. Observed Gemini errors progressed from `invalid_api_key` to `authentication_failed` to `upstream_auth_failed`. |
| C3 raw usage JSON | ✅ Fixed | Period usage displays `1,866.3856`. |
| C4 no progress feedback | ✅ Fixed | Generation now reports that image generation is in progress. |
| C5 `null` string | ✅ Fixed | Displays `-`. |
| P1 Gemini unavailable | ⏳ Not fixed in this retest | Errors were diagnosable through `upstream_auth_failed`, but the upstream key still failed and the 16 models remained listed. |
| P2 list/get inconsistency | ✅ Fixed | `get` no longer returns null. |
| P3 metadata lacked constraints | ✅ Fixed | `supported_params` and documentation were published. |
| P4 latency variation | ⏳ Not a code issue | Caused by queue conditions. |
| P5 Fast naming | ⏳ Not a code issue | Determined by upstream scheduling. |

Regression verification: CLI typecheck, build, and 57 tests passed on v0.1.1; `make test` passed 42 checks; seedream-5-0-pro succeeded at 2048²; and Seedance Mini succeeded at 5 seconds in 150 seconds with quota 170,136, matching the baseline.
