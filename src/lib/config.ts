/**
 * 配置存储：~/.focalapi/config.json（权限 600）。
 *
 * 优先级：命令行 flag > 环境变量（FOCALAPI_API_KEY / FOCALAPI_BASE_URL）> 当前 profile > 默认值。
 * FOCALAPI_CONFIG_DIR 可覆盖配置目录（测试与沙箱场景使用）。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from './errors.js';

export const DEFAULT_BASE_URL = 'https://api.focalapi.com';

export interface Profile {
  apiKey?: string;
  baseUrl?: string;
}

export interface CliConfig {
  currentProfile: string;
  profiles: Record<string, Profile>;
}

export const DEFAULT_PROFILE = 'default';

/**
 * 把 git-bash/MSYS 风格路径（/c/Users/...）规范化为 Windows 原生路径（C:\Users\...）。
 * Windows 的 Node 不识别 MSYS 路径；其他平台原样返回。
 */
export function normalizeHomePath(p: string): string {
  if (process.platform === 'win32') {
    const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
    if (m) {
      return `${m[1]!.toUpperCase()}:\\${m[2]!.replace(/\//g, '\\')}`;
    }
  }
  return p;
}

export function configDir(): string {
  const dir = process.env.FOCALAPI_CONFIG_DIR ?? join(homedir(), '.focalapi');
  return normalizeHomePath(dir);
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export function loadConfig(): CliConfig {
  const path = configPath();
  if (!existsSync(path)) {
    return { currentProfile: DEFAULT_PROFILE, profiles: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CliConfig>;
    return {
      currentProfile: raw.currentProfile ?? DEFAULT_PROFILE,
      profiles: raw.profiles ?? {},
    };
  } catch {
    throw new ApiError('config_corrupted', `配置文件损坏：${path}`, {
      hint: '修复或删除该文件后重新运行 focalapi auth login。',
    });
  }
}

export function saveConfig(config: CliConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const path = configPath();
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows 上 chmod 可能无效，忽略。
  }
}

export function getProfile(name?: string): Profile {
  const config = loadConfig();
  const profileName = name ?? config.currentProfile;
  return config.profiles[profileName] ?? {};
}

export function setProfile(name: string, patch: Profile): CliConfig {
  const config = loadConfig();
  config.profiles[name] = { ...config.profiles[name], ...patch };
  config.currentProfile = name;
  saveConfig(config);
  return config;
}

export function clearProfile(name: string): CliConfig {
  const config = loadConfig();
  delete config.profiles[name];
  if (config.currentProfile === name) {
    config.currentProfile = DEFAULT_PROFILE;
  }
  saveConfig(config);
  return config;
}

export interface ResolvedAuth {
  apiKey: string;
  baseUrl: string;
  /** key 来源，用于 doctor 诊断展示。 */
  keySource: 'flag' | 'env' | 'config';
}

export function resolveBaseUrl(explicit?: string, profileName?: string): string {
  const fromEnv = process.env.FOCALAPI_BASE_URL;
  const fromProfile = getProfile(profileName).baseUrl;
  return (explicit ?? fromEnv ?? fromProfile ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function resolveAuth(opts?: { key?: string; baseUrl?: string; profile?: string }): ResolvedAuth {
  const baseUrl = resolveBaseUrl(opts?.baseUrl, opts?.profile);
  if (opts?.key) {
    return { apiKey: opts.key, baseUrl, keySource: 'flag' };
  }
  const fromEnv = process.env.FOCALAPI_API_KEY;
  if (fromEnv) {
    return { apiKey: fromEnv, baseUrl, keySource: 'env' };
  }
  const fromProfile = getProfile(opts?.profile).apiKey;
  if (fromProfile) {
    return { apiKey: fromProfile, baseUrl, keySource: 'config' };
  }
  throw new ApiError('missing_api_key', '未找到 API Key', {
    hint: '运行 focalapi auth login --key <sk-...>，或设置环境变量 FOCALAPI_API_KEY。Key 在 https://focalapi.com/console/token 创建。',
  });
}
