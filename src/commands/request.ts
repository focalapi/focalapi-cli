/**
 * focalapi request：未被高阶命令覆盖时使用的只读 API 逃生入口。
 *
 * 仅允许 GET / HEAD，避免把原始命令误当成隐藏写入接口。常用能力应优先
 * 使用 models、chat、gen 等语义化命令；此命令用于发现或读取新端点。
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { ApiError } from '../lib/errors.js';
import { rawRequest } from '../lib/http.js';
import { printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

type ReadMethod = 'GET' | 'HEAD';

function normalizeReadPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ApiError('invalid_request', '请求路径必须是以 / 开头的站内路径，例如 /v1/models');
  }

  const parsed = new URL(path, 'https://focalapi.invalid');
  if (parsed.origin !== 'https://focalapi.invalid') {
    throw new ApiError('invalid_request', '请求路径不能包含外部域名');
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function registerRequest(program: Command): void {
  program
    .command('request')
    .description('原始只读 API 请求（仅 GET/HEAD；用于尚未封装的端点）')
    .argument('<method>', 'HTTP 方法：GET 或 HEAD')
    .argument('<path>', '站内 API 路径，例如 /v1/models')
    .action(async (methodArg: string, pathArg: string, _opts: unknown, cmd: Command) => {
      const method = methodArg.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        throw new ApiError('invalid_request', 'request 仅允许 GET 或 HEAD；写操作请使用明确的高阶命令');
      }

      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const path = normalizeReadPath(pathArg);
      const res = await rawRequest({
        baseUrl: auth.baseUrl,
        path,
        method: method as ReadMethod,
        apiKey: auth.apiKey,
      });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      // 原始请求需要稳定机器可读信封；语义化命令仍维持各自的上游直通形状。
      printJson({
        method,
        path,
        status: res.status,
        content_type: res.headers.get('content-type') ?? null,
        data,
      });
    });
}
