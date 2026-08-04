/**
 * focalapi search：联网搜索（/v1/alpha/search）。
 *
 * 该端点是 alpha 级透传接口（Codex 独立搜索格式），响应结构由上游定义，
 * pretty 模式做尽力解析，--json 原样透传。
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

/** 尽力从上游响应中提取结果条目 [{title, url, snippet?}]。 */
function extractResults(raw: unknown): { title: string; url: string; snippet?: string }[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.results, obj.data, obj.items, obj.output];
  for (const c of candidates) {
    if (!Array.isArray(c)) continue;
    const out: { title: string; url: string; snippet?: string }[] = [];
    for (const item of c) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const url = typeof it.url === 'string' ? it.url : typeof it.link === 'string' ? it.link : '';
      const title = typeof it.title === 'string' ? it.title : url;
      const snippet = typeof it.snippet === 'string' ? it.snippet : typeof it.content === 'string' ? it.content.slice(0, 200) : undefined;
      if (url || title) out.push({ title, url, ...(snippet ? { snippet } : {}) });
    }
    if (out.length > 0) return out;
  }
  return [];
}

export function registerSearch(program: Command): void {
  program
    .command('search')
    .description('联网搜索（/v1/alpha/search，alpha 级接口）')
    .argument('<query...>', '搜索内容')
    .requiredOption('-m, --model <model>', '搜索模型 ID（focalapi models list --filter search 查看）')
    .option('--raw <json|@file>', '完整自定义请求体（JSON 字符串或 @文件），与 query 合并')
    .action(async (queryParts: string[], opts: { model: string; raw?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);

      let body: Record<string, unknown> = { model: opts.model, query: queryParts.join(' ') };
      if (opts.raw) {
        const text = opts.raw.startsWith('@') ? readFileSync(opts.raw.slice(1), 'utf-8') : opts.raw;
        try {
          body = { ...JSON.parse(text), model: opts.model };
        } catch {
          throw new ApiError('invalid_request', '--raw 不是合法 JSON');
        }
      }

      const res = await request<unknown>({
        baseUrl: auth.baseUrl,
        path: '/v1/alpha/search',
        apiKey: auth.apiKey,
        body,
        timeoutMs: 120_000,
      });

      if (g.json) {
        printJson(res);
        return;
      }
      const results = extractResults(res);
      if (results.length === 0) {
        // 解析不出结构化结果时原样输出，不丢信息
        printJson(res);
        return;
      }
      printTable(
        ['#', '标题', '链接'],
        results.map((r, i) => [String(i + 1), r.title.slice(0, 60), r.url]),
      );
    });
}
