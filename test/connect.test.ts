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
  return join(claudeSkillsDir(), '.focalapi-managed-skills.json');
}

describe('connect', () => {
  it('内置 skills 源目录可解析且包含全部技能', () => {
    const skills = listBundledSkills();
    expect(skills).toEqual(['focalapi', 'focalapi-auth', 'focalapi-chat', 'focalapi-gen', 'focalapi-models', 'focalapi-task', 'focalapi-usage']);
  });

  it('list --json 反映 40+ Agent 的探测状态', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    expect(await main(argv('connect', 'list', '--json'))).toBe(0);
    const out = JSON.parse(ctx.stdout()) as { supported: number; agents: { id: string; detected: boolean }[] };
    expect(out.supported).toBeGreaterThanOrEqual(40);
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
    const manifest = JSON.parse(readFileSync(manifestPath(), 'utf-8')) as { schema: number; skills: string[]; digests: Record<string, string>; tool: string };
    expect(manifest.tool).toBe('focalapi-cli');
    expect(manifest.schema).toBe(2);
    expect(manifest.skills.length).toBeGreaterThanOrEqual(7);
    expect(manifest.digests.focalapi).toMatch(/^[0-9a-f]{64}$/);

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

  it('uninstall 保留安装后被用户修改的托管技能', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    expect(await main(argv('connect', 'install', 'claude-code', '--json'))).toBe(0);
    ctx.takeStdout();
    const skillFile = join(claudeSkillsDir(), 'focalapi', 'SKILL.md');
    writeFileSync(skillFile, readFileSync(skillFile, 'utf-8') + '\n用户自定义\n');

    process.env.FOCALAPI_API_KEY = 'sk-connect-test-ready-key';
    expect(await main(argv('connect', 'verify', 'claude-code', '--json'))).toBe(1);
    const verification = JSON.parse(ctx.takeStdout()) as { valid: boolean; targets: Array<{ modified: string[] }> };
    expect(verification.valid).toBe(false);
    expect(verification.targets[0]?.modified).toContain('focalapi');

    expect(await main(argv('connect', 'uninstall', 'claude-code', '--json'))).toBe(0);
    const out = JSON.parse(ctx.stdout()) as { uninstalled: Array<{ preserved: string[] }> };
    expect(out.uninstalled[0]?.preserved).toContain('focalapi');
    expect(existsSync(skillFile)).toBe(true);
  });

  it('支持未知 Agent 的自定义 Skills 目录并可验证完整性', async () => {
    const custom = join(ctx.homeDir, 'my-agent', 'skills');
    expect(await main(argv('connect', 'install', '--path', custom, '--json'))).toBe(0);
    ctx.takeStdout();
    expect(existsSync(join(custom, 'focalapi-gen', 'SKILL.md'))).toBe(true);

    process.env.FOCALAPI_API_KEY = 'sk-connect-test-ready-key';
    expect(await main(argv('connect', 'verify', '--path', custom, '--json'))).toBe(0);
    const out = JSON.parse(ctx.stdout()) as { valid: boolean; targets: Array<{ skills_dir: string }> };
    expect(out.valid).toBe(true);
    expect(out.targets[0]?.skills_dir).toBe(custom);
  });

  it('Codex 安装到共享 ~/.agents/skills，根 connect 等价于安装', async () => {
    mkdirSync(join(ctx.homeDir, '.codex'), { recursive: true });
    expect(await main(argv('connect', '--json'))).toBe(0);
    const shared = join(ctx.homeDir, '.agents', 'skills');
    expect(existsSync(join(shared, 'focalapi', 'SKILL.md'))).toBe(true);
    const out = JSON.parse(ctx.stdout()) as { installed: Array<{ agents: string[] }> };
    expect(out.installed.some((item) => item.agents.includes('codex'))).toBe(true);
  });

  it('未知 agent id 报错并列出可选项', async () => {
    expect(await main(argv('connect', 'install', 'not-an-agent'))).toBe(1);
    expect(ctx.stderr()).toContain('claude-code');
  });

  it('未检测到任何 agent 且未显式指定时给出提示', async () => {
    expect(await main(argv('connect', 'install'))).toBe(1);
    expect(ctx.stderr()).toContain('未检测到本机 Agent');
  });
});
