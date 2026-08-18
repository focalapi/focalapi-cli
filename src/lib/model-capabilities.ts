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
  defaultSize?: string;
  maxN: number;
  sizeTiers?: string[];
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
  aspectRatios?: string[];
  resolutions?: string[];
  supportsSeed?: boolean;
  supportsWatermark?: boolean;
  outputFormats?: string[];
  optimizePromptModes?: string[];
  creativityModes?: string[];
  supportsNegativePrompt?: boolean;
  supportsPromptExtend?: boolean;
  maxStyleReferences?: number;
  maxMoodboards?: number;
  maxSeed?: number;
};

type VideoGenerationConstraint = {
  resolutions: string[];
  ratios?: string[];
  aspectRatios?: string[];
  minSeconds: number;
  maxSeconds: number;
  allowedSeconds?: number[];
  requiredSecondsByResolution?: Record<string, number>;
  supportsPriority?: boolean;
  supportsSeed?: boolean;
  maxSeed?: number;
  /** Cap for --image (reference images / media inputs). */
  maxReferenceImages?: number;
  /** Resolution whitelist while reference images are present (e.g. Grok 1.5 r2v caps at 720p). */
  referenceResolutions?: string[];
  /** Model rejects reference images entirely (Grok legacy video is image-to-video only). */
  disallowReferences?: boolean;
  /** Cap for --first-frame (image-to-video mode). */
  maxFirstFrameImages?: number;
  /** Tighter safety_tolerance ceiling while any image is attached (flux-3 caps at 2 for i2v/v2v). */
  safetyToleranceMaxWithImages?: number;
  /** Explicit false = the model rejects generate_audio; undefined = pass through. */
  supportsGenerateAudio?: boolean;
  /** Explicit false = the model rejects watermark; undefined = pass through. */
  supportsWatermark?: boolean;
  allowedFps?: number[];
  safetyTolerance?: { minimum: number; maximum: number };
};

type GeminiImageConstraint = {
  aspectRatios: string[];
  imageSizes?: string[];
  supportsSampling: boolean;
  maxReferenceImages?: number;
  /** Reference images must be base64 data URIs (inlineData); fileUri is rejected upstream. */
  referenceImagesInlineDataOnly?: boolean;
  maxSeed?: number;
};

// 2^63-1 cannot be represented as an exact JSON number, so the CLI caps seeds at
// Number.MAX_SAFE_INTEGER to never silently corrupt a large seed value.
const GEMINI_IMAGE_MAX_SEED = 9_007_199_254_740_991;

