/**
 * Shared task-based workflow logic for video and similar operations: ID extraction, status normalization, polling, and downloads.
 *
 * FocalAPI task responses come from multiple upstreams such as Comfy Cloud, Kling, and Jimeng.
 * Parse task_id, status, and progress permissively while preserving all other fields unchanged.
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ApiError } from './errors.js';
import { rawRequest, request } from './http.js';

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'unknown';

const SUCCESS_STATES = new Set(['success', 'succeeded', 'completed', 'done', 'finish', 'finished']);
const FAILED_STATES = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled']);
const RUNNING_STATES = new Set(['running', 'processing', 'in_progress', 'generating']);
const PENDING_STATES = new Set(['pending', 'queued', 'submitted', 'waiting', 'not_start']);

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? '').toLowerCase();
  if (SUCCESS_STATES.has(s)) return 'success';
  if (FAILED_STATES.has(s)) return 'failed';
  if (RUNNING_STATES.has(s)) return 'running';
  if (PENDING_STATES.has(s)) return 'pending';
  return 'unknown';
}

/** Extract a task ID from task_id, id, or taskId. */
export function extractTaskId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  const direct = obj.task_id ?? obj.id ?? obj.taskId;
  if (typeof direct === 'string' && direct) return direct;
  if (typeof direct === 'number') return String(direct);
  const data = obj.data as Record<string, unknown> | undefined;
  const nested = data?.task_id ?? data?.id;
  if (typeof nested === 'string' && nested) return nested;
  return undefined;
}

/** Extract progress in the 0–100 range, or return undefined when absent. */
export function extractProgress(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  for (const key of ['progress', 'percent']) {
    const v = obj[key] ?? (obj.data as Record<string, unknown> | undefined)?.[key];
    if (typeof v === 'number') return v <= 1 ? Math.round(v * 100) : Math.round(v);
    if (typeof v === 'string') {
      const n = Number.parseFloat(v.replace('%', ''));
      if (!Number.isNaN(n)) return n <= 1 ? Math.round(n * 100) : Math.round(n);
    }
  }
  return undefined;
}

export interface TaskInfo {
  taskId: string;
  status: TaskStatus;
  rawStatus: string;
  progress?: number;
  raw: unknown;
}

export async function fetchTask(baseUrl: string, apiKey: string, taskId: string): Promise<TaskInfo> {
  let raw: unknown;
  try {
    raw = await request<unknown>({
      baseUrl,
      path: `/v1/video/generations/${encodeURIComponent(taskId)}`,
      apiKey,
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    raw = await request<unknown>({
      baseUrl,
      path: `/v1/images/generations/${encodeURIComponent(taskId)}`,
      apiKey,
    });
  }
  const obj = raw as Record<string, unknown>;
  const rawStatus = String(obj?.status ?? (obj?.data as Record<string, unknown> | undefined)?.status ?? '');
  return {
    taskId,
    status: normalizeTaskStatus(rawStatus),
    rawStatus,
    progress: extractProgress(raw),
    raw,
  };
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Callback for each status change, used to render progress. */
  onUpdate?: (info: TaskInfo) => void;
}

/** Poll a task until it succeeds, fails, or times out. */
export async function pollTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  opts?: PollOptions,
): Promise<TaskInfo> {
  const intervalMs = opts?.intervalMs ?? 5_000;
  const timeoutMs = opts?.timeoutMs ?? 30 * 60_000;
  const deadline = Date.now() + timeoutMs;
  let last: TaskInfo | undefined;
  for (;;) {
    last = await fetchTask(baseUrl, apiKey, taskId);
    opts?.onUpdate?.(last);
    if (last.status === 'success') return last;
    if (last.status === 'failed') {
      throw new ApiError('task_failed', `任务 ${taskId} 失败（上游状态：${last.rawStatus || 'unknown'}）`, {
        body: last.raw,
        hint: '运行 focalapi task status ' + taskId + ' --json 查看上游返回详情；若是提示词或参数问题请调整后重试。',
      });
    }
    if (Date.now() > deadline) {
      throw new ApiError('timeout', `任务 ${taskId} 等待超时（${Math.round(timeoutMs / 60000)} 分钟）`, {
        hint: `可稍后运行 focalapi task status ${taskId} 查看，或 focalapi task download ${taskId} 续取产物。`,
      });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
};

/** Download a task artifact through the TokenAuth content proxy and return its absolute path. */
export async function downloadTaskContent(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  outDir: string,
  filenameBase?: string,
): Promise<string> {
  const res = await rawRequest({
    baseUrl,
    path: `/v1/videos/${encodeURIComponent(taskId)}/content`,
    apiKey,
    timeoutMs: 600_000,
  });
  const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const ext = EXT_BY_CONTENT_TYPE[contentType] ?? '.bin';
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${filenameBase ?? `task-${taskId}`}${ext}`);
  if (!res.body) {
    throw new ApiError('bad_response', '下载响应缺少 body');
  }
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(filePath));
  return filePath;
}
