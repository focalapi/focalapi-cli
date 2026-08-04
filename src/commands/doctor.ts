/**
 * focalapi doctor：只读链路诊断。
 *
 * 检查链（任一失败即给出修复提示，整体退出码非零）：
 *   1. Key 解析（flag/env/config 来源）
 *   2. 网络+鉴权：GET /v1/models
 *   3. 端到端推理：focal-rehearsal-chat 免费演练模型最小对话
 *   4. 额度：GET /api/usage/token/
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { maskKey, printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';
import { fetchTokenUsage } from './auth.js';

const REHEARSAL_MODEL = 'focal-rehearsal-chat';
const CHECK_TIMEOUT_MS = 15_000;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

async function runCheck(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (err) {
    if (err instanceof ApiError) {
      return { name, ok: false, detail: `[${err.code}] ${err.message}`, hint: err.hint };
    }
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('只读诊断：网络、鉴权、演练模型端到端、额度（不修改任何资源）')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const results: CheckResult[] = [];

      // 1. Key 解析
      let auth: ReturnType<typeof resolveAuth> | undefined;
      results.push(
        await runCheck('API Key 解析', async () => {
          auth = resolveAuth(g);
          return `${maskKey(auth.apiKey)}（来源：${auth.keySource}）`;
        }),
      );

      // 2. 网络 + 鉴权
      if (auth) {
        const a = auth;
        results.push(
          await runCheck('网络与鉴权（GET /v1/models）', async () => {
            const res = await request<{ data?: unknown[] }>({
              baseUrl: a.baseUrl,
              path: '/v1/models',
              apiKey: a.apiKey,
              timeoutMs: CHECK_TIMEOUT_MS,
            });
            return `${a.baseUrl} 可达，${res.data?.length ?? 0} 个可用模型`;
          }),
        );

        // 3. 演练模型端到端
        results.push(
          await runCheck(`端到端推理（${REHEARSAL_MODEL}，免费演练模型）`, async () => {
            const res = await request<{ choices?: { message?: { content?: unknown } }[] }>({
              baseUrl: a.baseUrl,
              path: '/v1/chat/completions',
              apiKey: a.apiKey,
              body: { model: REHEARSAL_MODEL, messages: [{ role: 'user', content: 'ping' }] },
              timeoutMs: CHECK_TIMEOUT_MS,
            });
            const ok = (res.choices?.length ?? 0) > 0;
            if (!ok) throw new ApiError('bad_response', '演练模型响应缺少 choices');
            return '演练模型往返成功';
          }),
        );

        // 4. 额度
        results.push(
          await runCheck('额度（GET /api/usage/token/）', async () => {
            const usage = await fetchTokenUsage(a.baseUrl, a.apiKey);
            const quota = usage.unlimited_quota ? '无限' : `剩余 ${usage.total_available}`;
            const expiry = usage.expires_at > 0 ? `，${new Date(usage.expires_at * 1000).toLocaleDateString()} 过期` : '';
            return `${quota}${expiry}`;
          }),
        );
      }

      const allOk = results.every((r) => r.ok);
      if (g.json) {
        printJson({ ok: allOk, checks: results });
      } else {
        printTable(
          ['检查项', '结果', '详情'],
          results.map((r) => [r.name, r.ok ? '✓' : '✗', r.detail + (r.hint ? `\n  提示：${r.hint}` : '')]),
        );
      }
      if (!allOk) {
        process.exitCode = 1;
      }
    });
}
