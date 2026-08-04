/**
 * 测试基础设施：临时配置目录、fetch 路由 mock、stdout/stderr 捕获。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

export interface TestCtx {
  configDir: string;
  homeDir: string;
  stdout: () => string;
  stderr: () => string;
  takeStdout: () => string;
  takeStderr: () => string;
}

type FetchHandler = (init?: RequestInit) => unknown | Response;

/** 按 URL 子串路由的 fetch mock；handler 返回对象自动包成 200 JSON Response。 */
export function mockFetchRouter(routes: Record<string, FetchHandler>) {
  return vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        const out = handler(init);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: { message: `not mocked: ${url}` } }), { status: 500 });
  });
}

export const VALID_KEY = 'sk-testkey1234567890abcdef';

export const TOKEN_USAGE_OK = {
  code: true,
  message: 'ok',
  data: {
    object: 'token_usage',
    name: 'test-token',
    total_granted: 1000000,
    total_used: 250000,
    total_available: 750000,
    unlimited_quota: false,
    model_limits: {},
    model_limits_enabled: false,
    expires_at: 0,
  },
};

export function setupTestEnv(): TestCtx {
  let configDir = '';
  let homeDir = '';
  let outBuf = '';
  let errBuf = '';
  let outSpy: { mockRestore: () => void };
  let errSpy: { mockRestore: () => void };

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'focalapi-cfg-'));
    homeDir = mkdtempSync(join(tmpdir(), 'focalapi-home-'));
    process.env.FOCALAPI_CONFIG_DIR = configDir;
    process.env.FOCALAPI_HOME = homeDir;
    delete process.env.FOCALAPI_API_KEY;
    delete process.env.FOCALAPI_BASE_URL;
    delete process.env.FOCALAPI_MODEL;
    process.exitCode = 0;
    outBuf = '';
    errBuf = '';
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      outBuf += String(chunk);
      return true;
    }) as typeof process.stdout.write);
    errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      errBuf += String(chunk);
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    vi.unstubAllGlobals();
    rmSync(configDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  return {
    get configDir() {
      return configDir;
    },
    get homeDir() {
      return homeDir;
    },
    stdout: () => outBuf,
    stderr: () => errBuf,
    /** 读取并清空 stdout 缓冲（同一用例内多次调用 main 时使用）。 */
    takeStdout: (): string => {
      const s = outBuf;
      outBuf = '';
      return s;
    },
    takeStderr: (): string => {
      const s = errBuf;
      errBuf = '';
      return s;
    },
  };
}
