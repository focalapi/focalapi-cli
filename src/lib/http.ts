/**
 * HTTP layer and the only exit point for FocalAPI REST calls.
 *
 * - Supports JSON requests/responses, FormData uploads, binary downloads, and SSE streams.
 * - Normalizes every non-2xx response to ApiError; refineErrorCode determines the code.
 * - Accepts both new-api error shapes: {error:{message,type}} and {success:false,message}.
 */

import { ApiError, refineErrorCode } from './errors.js';

export interface RequestOptions {
  baseUrl: string;
  path: string;
  method?: string;
  apiKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body. Mutually exclusive with formData. */
  body?: unknown;
  /** Multipart form. Mutually exclusive with body. */
  formData?: FormData;
  headers?: Record<string, string>;
  /** Defaults to 60 seconds; callers extend it for long-running work such as video generation. */
  timeoutMs?: number;
  /** Only FocalAPI token-validation endpoints may classify 401/403 as an invalid FocalAPI key. */
  authFailureIsInvalidApiKey?: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Extract an error message from any supported new-api response shape. */
function extractErrorMessage(raw: string): { message: string; body?: unknown; upstreamCode?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { message: raw.slice(0, 500) || '未知错误', body: undefined };
  }
  const obj = parsed as Record<string, unknown>;
  const errObj = obj?.error as Record<string, unknown> | undefined;
  const message =
    (typeof errObj?.message === 'string' && errObj.message) ||
    (typeof obj?.message === 'string' && obj.message) ||
    JSON.stringify(parsed).slice(0, 500);
  const upstreamCode = [errObj?.code, errObj?.type, obj?.code, obj?.type].find((value) => typeof value === 'string');
  return { message, body: parsed, upstreamCode: typeof upstreamCode === 'string' ? upstreamCode : undefined };
}

export async function request<T = unknown>(opts: RequestOptions): Promise<T> {
  const res = await rawRequest(opts);
  const text = await res.text();
  if (text.length === 0) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('bad_response', `响应不是合法 JSON：${text.slice(0, 200)}`, {
      status: res.status,
    });
  }
}

/** Return the raw Response for streaming or binary consumers while preserving error normalization. */
export async function rawRequest(opts: RequestOptions): Promise<Response> {
  const url = buildUrl(opts.baseUrl, opts.path, opts.query);
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  let payload: string | FormData | undefined;
  if (opts.formData) {
    payload = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (payload !== undefined ? 'POST' : 'GET'),
      headers,
      body: payload,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as Error)?.name ?? '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError('timeout', `请求超时（${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）：${url}`, {
        hint: '稍后重试，或运行 focalapi doctor 检查链路质量。',
      });
    }
    throw new ApiError('network_error', `网络请求失败：${(err as Error)?.message ?? err}`, {
      hint: '检查网络代理与 FOCALAPI_BASE_URL 配置；可运行 focalapi doctor 做链路诊断。',
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const { message, body, upstreamCode } = extractErrorMessage(text);
    let code = refineErrorCode(res.status, message, { authFailureIsInvalidApiKey: opts.authFailureIsInvalidApiKey });
    // The bounded queue admission signal (HTTP 503 capacity_exhausted + Retry-After)
    // is retryable as-is; it must not surface as a generic server_error.
    if (upstreamCode === 'capacity_exhausted' || (res.status === 503 && /capacity/i.test(message))) {
      code = 'capacity_exhausted';
    }
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id') ?? res.headers.get('x-requestid') ?? undefined;
    throw new ApiError(code, message, { status: res.status, body, upstreamCode, requestId });
  }
  return res;
}

/**
 * Read data payloads from an SSE stream one event at a time.
 * Stop at `data: [DONE]` without yielding it. The caller is responsible for JSON.parse.
 */
export async function* sseEvents(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    throw new ApiError('bad_response', '流式响应缺少 body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        if (data) yield data;
      }
    }
    // Flush the tail because a server may omit the final blank line.
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const data = tail.slice(5).trim();
      if (data && data !== '[DONE]') yield data;
    }
  } finally {
    reader.releaseLock();
  }
}
