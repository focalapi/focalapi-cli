/**
 * focalapi rerank：文档重排序（/v1/rerank）。
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

interface RerankResponse {
  results?: { index?: number; relevance_score?: number; document?: string | { text?: string } }[];
}

export function registerRerank(program: Command): void {
  program
    .command('rerank')
    .description('按查询对文档重排序（/v1/rerank）')
    .requiredOption('-m, --model <model>', 'rerank 模型 ID')
    .requiredOption('--query <text>', '查询')
    .requiredOption('--docs <json|@file>', '文档数组（JSON 字符串或 @file.json）')
    .option('--top-n <n>', '只返回前 N 条', (v) => Number.parseInt(v, 10))
    .action(async (opts: { model: string; query: string; docs: string; topN?: number }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);

      const text = opts.docs.startsWith('@') ? readFileSync(opts.docs.slice(1), 'utf-8') : opts.docs;
      let documents: unknown;
      try {
        documents = JSON.parse(text);
      } catch {
        throw new ApiError('invalid_request', '--docs 不是合法 JSON 数组');
      }
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new ApiError('invalid_request', '--docs 必须是非空 JSON 数组');
      }

      const body: Record<string, unknown> = { model: opts.model, query: opts.query, documents };
      if (opts.topN !== undefined) body.top_n = opts.topN;

      const res = await request<RerankResponse>({
        baseUrl: auth.baseUrl,
        path: '/v1/rerank',
        apiKey: auth.apiKey,
        body,
        timeoutMs: 120_000,
      });
      if (g.json) {
        printJson(res);
        return;
      }
      const rows = (res.results ?? []).map((r) => {
        const doc = typeof r.document === 'string' ? r.document : r.document?.text ?? '';
        return [String(r.index ?? '-'), String(r.relevance_score ?? '-'), doc.slice(0, 60)];
      });
      printTable(['原文档序号', '相关度', '文档预览'], rows);
    });
}
