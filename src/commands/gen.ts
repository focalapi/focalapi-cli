/**
 * focalapi gen：图像生成（/v1/images/generations）与视频生成（/v1/video/generations 任务制）。
 *
 * 计费安全：n、seconds 等计费乘数在 CLI 侧做与后端一致的上限 clamp
 * （对齐 dto.MaxImageN=128、relaycommon.MaxTaskDurationSeconds=3600），
 * 超限直接报错，不把超限请求发给后端。
 */

import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { validateGeminiImageGeneration, validateImageGeneration, validateVideoGeneration } from '../lib/model-capabilities.js';
import { resolveCreativeModel } from '../lib/model-selection.js';
import { downloadTaskContent, extractTaskId, pollTask } from '../lib/tasks.js';
import { info, printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

const MAX_IMAGE_N = 128;
const MAX_TASK_DURATION_SECONDS = 3600;
const DEFAULT_OUT_DIR = 'focalapi-out';

interface ImageResultItem {
  url?: string;
  b64_json?: string;
  mime_type?: string;
  revised_prompt?: string;
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  }>;
}

interface GeminiOmniInteractionResponse {
	id?: string;
	steps?: Array<{
		content?: Array<{
			type?: string;
			data?: string;
			mime_type?: string;
		}>;
	}>;
}

function clampInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError('invalid_request', `${name} 必须是 ${min}–${max} 的整数（收到：${value}）`);
  }
  return value;
}

function parseBooleanOption(value: string, name: string): boolean {
  switch (value.trim().toLowerCase()) {
    case 'true':
      return true;
    case 'false':
      return false;
    default:
      throw new ApiError('invalid_request', `--${name} must be true or false (received: ${value})`);
  }
}

async function withProgress<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  info(`${label}…`);
  const timer = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    info(`${label}，已等待 ${elapsedSeconds} 秒…`);
  }, 10_000);
  timer.unref();
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function saveImageItem(item: ImageResultItem, dir: string, base: string, apiKey: string): Promise<string> {
  if (item.b64_json) {
    const ext = item.mime_type?.includes('jpeg') ? '.jpg' : item.mime_type?.includes('webp') ? '.webp' : '.png';
    const filePath = join(dir, `${base}${ext}`);
    await writeFile(filePath, Buffer.from(item.b64_json, 'base64'));
    return filePath;
  }
  if (item.url) {
    // 上游签名 URL 直链下载；同源 focalapi 链接带 key 也无妨
    const res = await fetch(item.url, {
      headers: item.url.includes('focalapi') ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok || !res.body) {
      throw new ApiError('bad_response', `图像下载失败（HTTP ${res.status}）：${item.url.slice(0, 120)}`);
    }
    const ext = res.headers.get('content-type')?.includes('jpeg') ? '.jpg' : '.png';
    const filePath = join(dir, `${base}${ext}`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(filePath));
    return filePath;
  }
  throw new ApiError('bad_response', '图像结果既没有 url 也没有 b64_json');
}

function parseGenerationConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError('invalid_request', '--config 必须是合法的 generationConfig JSON 对象。');
  }
}

function parseJsonArray(raw: string, option: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch {
    throw new ApiError('invalid_request', `--${option} must be a JSON array`);
  }
}

function parseGeminiResponseModalities(raw: string): string[] {
  const modalities = raw.split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  const unique = new Set(modalities);
  if (unique.size !== modalities.length || !unique.has('IMAGE') || [...unique].some((value) => value !== 'IMAGE' && value !== 'TEXT')) {
    throw new ApiError('invalid_request', '--response-modalities must be IMAGE or IMAGE,TEXT');
  }
  return unique.has('TEXT') ? ['IMAGE', 'TEXT'] : ['IMAGE'];
}

function geminiImagePart(source: string): Record<string, unknown> {
  const dataUri = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(source.trim());
  if (dataUri) {
    const [, mimeType = '', data = ''] = dataUri;
    return { inlineData: { mimeType, data: data.replace(/[\r\n]/g, '') } };
  }
  return { fileData: { fileUri: source } };
}

