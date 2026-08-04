/**
 * focalapi-cli 错误模型。
 *
 * 所有面向用户/Agent 的错误统一为 ApiError：{ code, message, hint }。
 * code 稳定可机读，hint 告诉下一步怎么办（人读）。
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly hint?: string;
  /** 上游原始响应体（已截断），仅调试用途，打印前需脱敏。 */
  readonly body?: unknown;

  constructor(
    code: string,
    message: string,
    opts?: { status?: number; hint?: string; body?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts?.status;
    this.hint = opts?.hint;
    this.body = opts?.body;
  }

  toJSON(): { error: { code: string; message: string; hint?: string; status?: number } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.status !== undefined ? { status: this.status } : {}),
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
  model_not_found: '模型不存在或未对你的 Key 开放。运行 focalapi models list 查看可用模型。',
  network_error:
    '无法连接 focalapi 服务。检查网络代理与 FOCALAPI_BASE_URL 配置；可运行 focalapi doctor 做链路诊断。',
  timeout: '请求超时。稍后重试，或运行 focalapi doctor 检查链路质量。',
  server_error: 'focalapi 服务端错误，请稍后重试。若持续出现，请携带错误信息反馈给服务方。',
  invalid_request: '请求参数有误，请检查命令参数。',
};

/** 根据错误体里的关键字细化错误码（new-api 的错误体结构不统一，做宽容解析）。 */
export function refineErrorCode(status: number, message: string): string {
  const m = message.toLowerCase();
  if (m.includes('quota') || m.includes('额度') || m.includes('insufficient')) {
    return 'insufficient_quota';
  }
  if (m.includes('model') && (m.includes('not') || m.includes('不存在') || m.includes('无'))) {
    return 'model_not_found';
  }
  if (m.includes('key') || m.includes('token') || m.includes('auth')) {
    return status === 401 || status === 403 ? 'invalid_api_key' : 'invalid_request';
  }
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
    case 403:
      return 'invalid_api_key';
    case 404:
      return 'model_not_found';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server_error' : 'invalid_request';
  }
}
