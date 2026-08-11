/**
 * focalapi models: model listing, search, and details.
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { ApiError } from '../lib/errors.js';
import { request } from '../lib/http.js';
import { printJson, printTable } from '../lib/output.js';
import type { SupportedParameter } from '../lib/model-capabilities.js';
import { parseCreativeCapability, resolveCreativeModel } from '../lib/model-selection.js';
import type { GlobalOpts } from '../cli.js';

export interface ModelEntry {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  supported_endpoint_types?: string[];
  [key: string]: unknown;
}

interface ModelListResponse {
  data?: ModelEntry[];
}

interface ModelErrorResponse {
  error?: { message?: string; code?: string; type?: string };
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
    constraints.push(`${parameter.minimum ?? '-'}–${parameter.maximum ?? '-'}`);
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

function filterModels(models: ModelEntry[], query?: string, endpoint?: string): ModelEntry[] {
  const normalizedQuery = query?.trim().toLowerCase();
  const normalizedEndpoint = endpoint?.trim().toLowerCase();
  return models.filter((model) => {
    if (normalizedQuery && !model.id.toLowerCase().includes(normalizedQuery)) return false;
    return !normalizedEndpoint || (model.supported_endpoint_types ?? []).some((item) => item.toLowerCase() === normalizedEndpoint);
  });
}

function printModelList(models: ModelEntry[], json: boolean): void {
  if (json) {
    printJson({ data: models });
    return;
  }
  printTable(
    ['模型 ID', '提供方', '支持端点'],
    models.map((model) => [model.id, model.owned_by ?? '-', textValue(model.supported_endpoint_types)]),
  );
}

async function fetchModels(g: GlobalOpts): Promise<ModelEntry[]> {
  const auth = resolveAuth(g);
  const response = await request<ModelListResponse>({ baseUrl: auth.baseUrl, path: '/v1/models', apiKey: auth.apiKey });
  return response.data ?? [];
}

export function registerModels(program: Command): void {
  const models = program.command('models').description('可用模型查询');

  models
    .command('resolve')
    .description('为创作任务选择当前 Key 可用的默认模型，并返回完整实时契约')
    .argument('<capability>', '创作能力：image | video')
    .action(async (capability: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const resolved = await resolveCreativeModel(auth, parseCreativeCapability(capability));
      if (g.json) {
        printJson(resolved);
        return;
      }
      printTable(
        ['字段', '值'],
        [
          ['能力', resolved.capability],
          ['模型', resolved.model.id],
          ['提供方', resolved.model.owned_by ?? '-'],
          ['端点', resolved.endpoint_type],
          ['下一步', resolved.next_command],
        ],
      );
      if (Array.isArray(resolved.model.supported_params) && resolved.model.supported_params.length > 0) {
        process.stdout.write('\n实时参数契约\n');
        printTable(
          ['参数', '约束'],
          resolved.model.supported_params.map((parameter) => {
            const item = parameter as SupportedParameter;
            return [item.name, parameterConstraint(item)];
          }),
        );
      }
    });

  models
    .command('list')
    .description('列出当前 Key 可用的全部模型')
    .option('--filter <keyword>', '按 ID 关键字过滤（不区分大小写）')
    .option('--endpoint <type>', '按端点类型过滤，如 image-generation')
    .action(async (opts: { filter?: string; endpoint?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      printModelList(filterModels(await fetchModels(g), opts.filter, opts.endpoint), Boolean(g.json));
    });

  models
    .command('search')
    .description('按关键字搜索当前 Key 可用的模型')
    .argument('<query>', '模型 ID 关键字')
    .option('--endpoint <type>', '按端点类型过滤，如 video-generation')
    .action(async (query: string, opts: { endpoint?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      printModelList(filterModels(await fetchModels(g), query, opts.endpoint), Boolean(g.json));
    });

  models
    .command('get')
    .description('查看单个模型详情与实时参数契约')
    .argument('<model>', '模型 ID')
    .action(async (model: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const response = await request<ModelEntry & ModelErrorResponse>({
        baseUrl: auth.baseUrl,
        path: `/v1/models/${encodeURIComponent(model)}`,
        apiKey: auth.apiKey,
      });
      if (response.error) {
        throw new ApiError(
          'invalid_request',
          response.error.message ?? `模型 ${model} 不可用`,
          { hint: '运行 focalapi models list --json，使用列表中的模型 ID。' },
        );
      }
      if (!response.id) {
        throw new ApiError('bad_response', `模型 ${model} 的契约响应缺少 id`, { body: response });
      }
      if (g.json) {
        printJson(response);
      } else {
        printModelDetails(response);
      }
    });
}
