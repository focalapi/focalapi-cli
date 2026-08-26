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

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'unknown';

const SUCCESS_STATES = new Set(['success', 'succeeded', 'completed', 'done', 'finish', 'finished']);
// expired is terminal with an automatic refund; cancelled is its own terminal state.
const FAILED_STATES = new Set(['failed', 'failure', 'error', 'expired']);
const CANCELLED_STATES = new Set(['cancelled', 'canceled']);
const RUNNING_STATES = new Set(['running', 'processing', 'in_progress', 'generating']);
const PENDING_STATES = new Set(['pending', 'queued', 'submitted', 'waiting', 'not_start']);

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? '').toLowerCase();
  if (SUCCESS_STATES.has(s)) return 'success';
  if (CANCELLED_STATES.has(s)) return 'cancelled';
  if (FAILED_STATES.has(s)) return 'failed';
  if (RUNNING_STATES.has(s)) return 'running';
  if (PENDING_STATES.has(s) || s.startsWith('queued_')) return 'pending';
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
  createdAt?: number;
  raw: unknown;
}

/** Extract the task creation timestamp (unix seconds) from either response envelope. */
function extractCreatedAt(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.created_at, (obj.data as Record<string, unknown> | undefined)?.created_at];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && candidate > 0) return candidate;
    if (typeof candidate === 'string') {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

/** Cancel a queued task via DELETE /v1/video/generations/:task_id. Only queued tasks are cancellable. */
export async function cancelTask(baseUrl: string, apiKey: string, taskId: string): Promise<void> {
  try {
    await request<unknown>({
      baseUrl,
      path: `/v1/video/generations/${encodeURIComponent(taskId)}`,
      method: 'DELETE',
      apiKey,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      const code = err.upstreamCode;
      if (code === 'task_already_running') {
        throw new ApiError('task_already_running', `任务 ${taskId} 已开始运行，无法取消`, {
          status: err.status,
          hint: '运行中的任务不可取消；用 focalapi task status ' + taskId + ' 跟踪到完成后下载产物。',
        });
      }
      if (code === 'task_already_finished') {
        throw new ApiError('task_already_finished', `任务 ${taskId} 已结束，无需取消`, {
          status: err.status,
          hint: '运行 focalapi task status ' + taskId + ' 查看结果；成功后可下载产物。',
        });
      }
      if (code === 'task_not_found') {
        throw new ApiError('task_not_found', `任务 ${taskId} 不存在或不属于当前 Key`, {
          status: err.status,
          hint: 'task_id 区分大小写且混有小写 l / 数字 1 / 大写 I，必须逐字复制；请回查提交输出后再试。',
        });
      }
      if (code === 'task_cancel_incomplete') {
        throw new ApiError('task_cancel_incomplete', `任务 ${taskId} 已取消但清理未完成`, {
          status: err.status,
          hint: '请重试同一条 cancel 命令完成清理。',
        });
      }
    }
    throw err;
  }
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
    createdAt: extractCreatedAt(raw),
    raw,
  };
}

export interface TaskListItem {
  task_id: string;
  model?: string;
  action?: string;
  status?: string;
  progress?: number;
  quota?: number;
  created_at?: number;
  updated_at?: number;
}

/** List the caller's recent tasks for reconciliation (GET /v1/tasks). */
export async function listTasks(
  baseUrl: string,
  apiKey: string,
  opts?: { status?: string; action?: string; limit?: number; offset?: number },
): Promise<TaskListItem[]> {
  const raw = await request<{ data?: TaskListItem[] }>({
    baseUrl,
    path: '/v1/tasks',
    apiKey,
    query: {
      status: opts?.status,
      action: opts?.action,
      limit: opts?.limit,
      offset: opts?.offset,
    },
  });
  return raw.data ?? [];
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
  // A dropped poll must never kill the wait: the task exists server-side and
  // a status query is free (it can never double-charge). Transient network
  // errors are retried with backoff; server answers (4xx/5xx bodies) still
  // surface immediately (vid/img matrix evidence: mid-wait connection drops
  // occurred in ~1.5% of 24-way concurrent runs and always recovered).
  let transientFailures = 0;
  for (;;) {
    try {
      last = await fetchTask(baseUrl, apiKey, taskId);
      transientFailures = 0;
    } catch (error) {
      const transient = error instanceof ApiError && error.code === 'network_error';
      if (!transient || ++transientFailures >= 5) {
        if (transient) {
          throw new ApiError('network_error', `连续 5 次状态查询失败：任务 ${taskId} 可能仍在运行`, {
            hint: `网络抖动只中断了轮询，任务本身不受影响、也不会重复计费。网络恢复后运行：focalapi task status ${taskId} --wait --download`,
          });
        }
        throw error;
      }
      await new Promise((r) => setTimeout(r, Math.min(intervalMs * transientFailures, 15_000)));
      continue;
    }
    opts?.onUpdate?.(last);
    if (last.status === 'success') return last;
    if (last.status === 'cancelled') {
      throw new ApiError('task_cancelled', `任务 ${taskId} 已取消（上游状态：${last.rawStatus || 'cancelled'}）`, {
        body: last.raw,
        hint: '任务已停止且不再产生费用；如需重新生成请提交新任务。',
      });
    }
    if (last.status === 'failed') {
      const expired = last.rawStatus?.toLowerCase() === 'expired';
      throw new ApiError('task_failed', expired
        ? `任务 ${taskId} 超过执行期限（expired），费用已自动退还`
        : `任务 ${taskId} 失败（上游状态：${last.rawStatus || 'unknown'}）`, {
        body: last.raw,
        hint: expired
          ? '提交状态未知且超过 10 分钟对账期限的任务会以 expired 终止并退款。可查看 focalapi task status ' + taskId + ' --json 后重新提交。'
          : '运行 focalapi task status ' + taskId + ' --json 查看上游返回详情；若是提示词或参数问题请调整后重试。',
      });
    }
    if (Date.now() > deadline) {
      throw new ApiError('timeout', `任务 ${taskId} 等待超时（${Math.round(timeoutMs / 60000)} 分钟）`, {
        hint: `可运行 focalapi task status ${taskId} --wait 继续等待，或 focalapi task status ${taskId} 查看当前状态。`,
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

/** Extract the task's upstream artifact URL from any response envelope. */
export function extractTaskArtifactURL(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const data = obj.data as Record<string, unknown> | undefined;
  const candidates = [obj.url, data?.url, (data?.data as Record<string, unknown> | undefined)?.url, (data?.data as Record<string, unknown> | undefined)?.video_url];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Download a task artifact from its upstream URL directly (CDN/edge usually
 * beats the cross-border gateway hop), falling back to the gateway proxy.
 * Returns the file path and which channel was used.
 */
export async function downloadTaskArtifact(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  outDir: string,
  opts?: { direct?: boolean; filenameBase?: string },
): Promise<{ file: string; source: 'upstream' | 'proxy' }> {
  let upstreamURL: string | undefined;
  if (opts?.direct) {
    const info = await fetchTask(baseUrl, apiKey, taskId);
    upstreamURL = extractTaskArtifactURL(info.raw);
    if (upstreamURL) {
      try {
        const res = await fetch(upstreamURL, {
          signal: AbortSignal.timeout(600_000),
        });
        if (res.ok && res.body) {
          const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
          const ext = EXT_BY_CONTENT_TYPE[contentType] ?? extFromURL(upstreamURL) ?? '.bin';
          const dir = resolve(outDir);
          await mkdir(dir, { recursive: true });
          const filePath = join(dir, `${opts?.filenameBase ?? `task-${taskId}`}${ext}`);
          await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(filePath));
          return { file: filePath, source: 'upstream' };
        }
      } catch {
        // 落回网关代理：直连失败（链接过期/网络不可达）不阻断下载。
      }
    }
  }
  const file = await downloadTaskContent(baseUrl, apiKey, taskId, outDir, opts?.filenameBase);
  return { file, source: 'proxy' };
}

function extFromURL(url: string): string | undefined {
  const match = /\.(mp4|webm|png|jpe?g|webp|mp3|wav)(?:[?#]|$)/i.exec(url);
  return match ? (match[1]!.toLowerCase() === 'jpeg' ? '.jpg' : `.${match[1]!.toLowerCase()}`) : undefined;
}

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
