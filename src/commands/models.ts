/**
 * focalapi models：模型列表与详情。
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

export interface ModelEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

interface ModelListResponse {
  data?: ModelEntry[];
}

export function registerModels(program: Command): void {
  const models = program.command('models').description('可用模型查询');

  models
    .command('list')
    .description('列出当前 Key 可用的全部模型')
    .option('--filter <keyword>', '按 id 关键字过滤（不区分大小写）')
    .action(async (opts: { filter?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const res = await request<ModelListResponse>({ baseUrl: auth.baseUrl, path: '/v1/models', apiKey: auth.apiKey });
      let list = res.data ?? [];
      if (opts.filter) {
        const kw = opts.filter.toLowerCase();
        list = list.filter((m) => m.id.toLowerCase().includes(kw));
      }
      if (g.json) {
        printJson({ data: list });
      } else {
        printTable(
          ['模型 ID', '提供方'],
          list.map((m) => [m.id, m.owned_by ?? '-']),
        );
      }
    });

  models
    .command('get')
    .description('查看单个模型详情')
    .argument('<model>', '模型 ID')
    .action(async (model: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const res = await request<ModelEntry>({
        baseUrl: auth.baseUrl,
        path: `/v1/models/${encodeURIComponent(model)}`,
        apiKey: auth.apiKey,
      });
      if (g.json) {
        printJson(res);
      } else {
        printTable(
          ['字段', '值'],
          Object.entries(res).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
        );
      }
    });
}
