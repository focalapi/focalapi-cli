/**
 * focalapi models：模型列表与详情。
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { SupportedParameter } from '../lib/model-capabilities.js';
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

function textValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (Array.isArray(value)) return value.length === 0 ? '-' : value.map(textValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parameterConstraint(parameter: SupportedParameter): string {
  const constraints: string[] = [];
  if (parameter.required) constraints.push('必填');
  if (parameter.default !== undefined) constraints.push(`默认 ${String(parameter.default)}`);
  if (parameter.values?.length) constraints.push(`可选 ${parameter.values.join(' / ')}`);
  if (parameter.minimum !== undefined || parameter.maximum !== undefined) {
    constraints.push(`${parameter.minimum ?? '-∞'}–${parameter.maximum ?? '∞'}`);
  }
  return [parameter.type, ...constraints, parameter.description].join('；');
}

function printModelDetails(model: ModelEntry): void {
  const { supported_params: supportedParams, ...summary } = model;
  printTable(
    ['字段', '值'],
    Object.entries(summary).map(([key, value]) => [key, textValue(value)]),
  );
  if (Array.isArray(supportedParams) && supportedParams.length > 0) {
    process.stdout.write('\n支持参数\n');
    printTable(
      ['参数', '约束'],
      supportedParams.map((parameter) => {
        const item = parameter as SupportedParameter;
        return [item.name, parameterConstraint(item)];
      }),
    );
  }
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
          ['模型 ID', '提供方', '支持端点'],
          list.map((m) => [m.id, m.owned_by ?? '-', textValue(m.supported_endpoint_types)]),
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
        printModelDetails(res);
      }
    });
}
