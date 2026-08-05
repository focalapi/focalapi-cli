/**
 * focalapi usage：令牌额度与账单用量。
 *
 * 数据源（均已核实 sk- key 可达）：
 *   - GET /api/usage/token/                令牌额度（TokenAuthReadOnly）
 *   - GET /v1/dashboard/billing/usage      周期用量（dashboard router 挂 TokenAuth）
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';
import { fetchTokenUsage } from './auth.js';

function formatBillingUsage(billing: Record<string, unknown>): string {
  const value = billing.total_usage;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  }
  if (typeof value === 'string' && value.trim() !== '') return value;
  return '-';
}

function defaultStartDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function registerUsage(program: Command): void {
  program
    .command('usage')
    .description('查看当前 Key 的额度与周期用量')
    .option('--start <date>', '用量统计起始日（YYYY-MM-DD，默认当月 1 日）')
    .option('--end <date>', '用量统计截止日（YYYY-MM-DD，默认今天）')
    .action(async (opts: { start?: string; end?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);

      const token = await fetchTokenUsage(auth.baseUrl, auth.apiKey);
      const start = opts.start ?? defaultStartDate();
      const end = opts.end ?? todayDate();
      const billing = await request<Record<string, unknown>>({
        baseUrl: auth.baseUrl,
        path: '/v1/dashboard/billing/usage',
        query: { start_date: start, end_date: end },
        apiKey: auth.apiKey,
      });

      if (g.json) {
        printJson({ token, period: { start, end }, billing });
        return;
      }
      printTable(
        ['项目', '值'],
        [
          ['令牌名', token.name],
          ['总额度', token.unlimited_quota ? '无限' : String(token.total_granted)],
          ['已用', String(token.total_used)],
          ['剩余', token.unlimited_quota ? '无限' : String(token.total_available)],
          ['过期时间', token.expires_at > 0 ? new Date(token.expires_at * 1000).toLocaleString() : '永不过期'],
          [`周期用量（${start} ~ ${end}）`, formatBillingUsage(billing)],
          ['账单对象', typeof billing.object === 'string' ? billing.object : '-'],
        ],
      );
    });
}
