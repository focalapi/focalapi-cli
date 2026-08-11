/**
 * focalapi auth: sign in by validating and saving a key, inspect status, and sign out.
 *
 * Validation uses GET /api/usage/token/ through read-only TokenAuthReadOnly middleware.
 */

import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import {
  clearProfile,
  getProfile,
  loadConfig,
  resolveAuth,
  resolveBaseUrl,
  saveConfig,
  DEFAULT_PROFILE,
} from '../lib/config.js';
import { request } from '../lib/http.js';
import { info, isInteractive, maskKey, printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

export interface TokenUsage {
  object: string;
  name: string;
  total_granted: number;
  total_used: number;
  total_available: number;
  unlimited_quota: boolean;
  model_limits?: Record<string, unknown>;
  model_limits_enabled?: boolean;
  expires_at: number;
}

interface TokenUsageResponse {
  code?: boolean;
  message?: string;
  data?: TokenUsage;
}

export async function fetchTokenUsage(baseUrl: string, apiKey: string): Promise<TokenUsage> {
  const res = await request<TokenUsageResponse>({
    baseUrl,
    path: '/api/usage/token/',
    apiKey,
    timeoutMs: 15_000,
    authFailureIsInvalidApiKey: true,
  });
  if (!res.data) {
    throw new ApiError('bad_response', '用量接口响应缺少 data 字段');
  }
  return res.data;
}

async function promptForKey(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question('请粘贴 API Key（sk-...）：');
    return answer.trim();
  } finally {
    rl.close();
  }
}

export function registerAuth(program: Command): void {
  const auth = program.command('auth').description('API Key 登录与状态');

  auth
    .command('login')
    .description('验证并保存 API Key（Key 在 https://focalapi.com/console/token 创建）')
    .option('--key <key>', 'API Key（sk-...）；不传且为终端环境时进入交互粘贴')
    .action(async (opts: { key?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts & { key?: string };
      let key = opts.key ?? g.key ?? process.env.FOCALAPI_API_KEY;
      if (!key) {
        if (!isInteractive()) {
          throw new ApiError('missing_api_key', '非交互环境必须通过 --key 或 FOCALAPI_API_KEY 提供 Key', {
            hint: 'focalapi auth login --key <sk-...>',
          });
        }
        info(`控制台令牌页：https://focalapi.com/console/token`);
        key = await promptForKey();
      }
      if (!key.startsWith('sk-')) {
        throw new ApiError('invalid_request', 'Key 格式不正确：应以 sk- 开头');
      }
      const baseUrl = resolveBaseUrl(g.baseUrl, g.profile);
      const usage = await fetchTokenUsage(baseUrl, key);
      const profileName = g.profile ?? loadConfig().currentProfile ?? DEFAULT_PROFILE;
      const config = loadConfig();
      config.profiles[profileName] = {
        ...config.profiles[profileName],
        apiKey: key,
        baseUrl: g.baseUrl ?? process.env.FOCALAPI_BASE_URL ?? config.profiles[profileName]?.baseUrl,
      };
      config.currentProfile = profileName;
      saveConfig(config);

      if (g.json) {
        printJson({
          success: true,
          profile: profileName,
          baseUrl,
          key: maskKey(key),
          token: usage,
        });
      } else {
        info(`✓ 登录成功（profile: ${profileName}）`);
        info(`  Key：${maskKey(key)}`);
        info(`  令牌名：${usage.name}`);
        info(`  剩余额度：${usage.unlimited_quota ? '无限' : usage.total_available}`);
        info(`  API 地址：${baseUrl}`);
        info(`接下来可运行：focalapi doctor 做端到端自检（使用免费演练模型，不消耗额度）`);
      }
    });

  auth
    .command('status')
    .description('查看当前 Key 的有效性、额度与来源')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const usage = await fetchTokenUsage(auth.baseUrl, auth.apiKey);
      if (g.json) {
        printJson({
          valid: true,
          key: maskKey(auth.apiKey),
          keySource: auth.keySource,
          baseUrl: auth.baseUrl,
          token: usage,
        });
      } else {
        printTable(
          ['项目', '值'],
          [
            ['Key', maskKey(auth.apiKey)],
            ['来源', auth.keySource],
            ['API 地址', auth.baseUrl],
            ['令牌名', usage.name],
            ['剩余额度', usage.unlimited_quota ? '无限' : String(usage.total_available)],
            ['已用额度', String(usage.total_used)],
            ['过期时间', usage.expires_at > 0 ? new Date(usage.expires_at * 1000).toLocaleString() : '永不过期'],
          ],
        );
      }
    });

  auth
    .command('logout')
    .description('删除本地保存的 API Key')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const profileName = g.profile ?? loadConfig().currentProfile ?? DEFAULT_PROFILE;
      const profile = getProfile(profileName);
      clearProfile(profileName);
      if (g.json) {
        printJson({ success: true, profile: profileName, hadKey: Boolean(profile.apiKey) });
      } else {
        info(profile.apiKey ? `✓ 已删除 profile「${profileName}」的本地 Key` : `profile「${profileName}」本就没有保存 Key`);
      }
    });
}
