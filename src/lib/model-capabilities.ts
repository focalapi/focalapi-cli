import { ApiError } from './errors.js';

// This type mirrors the server response from GET /v1/models/:id. The server,
// not this CLI, owns the public parameter contract shown by `models get`.
export type SupportedParameter = {
  name: string;
  type: string;
  required?: boolean;
  default?: string | number | boolean;
  values?: string[];
  minimum?: number;
  maximum?: number;
  description: string;
};

type ImageGenerationConstraint = {
  defaultSize: string;
  maxN: number;
  maxReferenceImages?: number;
  maxTotalImages?: number;
  minMegapixels?: number;
  maxMegapixels?: number;
  minEdge?: number;
  maxEdge?: number;
  edgeMultiple?: number;
  maxAspectRatio?: number;
  qualities?: string[];
  backgrounds?: string[];
};

type VideoGenerationConstraint = {
  resolutions: string[];
  ratios: string[];
  minSeconds: number;
  maxSeconds: number;
};

type GeminiImageConstraint = {
  aspectRatios: string[];
  imageSizes: string[];
  supportsSampling: boolean;
};

const IMAGE_CONSTRAINTS: Record<string, ImageGenerationConstraint> = {
  'gpt-image-2': {
    defaultSize: '1024x1024',
    maxN: 8,
    maxReferenceImages: 16,
    minMegapixels: 0.65536,
    maxMegapixels: 8.2944,
    minEdge: 1024,
    maxEdge: 3840,
    edgeMultiple: 16,
    maxAspectRatio: 3,
    qualities: ['low', 'medium', 'high'],
    backgrounds: ['auto', 'opaque'],
  },
  'doubao-seedream-4-5-251128': {
    defaultSize: '2048x2048',
    maxN: 10,
    maxReferenceImages: 10,
    maxTotalImages: 15,
    minMegapixels: 3.6864,
    maxMegapixels: 16.777216,
  },
  'doubao-seedream-5-0-pro-260628': {
    defaultSize: '1024x1024',
    maxN: 1,
    maxReferenceImages: 10,
    minMegapixels: 0.92,
    maxMegapixels: 4.194304,
  },
  'doubao-seedream-5-0-lite-260128': {
    defaultSize: '2048x2048',
    maxN: 14,
    maxReferenceImages: 14,
    maxTotalImages: 15,
    minMegapixels: 3.6864,
    maxMegapixels: 16.777216,
  },
  'grok-imagine-image-quality': { defaultSize: '1024x1024', maxN: 10, maxReferenceImages: 3 },
  'grok-imagine-image': { defaultSize: '1024x1024', maxN: 10, maxReferenceImages: 3 },
  'grok-imagine-image-pro': { defaultSize: '1024x1024', maxN: 10, maxReferenceImages: 1 },
};

const SEEDANCE_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

const VIDEO_CONSTRAINTS: Record<string, VideoGenerationConstraint> = {
  'doubao-seedance-2-0-260128': {
    resolutions: ['480p', '720p', '1080p', '4k'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
  },
  'doubao-seedance-2-0-fast-260128': {
    resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
  },
  'doubao-seedance-2-0-mini-260615': {
    resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
  },
};

const COMMON_GEMINI_RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const GEMINI_IMAGE_CONSTRAINTS: Record<string, GeminiImageConstraint> = {
  'gemini-3-pro-image-preview': { aspectRatios: COMMON_GEMINI_RATIOS, imageSizes: ['1K', '2K', '4K'], supportsSampling: false },
  'gemini-3.1-flash-image-preview': { aspectRatios: COMMON_GEMINI_RATIOS, imageSizes: ['1K', '2K', '4K'], supportsSampling: false },
  'gemini-3.1-flash-lite-image-preview': {
    aspectRatios: [...COMMON_GEMINI_RATIOS, '1:4', '4:1', '1:8', '8:1'], imageSizes: ['1K'], supportsSampling: true,
  },
};

function parseSize(size: string, model: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) {
    throw new ApiError('invalid_request', `${model} size must be WIDTHxHEIGHT (received: ${size})`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function megapixels(width: number, height: number): number {
  return (width * height) / 1_000_000;
}

function formatMegapixels(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

export function validateImageGeneration(
  model: string,
  input: { n: number; size?: string; quality?: string; background?: string; responseFormat?: string; imageCount?: number; hasMask?: boolean },
): void {
  if (input.responseFormat && input.responseFormat !== 'url' && input.responseFormat !== 'b64_json') {
    throw new ApiError('invalid_request', `response_format must be url or b64_json (received: ${input.responseFormat})`);
  }
  const constraint = IMAGE_CONSTRAINTS[model.trim()];
  if (!constraint) return;
  if (input.n < 1 || input.n > constraint.maxN) {
    throw new ApiError('invalid_request', `${model} n must be 1-${constraint.maxN} (received: ${input.n})`);
  }
  if (input.imageCount !== undefined && constraint.maxReferenceImages !== undefined && input.imageCount > constraint.maxReferenceImages) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxReferenceImages} reference images`);
  }
  if (input.imageCount !== undefined && constraint.maxTotalImages !== undefined && input.imageCount + input.n > constraint.maxTotalImages) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxTotalImages} input plus generated images`);
  }
  if (input.hasMask && model === 'gpt-image-2' && input.imageCount !== 1) {
    throw new ApiError('invalid_request', 'gpt-image-2 mask requires exactly one reference image');
  }
  if (input.quality && constraint.qualities && !constraint.qualities.includes(input.quality.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} quality must be one of ${constraint.qualities.join(', ')} (received: ${input.quality})`);
  }
  if (input.background && constraint.backgrounds && !constraint.backgrounds.includes(input.background.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} background must be one of ${constraint.backgrounds.join(', ')} (received: ${input.background})`);
  }
  const { width, height } = parseSize(input.size ?? constraint.defaultSize, model);
  const pixels = megapixels(width, height);
  if ((constraint.minEdge && (width < constraint.minEdge || height < constraint.minEdge)) ||
      (constraint.maxEdge && (width > constraint.maxEdge || height > constraint.maxEdge)) ||
      (constraint.edgeMultiple && (width % constraint.edgeMultiple !== 0 || height % constraint.edgeMultiple !== 0)) ||
      (constraint.minMegapixels && pixels < constraint.minMegapixels) ||
      (constraint.maxMegapixels && pixels > constraint.maxMegapixels)) {
    const edge = constraint.minEdge && constraint.maxEdge ? `${constraint.minEdge}-${constraint.maxEdge}px per edge` : '';
    const step = constraint.edgeMultiple ? `, edge multiples of ${constraint.edgeMultiple}` : '';
    const mp = constraint.minMegapixels && constraint.maxMegapixels
      ? `, ${formatMegapixels(constraint.minMegapixels)}-${formatMegapixels(constraint.maxMegapixels)} MP`
      : '';
    throw new ApiError('invalid_request', `${model} does not support size=${width}x${height}; supported: ${edge}${step}${mp}`);
  }
  if (constraint.maxAspectRatio) {
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (ratio > constraint.maxAspectRatio) {
      throw new ApiError('invalid_request', `${model} longest-to-shortest edge ratio must not exceed ${constraint.maxAspectRatio}:1 (received: ${width}x${height})`);
    }
  }
}

