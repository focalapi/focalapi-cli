/**
 * 面向 Agent 的创作模型自动选择。
 *
 * 这里的顺序是 focalapi-cli 明确维护、并通过线上模型契约验证过的产品默认值。
 * 运行时仍以当前 Key 的 /v1/models 与 /v1/models/:id 为准：候选不在当前
 * 模型池或契约不支持目标端点时不会被选中。
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
    'grok-imagine-image-quality',
    'seedream-4-5-251128',
  ],
  video: [
    'dreamina-seedance-2-5-260628',
    'veo-3.1-generate-preview',
    'grok-imagine-video-1.5',
    'dreamina-seedance-2-0-260128',
    'veo-3.1-fast-generate-preview',
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

  // 新模型可能尚未进入 CLI 的默认排序。仅在列表本身明确给出端点类型时
  // 才作为降级候选，避免根据模型名字猜测模态。
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
