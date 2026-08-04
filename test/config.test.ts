import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearProfile,
  configPath,
  loadConfig,
  resolveAuth,
  resolveBaseUrl,
  setProfile,
  DEFAULT_BASE_URL,
} from '../src/lib/config.js';
import { setupTestEnv, VALID_KEY } from './helpers.js';

setupTestEnv();

describe('config 存取', () => {
  it('缺文件时返回空配置', () => {
    const cfg = loadConfig();
    expect(cfg.profiles).toEqual({});
  });

  it('setProfile 写入并可读回；文件权限/内容正确', () => {
    setProfile('default', { apiKey: VALID_KEY, baseUrl: 'https://api.example.com' });
    expect(existsSync(configPath())).toBe(true);
    const raw = JSON.parse(readFileSync(configPath(), 'utf-8'));
    expect(raw.profiles.default.apiKey).toBe(VALID_KEY);
    expect(raw.currentProfile).toBe('default');
    expect(loadConfig().profiles.default?.baseUrl).toBe('https://api.example.com');
  });

  it('clearProfile 删除档案并回退 currentProfile', () => {
    setProfile('work', { apiKey: VALID_KEY });
    clearProfile('work');
    const cfg = loadConfig();
    expect(cfg.profiles.work).toBeUndefined();
    expect(cfg.currentProfile).toBe('default');
  });
});

describe('认证解析优先级', () => {
  it('flag > env > config > 报错', () => {
    setProfile('default', { apiKey: 'sk-configkey00000000', baseUrl: 'https://cfg.example.com' });
    process.env.FOCALAPI_API_KEY = 'sk-envkey00000000';

    expect(resolveAuth({ key: 'sk-flagkey00000000' }).keySource).toBe('flag');
    expect(resolveAuth({}).apiKey).toBe('sk-envkey00000000');
    delete process.env.FOCALAPI_API_KEY;
    expect(resolveAuth({}).apiKey).toBe('sk-configkey00000000');
  });

  it('完全没有 key 时抛 missing_api_key', () => {
    expect(() => resolveAuth({})).toThrowError(/未找到 API Key/);
  });

  it('baseUrl：flag > env > profile > 默认，且去掉尾斜杠', () => {
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
    setProfile('default', { baseUrl: 'https://profile.example.com/' });
    expect(resolveBaseUrl()).toBe('https://profile.example.com');
    process.env.FOCALAPI_BASE_URL = 'https://env.example.com/';
    expect(resolveBaseUrl()).toBe('https://env.example.com');
    expect(resolveBaseUrl('https://flag.example.com/')).toBe('https://flag.example.com');
  });

  it('多 profile 互不干扰', () => {
    setProfile('a', { apiKey: 'sk-aaaaaaa11111' });
    setProfile('b', { apiKey: 'sk-bbbbbbb22222' });
    expect(resolveAuth({ profile: 'a' }).apiKey).toBe('sk-aaaaaaa11111');
    expect(resolveAuth({ profile: 'b' }).apiKey).toBe('sk-bbbbbbb22222');
    // currentProfile 指向最后设置的 b
    expect(resolveAuth({}).apiKey).toBe('sk-bbbbbbb22222');
  });
});
