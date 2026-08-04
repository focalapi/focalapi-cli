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
import { rawRequest, request } from '../lib/http.js';
import { downloadTaskContent, extractTaskId, pollTask } from '../lib/tasks.js';
import { info, printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

const MAX_IMAGE_N = 128;
const MAX_TASK_DURATION_SECONDS = 3600;
const DEFAULT_OUT_DIR = 'focalapi-out';

interface ImageResultItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

function clampInt(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError('invalid_request', `${name} 必须是 ${min}–${max} 的整数（收到：${value}）`);
  }
  return value;
}

async function saveImageItem(item: ImageResultItem, dir: string, base: string, apiKey: string): Promise<string> {
  if (item.b64_json) {
    const filePath = join(dir, `${base}.png`);
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

export function registerGen(program: Command): void {
  const gen = program.command('gen').description('图像 / 视频生成');

  gen.command('image')
    .description('生成图像（同步返回，产物自动下载到本地）')
    .argument('<prompt...>', '提示词')
    .requiredOption('-m, --model <model>', '图像模型 ID（focalapi models list 查看）')
    .option('--size <size>', '尺寸，如 1024x1024')
    .option('--n <count>', '张数（1–128）', (v) => Number.parseInt(v, 10), 1)
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .action(async (promptParts: string[], opts: { model: string; size?: string; n: number; out: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const n = clampInt(opts.n, 1, MAX_IMAGE_N, 'n');
      const body: Record<string, unknown> = { model: opts.model, prompt: promptParts.join(' '), n };
      if (opts.size) body.size = opts.size;

      const res = await request<{ created?: number; data?: ImageResultItem[] }>({
        baseUrl: auth.baseUrl,
        path: '/v1/images/generations',
        apiKey: auth.apiKey,
        body,
        timeoutMs: 600_000,
      });
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
        printJson({ files, count: files.length });
      } else {
        for (const f of files) info(`✓ ${f}`);
      }
    });

  gen.command('video')
    .description('生成视频（任务制：默认轮询至完成并下载；--no-wait 只取 task_id）')
    .argument('<prompt...>', '提示词')
    .requiredOption('-m, --model <model>', '视频模型 ID（focalapi models list 查看）')
    .option('--seconds <n>', '时长秒数（1–3600）', (v) => Number.parseInt(v, 10))
    .option('--size <size>', '分辨率，如 1280x720')
    .option('--no-wait', '提交后立即返回 task_id，不等待完成')
    .option('--poll-interval <ms>', '轮询间隔毫秒', (v) => Number.parseInt(v, 10), 5_000)
    .option('--timeout <minutes>', '最长等待分钟', (v) => Number.parseInt(v, 10), 30)
    .option('-o, --out <dir>', '输出目录', DEFAULT_OUT_DIR)
    .action(
      async (
        promptParts: string[],
        opts: { model: string; seconds?: number; size?: string; wait?: boolean; pollInterval: number; timeout: number; out: string },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals() as GlobalOpts;
        const auth = resolveAuth(g);
        const body: Record<string, unknown> = { model: opts.model, prompt: promptParts.join(' ') };
        if (opts.seconds !== undefined) {
          body.seconds = clampInt(opts.seconds, 1, MAX_TASK_DURATION_SECONDS, 'seconds');
        }
        if (opts.size) body.size = opts.size;

        const created = await request<unknown>({
          baseUrl: auth.baseUrl,
          path: '/v1/video/generations',
          apiKey: auth.apiKey,
          body,
          timeoutMs: 120_000,
        });
        const taskId = extractTaskId(created);
        if (!taskId) {
          throw new ApiError('bad_response', '视频任务响应中未找到 task_id', { body: created });
        }

        if (opts.wait === false) {
          if (g.json) {
            printJson({ task_id: taskId, submitted: true });
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
          printJson({ task_id: taskId, status: final.status, file: filePath });
        } else {
          info(`✓ ${filePath}`);
        }
      },
    );
}
