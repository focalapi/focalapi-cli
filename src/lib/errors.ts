/**
 * focalapi-cli error model.
 *
 * Every user- or Agent-facing error is normalized to ApiError: { code, message, hint }.
 * code is stable and machine-readable; hint explains the next action for a human.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly hint?: string;
  /** Stable upstream error code or type, without sensitive request data such as keys. */
  readonly upstreamCode?: string;
  /** Request ID that the service operator can use to correlate logs. */
  readonly requestId?: string;
  /** Truncated raw upstream response for debugging only; redact it before printing. */
  readonly body?: unknown;

  constructor(
    code: string,
    message: string,
    opts?: { status?: number; hint?: string; body?: unknown; upstreamCode?: string; requestId?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts?.status;
    this.hint = opts?.hint;
    this.body = opts?.body;
    this.upstreamCode = opts?.upstreamCode;
    this.requestId = opts?.requestId;
  }

  toJSON(): { error: { code: string; message: string; hint?: string; status?: number; upstream_code?: string; request_id?: string } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.status !== undefined ? { status: this.status } : {}),
        ...(this.upstreamCode ? { upstream_code: this.upstreamCode } : {}),
        ...(this.requestId ? { request_id: this.requestId } : {}),
      },
    };
  }
}

export const ERROR_HINTS: Record<string, string> = {
  missing_api_key:
    '未配置 API Key。运行 focalapi auth login --key <sk-...>，或设置环境变量 FOCALAPI_API_KEY。',
  invalid_api_key:
    'API Key 无效、已过期或被删除。前往 https://focalapi.com/console/token 检查或新建 Key，然后重新 focalapi auth login。',
  insufficient_quota:
    '账户额度不足。前往 https://focalapi.com/console/topup 充值；可运行 focalapi usage 查看当前额度。',
  rate_limited: '请求触发限流，请稍后重试。',
  capacity_exhausted:
    '平台创作容量已满（排队准入达到上限，HTTP 503）。服务端建议约 10 秒后重试：直接重跑同一条命令即可，无需修改参数或更换模型。',
  model_not_found: '模型不存在或未对你的 Key 开放。运行 focalapi models list 查看可用模型。',
  network_error:
    '无法连接 focalapi 服务。检查网络代理与 FOCALAPI_BASE_URL 配置；可运行 focalapi doctor 做链路诊断。',
  timeout: '请求超时。稍后重试，或运行 focalapi doctor 检查链路质量。',
  server_error: 'focalapi 服务端错误，请稍后重试。若持续出现，请携带错误信息反馈给服务方。',
  invalid_request: '请求参数有误，请检查命令参数。',
  authentication_failed: '鉴权失败。先运行 focalapi auth status 验证本站 Key；若本站 Key 有效，则请将请求 ID 提供给服务方排查渠道权限。',
  upstream_auth_failed: '上游渠道鉴权失败，并不表示你的 FocalAPI Key 无效。先运行 focalapi auth status；若通过，请将请求 ID 提供给服务方排查渠道配置。',
};

/** Refine an error code from response keywords while tolerating inconsistent new-api shapes. */
export function refineErrorCode(status: number, message: string, opts?: { authFailureIsInvalidApiKey?: boolean }): string {
  const m = message.toLowerCase();
  if (m.includes('quota') || m.includes('额度') || m.includes('insufficient')) {
    return 'insufficient_quota';
  }
  if (m.includes('model') && (m.includes('not') || m.includes('不存在') || m.includes('无'))) {
    return 'model_not_found';
  }
  if (m.includes('key') || m.includes('token') || m.includes('auth')) {
    if (status === 401 || status === 403) {
      return opts?.authFailureIsInvalidApiKey ? 'invalid_api_key' : 'upstream_auth_failed';
    }
    return 'invalid_request';
  }
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
    case 403:
      return opts?.authFailureIsInvalidApiKey ? 'invalid_api_key' : 'authentication_failed';
    case 404:
      return 'model_not_found';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'invalid_request';
  }
}
