/**
 * Automatic creative-model selection for Agents.
 *
 * This order contains product defaults maintained by focalapi-cli and verified against live contracts.
 * Runtime selection remains authoritative to /v1/models and /v1/models/:id for the current key.
 * A candidate is never selected when it is absent from the current pool or its contract lacks the target endpoint.
 */

import { ApiError } from './errors.js';
import { request } from './http.js';
import type { ResolvedAuth } from './config.js';

export type CreativeCapability = 'image' | 'video';

export interface CreativeModelEntry {
  id: string;
  owned_by?: string;
  supported_endpoint_types?: string[];
  supported_params?: unknown[];
  error?: { message?: string; code?: string; type?: string };
  [key: string]: unknown;
}

interface ModelListResponse {
  data?: CreativeModelEntry[];
}

export interface ResolvedCreativeModel {
  capability: CreativeCapability;
  endpoint_type: 'image-generation' | 'video-generation';
  model: CreativeModelEntry;
  selected_by: 'focalapi-default';
  next_command: string;
  alternatives: string[];
}

const RECOMMENDED_MODELS: Record<CreativeCapability, readonly string[]> = {
  image: [
    'seedream-5-0-260128',
    'gpt-image-2',
    'gemini-3.1-flash-image',
    'grok-imagine-image-2.0',
    'kling-v3',
    'qwen-image-3.0-pro',
    'krea-2-large',
    'seedream-4-5-251128',
  ],
  video: [
    'dreamina-seedance-2-5-260628',
    'kling-3.0',
    'viduq3-pro',
    'gemini-omni-flash-preview',
    'grok-imagine-video-1.5',
    'ltx-2-5-fast',
    'flux-3',
    'dreamina-seedance-2-0-260128',
  ],
};

export function parseCreativeCapability(value: string): CreativeCapability {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image' || normalized === 'video') return normalized;
  throw new ApiError('invalid_request', `不支持的创作能力：${value}`, {
    hint: '可选：image | video。',
  });
}

export async function resolveCreativeModel(
  auth: Pick<ResolvedAuth, 'apiKey' | 'baseUrl'>,
  capability: CreativeCapability,
): Promise<ResolvedCreativeModel> {
  const endpointType = capability === 'image' ? 'image-generation' : 'video-generation';
  const listed = await request<ModelListResponse>({
    baseUrl: auth.baseUrl,
    path: '/v1/models',
    apiKey: auth.apiKey,
  });
  const available = new Map((listed.data ?? []).map((model) => [model.id, model]));
  const ranked = RECOMMENDED_MODELS[capability].filter((id) => available.has(id));

  // A new model may not yet be in the CLI default order. Use it as a fallback only when
  // the list explicitly exposes its endpoint type; never infer modality from its name.
  const discovered = (listed.data ?? [])
    .filter((model) => model.supported_endpoint_types?.includes(endpointType))
    .map((model) => model.id)
    .filter((id) => !ranked.includes(id));

  const candidates = [...ranked, ...discovered];
  for (const id of candidates) {
    const contract = await request<CreativeModelEntry>({
      baseUrl: auth.baseUrl,
      path: `/v1/models/${encodeURIComponent(id)}`,
      apiKey: auth.apiKey,
    });
    if (contract.error || !contract.id || !contract.supported_endpoint_types?.includes(endpointType)) {
      continue;
    }
    const alternatives = candidates.filter((candidate) => candidate !== id && available.has(candidate)).slice(0, 4);
    return {
      capability,
      endpoint_type: endpointType,
      model: contract,
      selected_by: 'focalapi-default',
      next_command: capability === 'image'
        ? `focalapi gen image \"<prompt>\" -m ${id} --json`
        : `focalapi gen video \"<prompt>\" -m ${id} --no-wait --json`,
      alternatives,
    };
  }

  throw new ApiError('model_not_found', `当前 Key 没有可直接调用的${capability === 'image' ? '图像' : '视频'}生成模型`, {
    hint: '运行 focalapi models list --json 查看当前模型池；不要猜测或反复试模型 ID。',
  });
}