export function validateGeminiImageGeneration(model: string, input: { aspectRatio?: string; imageSize?: string; seed?: number; thinkingLevel?: string; temperature?: number; topP?: number }): void {
  const constraint = GEMINI_IMAGE_CONSTRAINTS[model.trim()];
  if (!constraint) {
    throw new ApiError('invalid_request', `${model} is not a supported Gemini image model; run focalapi models get ${model} first`);
  }
  if (input.aspectRatio && !constraint.aspectRatios.includes(input.aspectRatio)) {
    throw new ApiError('invalid_request', `${model} aspectRatio must be one of ${constraint.aspectRatios.join(', ')} (received: ${input.aspectRatio})`);
  }
  if (input.imageSize && !constraint.imageSizes.includes(input.imageSize.toUpperCase())) {
    throw new ApiError('invalid_request', `${model} imageSize must be one of ${constraint.imageSizes.join(', ')} (received: ${input.imageSize})`);
  }
  if (input.seed !== undefined && (!Number.isInteger(input.seed) || input.seed < 0)) {
    throw new ApiError('invalid_request', 'seed must be a non-negative integer');
  }
  if (!constraint.supportsSampling && (input.thinkingLevel || input.temperature !== undefined || input.topP !== undefined)) {
    throw new ApiError('invalid_request', `${model} supports thinkingLevel, temperature, and topP only on gemini-3.1-flash-lite-image-preview`);
  }
  if (input.thinkingLevel && !['MINIMAL', 'HIGH'].includes(input.thinkingLevel.toUpperCase())) {
    throw new ApiError('invalid_request', 'thinkingLevel must be MINIMAL or HIGH');
  }
  if (input.temperature !== undefined && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) {
    throw new ApiError('invalid_request', 'temperature must be between 0 and 2');
  }
  if (input.topP !== undefined && (!Number.isFinite(input.topP) || input.topP < 0 || input.topP > 1)) {
    throw new ApiError('invalid_request', 'topP must be between 0 and 1');
  }
}

export function validateVideoGeneration(
  model: string,
  input: {
    seconds?: number;
    resolution?: string;
    ratio?: string;
    serviceTier?: string;
    priority?: number;
    executionExpiresAfter?: number;
    safetyIdentifier?: string;
  },
): void {
  const constraint = VIDEO_CONSTRAINTS[model.trim()];
  if (!constraint) return;
  if (input.seconds !== undefined && (input.seconds < constraint.minSeconds || input.seconds > constraint.maxSeconds)) {
    throw new ApiError('invalid_request', `${model} seconds must be ${constraint.minSeconds}-${constraint.maxSeconds} (received: ${input.seconds})`);
  }
  if (input.resolution && !constraint.resolutions.includes(input.resolution.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} resolution must be one of ${constraint.resolutions.join(', ')} (received: ${input.resolution})`);
  }
  if (input.ratio && !constraint.ratios.includes(input.ratio)) {
    throw new ApiError('invalid_request', `${model} ratio must be one of ${constraint.ratios.join(', ')} (received: ${input.ratio})`);
  }
  if (input.priority !== undefined && model !== 'doubao-seedance-2-0-260128') {
    throw new ApiError('invalid_request', `${model} does not support priority; only doubao-seedance-2-0-260128 does`);
  }
  if (input.priority !== undefined && (input.priority < 0 || input.priority > 9)) {
    throw new ApiError('invalid_request', `${model} priority must be 0-9 (received: ${input.priority})`);
  }
  if (input.serviceTier && input.serviceTier !== 'default') {
    throw new ApiError('invalid_request', `${model} service_tier must be default (received: ${input.serviceTier})`);
  }
  if (input.executionExpiresAfter !== undefined && (input.executionExpiresAfter < 3600 || input.executionExpiresAfter > 259200)) {
    throw new ApiError('invalid_request', `${model} execution_expires_after must be 3600-259200 (received: ${input.executionExpiresAfter})`);
  }
  if (input.safetyIdentifier !== undefined && !/^[\x21-\x7e]{1,64}$/.test(input.safetyIdentifier)) {
    throw new ApiError('invalid_request', `${model} safety_identifier must contain 1-64 printable ASCII characters`);
  }
}
