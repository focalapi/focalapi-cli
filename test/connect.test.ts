/**
 * connect 命令测试：临时 HOME 下的探测、安装、幂等、卸载。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.js';
import { listBundledSkills } from '../src/commands/connect.js';
import { setupTestEnv } from './helpers.js';

const ctx = setupTestEnv();

function argv(...args: string[]): string[] {
  return ['node', 'focalapi', ...args];
}

function claudeDir(): string {
  return join(ctx.homeDir, '.claude');
}

function claudeSkillsDir(): string {
  return join(claudeDir(), 'skills');
}

function manifestPath(): string {
  return join(claudeSkillsDir(), '.focalapi-connect-manifest.json');
}

describe('connect', () => {
  it('内置 skills 源目录可解析且包含全部技能', () => {
    const skills = listBundledSkills();
    expect(skills).toEqual(
      expect.arrayContaining(['focalapi', 'focalapi-auth', 'focalapi-chat', 'focalapi-gen', 'focalapi-models', 'focalapi-task', 'focalapi-usage']),
    );
  });

  it('list --json 反映探测状态', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    expect(await main(argv('connect', 'list', '--json'))).toBe(0);
    const out = JSON.parse(ctx.stdout()) as { agents: { id: string; detected: boolean }[] };
    expect(out.agents.find((a) => a.id === 'claude-code')?.detected).toBe(true);
    expect(out.agents.find((a) => a.id === 'codex')?.detected).toBe(false);
  });

  it('install 复制技能并写 manifest；重复 install 幂等；uninstall 精确清理', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    // 预置一个无关文件，验证 uninstall 不误删
    mkdirSync(claudeSkillsDir(), { recursive: true });
    writeFileSync(join(claudeSkillsDir(), 'other-skill.txt'), 'keep me');

    expect(await main(argv('connect', 'install', 'claude-code', '--json'))).toBe(0);
    expect(existsSync(join(claudeSkillsDir(), 'focalapi', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir(), 'focalapi-gen', 'SKILL.md'))).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath(), 'utf-8')) as { skills: string[]; tool: string };
    expect(manifest.tool).toBe('focalapi-cli');
    expect(manifest.skills.length).toBeGreaterThanOrEqual(7);

    // 幂等：再装一次仍成功
    expect(await main(argv('connect', 'install', 'claude-code', '--json'))).toBe(0);

    expect(await main(argv('connect', 'uninstall', 'claude-code', '--json'))).toBe(0);
    expect(existsSync(join(claudeSkillsDir(), 'focalapi'))).toBe(false);
    expect(existsSync(manifestPath())).toBe(false);
    expect(readFileSync(join(claudeSkillsDir(), 'other-skill.txt'), 'utf-8')).toBe('keep me');
  });

  it('uninstall 无 manifest 时不做任何删除', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    mkdirSync(claudeSkillsDir(), { recursive: true });
    writeFileSync(join(claudeSkillsDir(), 'focalapi-fake.txt'), 'not ours');
    expect(await main(argv('connect', 'uninstall', 'claude-code', '--json'))).toBe(0);
    expect(existsSync(join(claudeSkillsDir(), 'focalapi-fake.txt'))).toBe(true);
  });

  it('未知 agent id 报错并列出可选项', async () => {
    expect(await main(argv('connect', 'install', 'not-an-agent'))).toBe(1);
    expect(ctx.stderr()).toContain('claude-code');
  });

  it('未检测到任何 agent 且未显式指定时给出提示', async () => {
    expect(await main(argv('connect', 'install'))).toBe(1);
    expect(ctx.stderr()).toContain('未检测到任何本机 Agent');
  });
});