function geminiOmniImageInput(source: string): Record<string, unknown> {
	const dataUri = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(source.trim());
	if (!dataUri) {
		throw new ApiError('invalid_request', '--image for Gemini Omni must be a base64 data URI');
	}
	const [, mimeType = '', data = ''] = dataUri;
	return { type: 'image', mime_type: mimeType, data: data.replace(/[\r\n]/g, '') };
}

function extractGeminiOmniVideo(response: GeminiOmniInteractionResponse): { data: string; mimeType?: string } | undefined {
	for (const step of response.steps ?? []) {
		for (const content of step.content ?? []) {
			if (content.type === 'video' && content.data) {
				return { data: content.data, mimeType: content.mime_type };
			}
		}
	}
	return undefined;
}

function extractGeminiImageItems(response: GeminiImageResponse): ImageResultItem[] {
  return (response.candidates ?? []).flatMap((candidate) =>
    (candidate.content?.parts ?? []).flatMap((part) =>
      part.inlineData?.data ? [{ b64_json: part.inlineData.data, mime_type: part.inlineData.mimeType }] : [],
    ),
  );
}

export function registerGen(program: Command): void {
  const gen = program.command('gen').description('图像 / 视频生成');

  gen.command('image')
    .description('生成图像（省略 --model 时自动选择当前可用默认模型）')
    .argument('<prompt...>', '提示词')
    .option('-m, --model <model>', '图像模型 ID；省略时由 focalapi 自动选择')
    .option('--size <size>', '尺寸，如 1024x1024')
    .option('--aspect-ratio <ratio>', '原生画面比例（仅 Grok 图像模型），如 16:9')
    .option('--resolution <resolution>', '原生输出档位（仅 Grok 图像模型），如 1k、2k')
    .option('--seed <n>', '随机种子（仅 Grok 图像模型，非负整数）', (v) => Number.parseInt(v, 10))
    .option('--quality <quality>', '图像质量档位（仅支持该参数的模型生效）')
    .option('--background <background>', '背景模式（仅 gpt-image-2 支持 auto/opaque）')
    .option('--watermark <boolean>', '是否添加水印（仅 Seedream，true 或 false）', (v) => parseBooleanOption(v, 'watermark'))
    .option('--output-format <format>', '输出格式（仅 Seedream：png 或 jpeg）')
    .option('--optimize-prompt <mode>', '提示词优化（仅 Seedream：auto、enabled 或 disabled）')
    .option('--image <url...>', '参考图或编辑图 URL，可多个')
    .option('--mask <url>', '编辑 mask URL（gpt-image-2 需要单张参考图）')
    .option('--response-format <format>', '图像响应格式：url 或 b64_json')
    .option('--n <count>', '张数（1–128）', (v) => Number.parseInt(v, 10), 1)
    .option('--no-wait', '提交后立即返回 task_id，不等待图像生成完成')
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .action(async (promptParts: string[], opts: { model?: string; size?: string; aspectRatio?: string; resolution?: string; seed?: number; quality?: string; background?: string; watermark?: boolean; outputFormat?: string; optimizePrompt?: string; image?: string[]; mask?: string; responseFormat?: string; n: number; wait?: boolean; out: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const model = opts.model ?? (await resolveCreativeModel(auth, 'image')).model.id;
      if (!opts.model && !g.json) info(`已自动选择图像模型：${model}`);
      const n = clampInt(opts.n, 1, MAX_IMAGE_N, 'n');
      validateImageGeneration(model, {
        n,
        size: opts.size,
        quality: opts.quality,
        background: opts.background,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        seed: opts.seed,
        watermark: opts.watermark,
        outputFormat: opts.outputFormat,
        optimizePrompt: opts.optimizePrompt,
        responseFormat: opts.responseFormat,
        imageCount: opts.image?.length,
        hasMask: Boolean(opts.mask),
      });
      if (opts.wait === false && opts.responseFormat === 'b64_json') {
        throw new ApiError('invalid_request', '--response-format b64_json cannot be used with --no-wait; use url');
      }
      const body: Record<string, unknown> = { model, prompt: promptParts.join(' '), n };
      if (opts.size) body.size = opts.size;
      if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
      if (opts.resolution) body.resolution = opts.resolution.toLowerCase();
      if (opts.seed !== undefined) body.seed = opts.seed;
      if (opts.quality) body.quality = opts.quality;
      if (opts.background) body.background = opts.background;
      if (opts.watermark !== undefined) body.watermark = opts.watermark;
      if (opts.outputFormat) body.output_format = opts.outputFormat.toLowerCase();
      if (opts.optimizePrompt) body.optimize_prompt_options = { thinking: opts.optimizePrompt.toLowerCase() };
      if (opts.image) body.image = opts.image;
      if (opts.mask) body.mask = opts.mask;
      if (opts.responseFormat) body.response_format = opts.responseFormat;

      const res = await withProgress(opts.wait === false ? '正在提交图像任务' : '正在生成图像', () => request<{ created?: number; data?: ImageResultItem[]; id?: string; status?: string }>({
        baseUrl: auth.baseUrl,
        path: '/v1/images/generations',
        apiKey: auth.apiKey,
        body,
        headers: opts.wait === false ? { Prefer: 'respond-async' } : undefined,
        timeoutMs: 600_000,
      }));
      if (opts.wait === false) {
        const taskId = extractTaskId(res);
        if (!taskId) {
          throw new ApiError('bad_response', '异步图像任务响应中未找到 task_id', { body: res });
        }
        if (g.json) {
          printJson({ model, task_id: taskId, status: res.status ?? 'queued', submitted: true, next_command: `focalapi task status ${taskId} --json` });
        } else {
          process.stdout.write(taskId + '\n');
          info(`任务已提交。查询：focalapi task status ${taskId}`);
        }
        return;
      }
      const items = res.data ?? [];
      if (items.length === 0) {
        throw new ApiError('bad_response', '图像生成响应为空', { body: res });
      }
      const dir = resolve(opts.out);
      await mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const files: string[] = [];
      for (const [i, item] of items.entries()) {
        files.push(await saveImageItem(item, dir, `image-${ts}-${i + 1}`, auth.apiKey));
      }
      if (g.json) {
        printJson({ model, files, count: files.length });
      } else {
        for (const f of files) info(`✓ ${f}`);
      }
    });

  gen.command('gemini-image')
    .description('使用 Gemini 原生 generateContent 接口生成图像')
    .argument('<prompt...>', '提示词')
    .requiredOption('-m, --model <model>', 'Gemini 图像模型 ID；先用 focalapi models get 确认')
    .option('--aspect-ratio <ratio>', '画面比例，例如 1:1、16:9、auto')
    .option('--image-size <size>', '输出尺寸，例如 1K、2K、4K')
    .option('--response-modalities <modalities>', '输出类型：IMAGE 或 IMAGE,TEXT；未传时由服务端默认 IMAGE,TEXT')
    .option('--config <json>', '附加 Gemini generationConfig JSON；命令固定 responseFormat.image 和单候选')
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .option('--image <url...>', 'Gemini reference image URL or data URI; repeatable')
    .option('--system <text>', 'Gemini systemInstruction text')
    .option('--seed <n>', 'Non-negative Gemini generation seed', (v) => Number.parseInt(v, 10))
    .option('--thinking-level <level>', 'Nano Banana 2 Lite: MINIMAL or HIGH')
    .option('--temperature <n>', 'Nano Banana 2 Lite: 0 through 2', (v) => Number.parseFloat(v))
    .option('--top-p <n>', 'Nano Banana 2 Lite: 0 through 1', (v) => Number.parseFloat(v))
    .action(async (promptParts: string[], opts: { model: string; aspectRatio?: string; imageSize?: string; responseModalities?: string; image?: string[]; system?: string; seed?: number; thinkingLevel?: string; temperature?: number; topP?: number; config?: string; out: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      validateGeminiImageGeneration(opts.model, {
        aspectRatio: opts.aspectRatio,
        imageSize: opts.imageSize,
        seed: opts.seed,
        thinkingLevel: opts.thinkingLevel,
        temperature: opts.temperature,
        topP: opts.topP,
      });
      const suppliedConfig = parseGenerationConfig(opts.config);
      const suppliedResponseFormat = suppliedConfig.responseFormat;
      const suppliedImageConfig = suppliedResponseFormat !== null && typeof suppliedResponseFormat === 'object' && !Array.isArray(suppliedResponseFormat)
        ? (suppliedResponseFormat as Record<string, unknown>).image
        : undefined;
      const imageConfig = {
        ...(suppliedImageConfig !== null && typeof suppliedImageConfig === 'object' && !Array.isArray(suppliedImageConfig)
          ? suppliedImageConfig as Record<string, unknown>
          : {}),
        ...(opts.aspectRatio ? { aspectRatio: opts.aspectRatio } : {}),
        ...(opts.imageSize ? { imageSize: opts.imageSize.toUpperCase() } : {}),
      };
      const generationConfig: Record<string, unknown> = {
        ...suppliedConfig,
        candidateCount: 1,
        responseFormat: { image: imageConfig },
        ...(opts.responseModalities ? { responseModalities: parseGeminiResponseModalities(opts.responseModalities) } : {}),
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.thinkingLevel ? { thinkingConfig: { ...(suppliedConfig.thinkingConfig as Record<string, unknown> ?? {}), thinkingLevel: opts.thinkingLevel.toUpperCase() } } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.topP !== undefined ? { topP: opts.topP } : {}),
      };
      const res = await withProgress('正在生成 Gemini 图像', () => request<GeminiImageResponse>({
        baseUrl: auth.baseUrl,
        path: `/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`,
        apiKey: auth.apiKey,
        body: {
          contents: [{ role: 'user', parts: [{ text: promptParts.join(' ') }, ...(opts.image ?? []).map(geminiImagePart)] }],
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
          generationConfig,
        },
        timeoutMs: 600_000,
      }));
      const items = extractGeminiImageItems(res);
      if (items.length === 0) {
        throw new ApiError('bad_response', 'Gemini 图像响应中未找到 inlineData 图像。', { body: res });
      }
      const dir = resolve(opts.out);
      await mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const files: string[] = [];
      for (const [i, item] of items.entries()) {
        files.push(await saveImageItem(item, dir, `gemini-image-${ts}-${i + 1}`, auth.apiKey));
      }
      if (g.json) {
        printJson({ files, count: files.length });
      } else {
        for (const file of files) info(`✓ ${file}`);
      }
    });

  gen.command('omni-video')
    .description('使用 Gemini Omni Flash 原生 Interactions API 生成或编辑视频')
    .argument('<prompt...>', '提示词')
    .option('--image <data-uri...>', '图生视频参考图；仅支持 base64 data URI，可多个')
    .option('--previous-interaction-id <id>', '上一次交互 ID，用于连续视频编辑')
    .option('--aspect-ratio <ratio>', '画面比例：16:9 或 9:16')
    .option('--task <task>', '视频任务：text_to_video、image_to_video、reference_to_video 或 edit')
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .action(async (
      promptParts: string[],
      opts: { image?: string[]; previousInteractionId?: string; aspectRatio?: string; task?: string; out: string },
      cmd: Command,
    ) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      if (opts.aspectRatio && !['16:9', '9:16'].includes(opts.aspectRatio)) {
        throw new ApiError('invalid_request', '--aspect-ratio must be 16:9 or 9:16');
      }
      if (opts.task && !['text_to_video', 'image_to_video', 'reference_to_video', 'edit'].includes(opts.task)) {
        throw new ApiError('invalid_request', '--task must be text_to_video, image_to_video, reference_to_video, or edit');
      }
      const prompt = promptParts.join(' ');
      const imageInputs = (opts.image ?? []).map(geminiOmniImageInput);
      const input: string | Array<Record<string, unknown>> = imageInputs.length === 0
        ? prompt
        : [...imageInputs, { type: 'text', text: prompt }];
      const res = await withProgress('正在生成 Gemini Omni 视频', () => request<GeminiOmniInteractionResponse>({
        baseUrl: auth.baseUrl,
        path: '/v1beta/interactions',
        apiKey: auth.apiKey,
        body: {
          model: 'gemini-omni-flash-preview',
          input,
          ...(opts.previousInteractionId ? { previous_interaction_id: opts.previousInteractionId } : {}),
          ...(opts.aspectRatio ? { response_format: { type: 'video', aspect_ratio: opts.aspectRatio } } : {}),
          ...(opts.task ? { generation_config: { video_config: { task: opts.task } } } : {}),
        },
        timeoutMs: 600_000,
      }));
      const video = extractGeminiOmniVideo(res);
      if (!video) {
        throw new ApiError('bad_response', 'Gemini Omni 响应中未找到视频数据', { body: res });
      }
      const dir = resolve(opts.out);
      await mkdir(dir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const extension = video.mimeType?.includes('webm') ? '.webm' : '.mp4';
      const file = join(dir, `gemini-omni-${timestamp}${extension}`);
      await writeFile(file, Buffer.from(video.data, 'base64'));
      if (g.json) {
        printJson({ interaction_id: res.id, file });
      } else {
        info(`✓ ${file}`);
        if (res.id) info(`交互 ID：${res.id}`);
      }
    });

  gen.command('video')
    .description('生成视频（省略 --model 时自动选择当前可用默认模型）')
    .argument('<prompt...>', '提示词')
    .option('-m, --model <model>', '视频模型 ID；省略时由 focalapi 自动选择')
    .option('--seconds <n>', '时长秒数；精确范围运行 focalapi models get <model> 查看', (v) => Number.parseInt(v, 10))
    .option('--size <size>', '分辨率，如 1280x720')
    .option('--resolution <resolution>', '原生输出分辨率，如 480p、720p、1080p、4k')
    .option('--ratio <ratio>', '原生宽高比，如 16:9、9:16、adaptive')
    .option('--aspect-ratio <ratio>', 'Grok 视频原生画面比例，如 16:9、9:16、auto')
    .option('--seed <n>', 'Grok 视频随机种子（非负整数）', (v) => Number.parseInt(v, 10))
    .option('--image <url...>', '图生视频的源图像 URL，可多个')
    .option('--generate-audio <boolean>', '是否生成音频（只接受 true 或 false）', (v) => parseBooleanOption(v, 'generate-audio'))
    .option('--watermark <boolean>', '是否添加水印（只接受 true 或 false）', (v) => parseBooleanOption(v, 'watermark'))
    .option('--service-tier <tier>', '服务层级（Seedance 2.0 默认 default）')
    .option('--priority <n>', '任务优先级（仅 Seedance 2.0 系列）', (v) => Number.parseInt(v, 10))
    .option('--callback-url <url>', '任务完成回调 URL')
    .option('--return-last-frame <boolean>', '是否返回最后一帧（只接受 true 或 false）', (v) => parseBooleanOption(v, 'return-last-frame'))
    .option('--execution-expires-after <seconds>', '任务过期秒数（3600–259200）', (v) => Number.parseInt(v, 10))
    .option('--safety-identifier <identifier>', 'Seedance 安全标识符（1–64 个可打印 ASCII 字符）')
    .option('--no-wait', '提交后立即返回 task_id，不等待完成')
    .option('--poll-interval <ms>', '轮询间隔毫秒', (v) => Number.parseInt(v, 10), 5_000)
    .option('--timeout <minutes>', '最长等待分钟', (v) => Number.parseInt(v, 10), 30)
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .option('--content <json>', 'Ark-compatible content JSON array; overrides prompt/image facade fields')
    .action(
      async (
        promptParts: string[],
        opts: {
          model?: string; seconds?: number; size?: string; resolution?: string; ratio?: string; aspectRatio?: string; seed?: number; image?: string[]; content?: string;
          generateAudio?: boolean; watermark?: boolean; serviceTier?: string; priority?: number; callbackUrl?: string;
          returnLastFrame?: boolean; executionExpiresAfter?: number; safetyIdentifier?: string;
          wait?: boolean; pollInterval: number; timeout: number; out: string;
        },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals() as GlobalOpts;
        const auth = resolveAuth(g);
        const model = opts.model ?? (await resolveCreativeModel(auth, 'video')).model.id;
        if (!opts.model && !g.json) info(`已自动选择视频模型：${model}`);
        const body: Record<string, unknown> = { model, prompt: promptParts.join(' ') };
        const metadata: Record<string, unknown> = {};
        if (opts.seconds !== undefined) {
          // focalapi 任务 DTO 的 seconds 是字符串类型（对齐 Kling/Seedance 上游格式）
          const seconds = clampInt(opts.seconds, 1, MAX_TASK_DURATION_SECONDS, 'seconds');
          body.duration = seconds;
        }
        if (opts.size) body.size = opts.size;
        if (opts.image) body.images = opts.image;
        if (opts.resolution) metadata.resolution = opts.resolution.toLowerCase();
        if (opts.ratio) metadata.ratio = opts.ratio;
        if (opts.aspectRatio) metadata.ratio = opts.aspectRatio;
        if (opts.seed !== undefined) metadata.seed = opts.seed;
        if (opts.generateAudio !== undefined) metadata.generate_audio = opts.generateAudio;
        if (opts.watermark !== undefined) metadata.watermark = opts.watermark;
        if (opts.serviceTier) metadata.service_tier = opts.serviceTier;
        if (opts.priority !== undefined) metadata.priority = opts.priority;
        if (opts.callbackUrl) metadata.callback_url = opts.callbackUrl;
        if (opts.returnLastFrame !== undefined) metadata.return_last_frame = opts.returnLastFrame;
        if (opts.executionExpiresAfter !== undefined) metadata.execution_expires_after = opts.executionExpiresAfter;
        if (opts.safetyIdentifier) metadata.safety_identifier = opts.safetyIdentifier;
        if (opts.content) metadata.content = parseJsonArray(opts.content, 'content');
        validateVideoGeneration(model, {
          seconds: opts.seconds,
          resolution: opts.resolution,
          ratio: opts.ratio,
          aspectRatio: opts.aspectRatio,
          seed: opts.seed,
          serviceTier: opts.serviceTier,
          priority: opts.priority,
          executionExpiresAfter: opts.executionExpiresAfter,
          safetyIdentifier: opts.safetyIdentifier,
        });
        if (Object.keys(metadata).length > 0) body.metadata = metadata;

        const created = await withProgress('正在提交视频任务', () => request<unknown>({
          baseUrl: auth.baseUrl,
          path: '/v1/video/generations',
          apiKey: auth.apiKey,
          body,
          timeoutMs: 120_000,
        }));
        const taskId = extractTaskId(created);
        if (!taskId) {
          throw new ApiError('bad_response', '视频任务响应中未找到 task_id', { body: created });
        }

        if (opts.wait === false) {
          if (g.json) {
            printJson({ model, task_id: taskId, submitted: true, next_command: `focalapi task status ${taskId} --json` });
          } else {
            process.stdout.write(taskId + '\n');
            info(`任务已提交。续取：focalapi task status ${taskId} / focalapi task download ${taskId}`);
          }
          return;
        }

        info(`任务 ${taskId} 已提交，等待完成……`);
        const final = await pollTask(auth.baseUrl, auth.apiKey, taskId, {
          intervalMs: opts.pollInterval,
          timeoutMs: opts.timeout * 60_000,
          onUpdate: (t) => {
            if (!g.json) {
              info(`  状态：${t.rawStatus || t.status}${t.progress !== undefined ? `（${t.progress}%）` : ''}`);
            }
          },
        });
        const filePath = await downloadTaskContent(auth.baseUrl, auth.apiKey, taskId, opts.out);
        if (g.json) {
          printJson({ model, task_id: taskId, status: final.status, file: filePath });
        } else {
          info(`✓ ${filePath}`);
        }
      },
    );
}