const SEEDREAM_OUTPUT_FORMATS = ['png', 'jpeg'];
const SEEDREAM_OPTIMIZE_PROMPT_MODES = ['auto', 'enabled', 'disabled'];
const GROK_IMAGE_ASPECT_RATIOS = [
  'auto', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '9:19.5', '19.5:9', '1:2', '2:1', '1:3', '3:1',
];
const GROK_IMAGE_20_ASPECT_RATIOS = [
  'auto', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1',
];
const KLING_IMAGE_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
const KREA_IMAGE_ASPECT_RATIOS = ['1:1', '4:3', '3:2', '16:9', '2.35:1', '4:5', '2:3', '9:16'];

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
  'seedream-4-0-250828': {
    defaultSize: '2k',
    sizeTiers: ['1k', '2k', '4k'],
    maxN: 10,
    maxReferenceImages: 10,
    maxTotalImages: 15,
    minMegapixels: 0.92,
    maxMegapixels: 16.777216,
    supportsWatermark: true,
    outputFormats: SEEDREAM_OUTPUT_FORMATS,
    optimizePromptModes: SEEDREAM_OPTIMIZE_PROMPT_MODES,
  },
  'seedream-4-5-251128': {
    defaultSize: '2k',
    sizeTiers: ['2k', '4k'],
    maxN: 10,
    maxReferenceImages: 10,
    maxTotalImages: 15,
    minMegapixels: 3.6864,
    maxMegapixels: 16.777216,
    supportsWatermark: true,
    outputFormats: SEEDREAM_OUTPUT_FORMATS,
    optimizePromptModes: SEEDREAM_OPTIMIZE_PROMPT_MODES,
  },
  'dola-seedream-5-0-pro-260628': {
    defaultSize: '1k',
    sizeTiers: ['1k', '1.5k', '2k'],
    maxN: 1,
    maxReferenceImages: 10,
    minMegapixels: 0.92,
    maxMegapixels: 4.194304,
    supportsWatermark: true,
    outputFormats: SEEDREAM_OUTPUT_FORMATS,
    optimizePromptModes: SEEDREAM_OPTIMIZE_PROMPT_MODES,
  },
  'seedream-5-0-260128': {
    defaultSize: '2k',
    sizeTiers: ['2k', '3k', '4k'],
    maxN: 14,
    maxReferenceImages: 14,
    maxTotalImages: 15,
    minMegapixels: 3.6864,
    maxMegapixels: 16.777216,
    supportsWatermark: true,
    outputFormats: SEEDREAM_OUTPUT_FORMATS,
    optimizePromptModes: SEEDREAM_OPTIMIZE_PROMPT_MODES,
  },
  'grok-imagine-image-quality': {
    maxN: 10, maxReferenceImages: 3,
    aspectRatios: GROK_IMAGE_ASPECT_RATIOS, resolutions: ['1k', '2k'], supportsSeed: true, maxSeed: 2147483647,
  },
  'grok-imagine-image': {
    maxN: 10, maxReferenceImages: 3,
    aspectRatios: GROK_IMAGE_ASPECT_RATIOS, resolutions: ['1k', '2k'], supportsSeed: true, maxSeed: 2147483647,
  },
  'grok-imagine-image-2.0': {
    maxN: 10, maxReferenceImages: 3,
    aspectRatios: GROK_IMAGE_20_ASPECT_RATIOS, resolutions: ['1k', '2k'], qualities: ['low', 'medium'],
    supportsSeed: true, maxSeed: 2147483647,
  },
  'kling-v3': {
    maxN: 9, maxReferenceImages: 1, aspectRatios: KLING_IMAGE_ASPECT_RATIOS, supportsNegativePrompt: true,
  },
  'krea-2-medium': {
    maxN: 1, maxReferenceImages: 0, aspectRatios: KREA_IMAGE_ASPECT_RATIOS, resolutions: ['1k'], supportsSeed: true,
    maxSeed: 2147483647, creativityModes: ['raw', 'low', 'medium', 'high'], maxStyleReferences: 10, maxMoodboards: 1,
  },
  'krea-2-medium-turbo': {
    maxN: 1, maxReferenceImages: 0, aspectRatios: KREA_IMAGE_ASPECT_RATIOS, resolutions: ['1k'], supportsSeed: true,
    maxSeed: 2147483647, creativityModes: ['raw', 'low', 'medium', 'high'], maxStyleReferences: 10, maxMoodboards: 1,
  },
  'krea-2-large': {
    maxN: 1, maxReferenceImages: 0, aspectRatios: KREA_IMAGE_ASPECT_RATIOS, resolutions: ['1k'], supportsSeed: true,
    maxSeed: 2147483647, creativityModes: ['raw', 'low', 'medium', 'high'], maxStyleReferences: 10, maxMoodboards: 1,
  },
  'qwen-image-3.0': {
    defaultSize: '1024x1024', maxN: 6, maxReferenceImages: 3, minMegapixels: 0.262144,
    maxMegapixels: 4.194304, maxAspectRatio: 8, supportsSeed: true, maxSeed: 2147483647,
    supportsNegativePrompt: true, supportsPromptExtend: true, supportsWatermark: true,
  },
  'qwen-image-3.0-pro': {
    defaultSize: '1024x1024', maxN: 6, maxReferenceImages: 3, minMegapixels: 0.262144,
    maxMegapixels: 4.194304, maxAspectRatio: 8, supportsSeed: true, maxSeed: 2147483647,
    supportsNegativePrompt: true, supportsPromptExtend: true, supportsWatermark: true,
  },
};

