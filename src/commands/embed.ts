/**
 * focalapi embed：文本向量化（/v1/embeddings）。
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { readInputFile, readStdin } from '../lib/fileinput.js';
import { info, printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[];
  usage?: { total_tokens?: number };
}

export function registerEmbed(program: Command): void {
  program
    .command('embed')
    .description('文本向量化（/v1/embeddings）')
    .argument('[text...]', '文本；省略且 stdin 为管道时从 stdin 读取')
    .requiredOption('-m, --model <model>', '向量模型 ID')
    .option('--input <file>', '从文件读取文本（@ 前缀可选）')
    .action(async (textParts: string[], opts: { model: string; input?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);

      let text = textParts.join(' ').trim();
      if (opts.input) {
        text = readInputFile(opts.input.replace(/^@/, '')).data.toString('utf-8');
      } else if (!text && !process.stdin.isTTY) {
        text = await readStdin();
      }
      if (!text) {
        throw new ApiError('invalid_request', '缺少待向量化文本', {
          hint: 'focalapi embed "文本" -m <model>，或 focalapi embed -m <model> --input @file.txt。',
        });
      }

      const res = await request<EmbeddingResponse>({
        baseUrl: auth.baseUrl,
        path: '/v1/embeddings',
        apiKey: auth.apiKey,
        body: { model: opts.model, input: text },
        timeoutMs: 120_000,
      });
      if (g.json) {
        printJson(res);
      } else {
        const vec = res.data?.[0]?.embedding ?? [];
        info(`维度：${vec.length}；tokens：${res.usage?.total_tokens ?? '-'}`);
        info('完整向量请用 --json 输出。');
      }
    });
}