const SEEDANCE_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const GROK_VIDEO_ASPECT_RATIOS = ['auto', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'];
const KLING_VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'];
const VIDU_VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '3:4', '4:3', '1:1'];
const FLUX_VIDEO_RATIOS = ['auto', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'];

const VIDEO_CONSTRAINTS: Record<string, VideoGenerationConstraint> = {
  'dreamina-seedance-2-0-260128': {
    resolutions: ['480p', '720p', '1080p', '4k'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
    maxReferenceImages: 9,
  },
  'dreamina-seedance-2-0-fast-260128': {
    resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
    maxReferenceImages: 9,
  },
  'seed-2-0-mini-260428': {
    resolutions: ['480p', '720p'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 15,
    maxReferenceImages: 9,
  },
  'dreamina-seedance-2-5-260628': {
    resolutions: ['480p', '720p', '1080p'], ratios: SEEDANCE_RATIOS, minSeconds: 4, maxSeconds: 30,
    maxReferenceImages: 30,
  },
  'gemini-omni-flash-preview': {
    resolutions: [], ratios: ['16:9', '9:16'], minSeconds: 3, maxSeconds: 10,
    maxReferenceImages: 14, supportsGenerateAudio: false,
  },
  'grok-imagine-video': {
    resolutions: ['480p', '720p'], aspectRatios: GROK_VIDEO_ASPECT_RATIOS,
    minSeconds: 1, maxSeconds: 15, disallowReferences: true, maxFirstFrameImages: 1,
    supportsGenerateAudio: false, supportsWatermark: false,
  },
  'grok-imagine-video-1.5': {
    resolutions: ['480p', '720p', '1080p'], aspectRatios: GROK_VIDEO_ASPECT_RATIOS,
    minSeconds: 1, maxSeconds: 15, maxReferenceImages: 7, referenceResolutions: ['480p', '720p'],
    maxFirstFrameImages: 1, supportsGenerateAudio: false, supportsWatermark: false,
  },
  'kling-3.0': {
    resolutions: ['720p', '1080p', '4k'], aspectRatios: KLING_VIDEO_ASPECT_RATIOS, minSeconds: 3, maxSeconds: 15,
    maxReferenceImages: 2, supportsGenerateAudio: true,
  },
  'viduq3-pro': {
    resolutions: ['720p', '1080p'], aspectRatios: VIDU_VIDEO_ASPECT_RATIOS,
    minSeconds: 1, maxSeconds: 16, supportsSeed: true, maxSeed: 2147483647, maxReferenceImages: 2,
  },
  'viduq3-turbo': {
    resolutions: ['720p', '1080p'], aspectRatios: VIDU_VIDEO_ASPECT_RATIOS,
    minSeconds: 1, maxSeconds: 16, supportsSeed: true, maxSeed: 2147483647, maxReferenceImages: 2,
  },
  'ltx-2-5-fast': {
    resolutions: ['1280x720', '720x1280', '1920x1080', '1080x1920', '2560x1440', '1440x2560', '3840x2160', '2160x3840'],
    minSeconds: 6, maxSeconds: 20, allowedSeconds: [6, 8, 10, 12, 14, 16, 18, 20],
    allowedFps: [24, 25, 48, 50], maxReferenceImages: 2, supportsGenerateAudio: true,
  },
  'ltx-2-5-pro': {
    resolutions: ['1280x720', '720x1280', '1920x1080', '1080x1920'],
    minSeconds: 6, maxSeconds: 10, allowedSeconds: [6, 8, 10],
    allowedFps: [24, 25, 50], maxReferenceImages: 2, supportsGenerateAudio: true,
  },
  'flux-3': {
    resolutions: ['hd', 'fhd'], ratios: FLUX_VIDEO_RATIOS, minSeconds: 5, maxSeconds: 20,
    safetyTolerance: { minimum: 0, maximum: 4 }, safetyToleranceMaxWithImages: 2, maxReferenceImages: 10,
  },
};

const COMMON_GEMINI_RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
// Nano Banana 2 V2 / Lite nodes extend the ratio surface with four extremes.
const EXTENDED_GEMINI_RATIOS = [...COMMON_GEMINI_RATIOS, '1:4', '4:1', '1:8', '8:1'];
const GEMINI_IMAGE_CONSTRAINTS: Record<string, GeminiImageConstraint> = {
  'gemini-2.5-flash-image': {
    aspectRatios: COMMON_GEMINI_RATIOS, supportsSampling: false,
    maxReferenceImages: 1, referenceImagesInlineDataOnly: true, maxSeed: GEMINI_IMAGE_MAX_SEED,
  },
  'gemini-3-pro-image': {
    aspectRatios: COMMON_GEMINI_RATIOS, imageSizes: ['1K', '2K', '4K'], supportsSampling: false,
    maxReferenceImages: 14, maxSeed: GEMINI_IMAGE_MAX_SEED,
  },
  'gemini-3.1-flash-image': {
    aspectRatios: EXTENDED_GEMINI_RATIOS, imageSizes: ['1K', '2K', '4K'], supportsSampling: true,
    maxReferenceImages: 14, maxSeed: GEMINI_IMAGE_MAX_SEED,
  },
  'gemini-3.1-flash-lite-image': {
    aspectRatios: EXTENDED_GEMINI_RATIOS, imageSizes: ['1K'], supportsSampling: true,
    maxReferenceImages: 14, maxSeed: GEMINI_IMAGE_MAX_SEED,
  },
};

function parseSize(size: string, model: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) {
    throw new ApiError('invalid_request', `${model} size must be a supported tier or WIDTHxHEIGHT (received: ${size})`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function megapixels(width: number, height: number): number {
  return (width * height) / 1_000_000;
}

function formatMegapixels(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '');
}

function validateOptionalChoice(
  model: string,
  name: string,
  value: string | undefined,
  supported: string[] | undefined,
): void {
  if (!value) return;
  if (!supported) {
    throw new ApiError('invalid_request', `${model} does not support ${name}`);
  }
  if (!supported.includes(value.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} ${name} must be one of ${supported.join(', ')} (received: ${value})`);
  }
}

export function validateImageGeneration(
  model: string,
  input: {
    n: number;
    size?: string;
    quality?: string;
    background?: string;
    responseFormat?: string;
    imageCount?: number;
    hasMask?: boolean;
    aspectRatio?: string;
    resolution?: string;
    seed?: number;
    watermark?: boolean;
    outputFormat?: string;
    optimizePrompt?: string;
    negativePrompt?: string;
    creativity?: string;
    promptExtend?: boolean;
    styleReferenceCount?: number;
    moodboardCount?: number;
  },
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
  validateOptionalChoice(model, 'quality', input.quality, constraint.qualities);
  validateOptionalChoice(model, 'background', input.background, constraint.backgrounds);
  validateOptionalChoice(model, 'aspect_ratio', input.aspectRatio, constraint.aspectRatios);
  validateOptionalChoice(model, 'resolution', input.resolution, constraint.resolutions);
  validateOptionalChoice(model, 'output_format', input.outputFormat, constraint.outputFormats);
  validateOptionalChoice(model, 'optimize_prompt', input.optimizePrompt, constraint.optimizePromptModes);
  validateOptionalChoice(model, 'creativity', input.creativity, constraint.creativityModes);
  if (input.negativePrompt !== undefined && !constraint.supportsNegativePrompt) {
    throw new ApiError('invalid_request', `${model} does not support negative_prompt`);
  }
  if (input.negativePrompt !== undefined && model === 'kling-v3' && (input.imageCount ?? 0) > 0) {
    throw new ApiError('invalid_request', 'kling-v3 negative_prompt cannot be combined with an image input');
  }
  if (input.promptExtend !== undefined && !constraint.supportsPromptExtend) {
    throw new ApiError('invalid_request', `${model} does not support prompt_extend`);
  }
  if (input.styleReferenceCount !== undefined && (
    constraint.maxStyleReferences === undefined || input.styleReferenceCount > constraint.maxStyleReferences
  )) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxStyleReferences ?? 0} image style references`);
  }
  if (input.moodboardCount !== undefined && (
    constraint.maxMoodboards === undefined || input.moodboardCount > constraint.maxMoodboards
  )) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxMoodboards ?? 0} moodboards`);
  }
  if (input.seed !== undefined) {
    if (!constraint.supportsSeed) {
      throw new ApiError('invalid_request', `${model} does not support seed`);
    }
    if (!Number.isInteger(input.seed) || input.seed < 0 || (constraint.maxSeed !== undefined && input.seed > constraint.maxSeed)) {
      const maximum = constraint.maxSeed === undefined ? '' : ` no greater than ${constraint.maxSeed}`;
      throw new ApiError('invalid_request', `seed must be a non-negative integer${maximum}`);
    }
  }
  if (input.watermark !== undefined && !constraint.supportsWatermark) {
    throw new ApiError('invalid_request', `${model} does not support watermark`);
  }

  if (!constraint.defaultSize) {
    if (input.size) {
      throw new ApiError('invalid_request', `${model} does not support size; use its aspect_ratio or resolution parameter`);
    }
    return;
  }
  const suppliedSize = input.size ?? constraint.defaultSize;
  if (constraint.sizeTiers?.includes(suppliedSize.toLowerCase())) return;
  if (constraint.sizeTiers && !/^\d+x\d+$/i.test(suppliedSize)) {
    throw new ApiError('invalid_request', `${model} size must be one of ${constraint.sizeTiers.join(', ')} or WIDTHxHEIGHT (received: ${suppliedSize})`);
  }
  const { width, height } = parseSize(suppliedSize, model);
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

export function validateGeminiImageGeneration(
  model: string,
  input: {
    aspectRatio?: string;
    imageSize?: string;
    seed?: number;
    thinkingLevel?: string;
    temperature?: number;
    topP?: number;
    referenceImageCount?: number;
    nonDataUriReferenceCount?: number;
  },
): void {
  const constraint = GEMINI_IMAGE_CONSTRAINTS[model.trim()];
  if (!constraint) {
    throw new ApiError('invalid_request', `${model} is not a supported Gemini image model; run focalapi models get ${model} first`);
  }
  if (input.aspectRatio && !constraint.aspectRatios.includes(input.aspectRatio)) {
    throw new ApiError('invalid_request', `${model} aspectRatio must be one of ${constraint.aspectRatios.join(', ')} (received: ${input.aspectRatio})`);
  }
  if (input.imageSize && !constraint.imageSizes?.includes(input.imageSize.toUpperCase())) {
    const supported = constraint.imageSizes?.join(', ') ?? 'none';
    throw new ApiError('invalid_request', `${model} imageSize must be one of ${supported} (received: ${input.imageSize})`);
  }
  if (input.seed !== undefined && (!Number.isInteger(input.seed) || input.seed < 0 || (constraint.maxSeed !== undefined && input.seed > constraint.maxSeed))) {
    const maximum = constraint.maxSeed === undefined ? '' : ` no greater than ${constraint.maxSeed}`;
    throw new ApiError('invalid_request', `seed must be a non-negative integer${maximum}`);
  }
  if (input.referenceImageCount !== undefined && constraint.maxReferenceImages !== undefined && input.referenceImageCount > constraint.maxReferenceImages) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxReferenceImages} reference image${constraint.maxReferenceImages === 1 ? '' : 's'}`);
  }
  if (constraint.referenceImagesInlineDataOnly && input.nonDataUriReferenceCount) {
    throw new ApiError('invalid_request', `${model} reference images must be base64 data URIs (inlineData); fileUri inputs are rejected by this model`);
  }
  if (!constraint.supportsSampling && (input.thinkingLevel || input.temperature !== undefined || input.topP !== undefined)) {
    throw new ApiError('invalid_request', `${model} supports thinkingLevel, temperature, and topP only on gemini-3.1-flash-image and gemini-3.1-flash-lite-image`);
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
    aspectRatio?: string;
    seed?: number;
    serviceTier?: string;
    priority?: number;
    fps?: number;
    safetyTolerance?: number;
    executionExpiresAfter?: number;
    safetyIdentifier?: string;
    imageCount?: number;
    firstFrameCount?: number;
    generateAudio?: boolean;
    watermark?: boolean;
  },
): void {
  const constraint = VIDEO_CONSTRAINTS[model.trim()];
  if (!constraint) return;
  if ((input.imageCount ?? 0) > 0 && (input.firstFrameCount ?? 0) > 0) {
    throw new ApiError('invalid_request', `${model}: --image and --first-frame are mutually exclusive (reference-to-video vs image-to-video)`);
  }
  if (constraint.disallowReferences && (input.imageCount ?? 0) > 0) {
    throw new ApiError('invalid_request', `${model} supports image-to-video only (single --first-frame image); reference images require grok-imagine-video-1.5`);
  }
  if (input.imageCount !== undefined && constraint.maxReferenceImages !== undefined && input.imageCount > constraint.maxReferenceImages) {
    throw new ApiError('invalid_request', `${model} supports at most ${constraint.maxReferenceImages} reference image${constraint.maxReferenceImages === 1 ? '' : 's'}`);
  }
  if (input.firstFrameCount !== undefined && constraint.maxFirstFrameImages !== undefined && input.firstFrameCount > constraint.maxFirstFrameImages) {
    throw new ApiError('invalid_request', `${model} image-to-video supports exactly ${constraint.maxFirstFrameImages} starting image${constraint.maxFirstFrameImages === 1 ? '' : 's'} (--first-frame)`);
  }
  if (input.generateAudio !== undefined && constraint.supportsGenerateAudio === false) {
    throw new ApiError('invalid_request', `${model} does not support generate_audio`);
  }
  if (input.watermark !== undefined && constraint.supportsWatermark === false) {
    throw new ApiError('invalid_request', `${model} does not support watermark`);
  }
	if (input.seconds !== undefined && (input.seconds < constraint.minSeconds || input.seconds > constraint.maxSeconds)) {
		throw new ApiError('invalid_request', `${model} seconds must be ${constraint.minSeconds}-${constraint.maxSeconds} (received: ${input.seconds})`);
	}
	if (input.seconds !== undefined && constraint.allowedSeconds && !constraint.allowedSeconds.includes(input.seconds)) {
		throw new ApiError('invalid_request', `${model} seconds must be one of ${constraint.allowedSeconds.join(', ')} (received: ${input.seconds})`);
	}
	if (input.resolution && !constraint.resolutions.includes(input.resolution.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} resolution must be one of ${constraint.resolutions.join(', ')} (received: ${input.resolution})`);
  }
  if (input.resolution && (input.imageCount ?? 0) > 0 && constraint.referenceResolutions &&
      !constraint.referenceResolutions.includes(input.resolution.toLowerCase())) {
    throw new ApiError('invalid_request', `${model} reference-to-video mode supports only ${constraint.referenceResolutions.join(' and ')} (received: ${input.resolution}); ${input.resolution} requires text-to-video or a single --first-frame image`);
  }
	if (input.seconds !== undefined && input.resolution) {
		const required = constraint.requiredSecondsByResolution?.[input.resolution.toLowerCase()];
		if (required !== undefined && input.seconds !== required) {
			throw new ApiError('invalid_request', `${model} resolution ${input.resolution} requires ${required} seconds`);
		}
	}
  if (input.ratio) {
    if (!constraint.ratios) {
      throw new ApiError('invalid_request', `${model} uses --aspect-ratio instead of --ratio`);
    }
    if (!constraint.ratios.includes(input.ratio)) {
      throw new ApiError('invalid_request', `${model} ratio must be one of ${constraint.ratios.join(', ')} (received: ${input.ratio})`);
    }
  }
  if (input.aspectRatio) {
    if (!constraint.aspectRatios) {
      throw new ApiError('invalid_request', `${model} uses --ratio instead of --aspect-ratio`);
    }
    if (!constraint.aspectRatios.includes(input.aspectRatio)) {
      throw new ApiError('invalid_request', `${model} aspect_ratio must be one of ${constraint.aspectRatios.join(', ')} (received: ${input.aspectRatio})`);
    }
  }
  if (input.seed !== undefined) {
    if (!constraint.supportsSeed) {
      throw new ApiError('invalid_request', `${model} does not support seed`);
    }
    if (!Number.isInteger(input.seed) || input.seed < 0 || (constraint.maxSeed !== undefined && input.seed > constraint.maxSeed)) {
      const maximum = constraint.maxSeed === undefined ? '' : ` no greater than ${constraint.maxSeed}`;
      throw new ApiError('invalid_request', `seed must be a non-negative integer${maximum}`);
    }
  }
  if (input.fps !== undefined && (!constraint.allowedFps || !constraint.allowedFps.includes(input.fps))) {
    throw new ApiError('invalid_request', `${model} fps must be one of ${constraint.allowedFps?.join(', ') ?? 'none'} (received: ${input.fps})`);
  }
  if (input.safetyTolerance !== undefined && constraint.safetyTolerance) {
    const ceiling = (input.imageCount ?? 0) > 0 && constraint.safetyToleranceMaxWithImages !== undefined
      ? Math.min(constraint.safetyTolerance.maximum, constraint.safetyToleranceMaxWithImages)
      : constraint.safetyTolerance.maximum;
    if (!Number.isInteger(input.safetyTolerance) || input.safetyTolerance < constraint.safetyTolerance.minimum || input.safetyTolerance > ceiling) {
      const withImagesNote = constraint.safetyToleranceMaxWithImages !== undefined && ceiling !== constraint.safetyTolerance.maximum
        ? ` while images are attached (text-only allows up to ${constraint.safetyTolerance.maximum})`
        : '';
      throw new ApiError('invalid_request', `${model} safety_tolerance must be ${constraint.safetyTolerance.minimum}-${ceiling}${withImagesNote} (received: ${input.safetyTolerance})`);
    }
  }
  if (input.priority !== undefined && !constraint.supportsPriority) {
    throw new ApiError('invalid_request', `${model} does not support priority`);
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
