/**
 * focalapi connect：把内置 skills 注入本机 AI Agent（Claude Code / Codex / OpenCode / Hermes）。
 *
 * 原则：
 * - install 幂等：覆盖式复制 skills，写 manifest 记录安装清单；
 * - uninstall 只删 manifest 记录过的文件，绝不碰其他；
 * - provider 配置（base_url+key 写入 Agent 配置）v1 只打印指引，不自动改 Agent 文件。
 *
 * 测试钩子：FOCALAPI_HOME 覆盖 home 目录；FOCALAPI_SKILLS_DIR 覆盖内置 skills 源目录。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { normalizeHomePath } from '../lib/config.js';
import { info, printJson, printTable } from '../lib/output.js';
import { VERSION } from '../lib/version.js';
import type { GlobalOpts } from '../cli.js';

const MANIFEST_NAME = '.focalapi-connect-manifest.json';

function homeDir(): string {
  return normalizeHomePath(process.env.FOCALAPI_HOME ?? homedir());
}

interface AgentTarget {
  id: string;
  name: string;
  /** 技能安装目录。 */
  skillsDir: string;
  /** 探测依据：该 Agent 的配置根目录是否已存在。 */
  detected: boolean;
  /** 手动 provider 配置指引（v1 只打印）。 */
  providerHint: string;
}

function getTargets(): AgentTarget[] {
  const home = homeDir();
  const claudeRoot = join(home, '.claude');
  const codexRoot = join(home, '.codex');
  const opencodeRoot = join(home, '.config', 'opencode');
  const hermesRoot =
    platform() === 'win32'
      ? join(home, 'AppData', 'Local', 'hermes')
      : join(home, '.config', 'hermes');

  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      skillsDir: join(claudeRoot, 'skills'),
      detected: existsSync(claudeRoot),
      providerHint: [
        'Claude Code provider 配置（手动）：',
        '  在 ~/.claude/settings.json 的 env 段加入：',
        '    "ANTHROPIC_BASE_URL": "https://api.focalapi.com",',
        '    "ANTHROPIC_AUTH_TOKEN": "<你的 sk- key>"',
        '  （focalapi 已兼容 /v1/messages 协议）',
      ].join('\n'),
    },
    {
      id: 'codex',
      name: 'Codex',
      skillsDir: join(codexRoot, 'skills'),
      detected: existsSync(codexRoot),
      providerHint: [
        'Codex provider 配置（手动）：',
        '  在 ~/.codex/config.toml 加入：',
        '    [model_providers.focalapi]',
        '    name = "focalapi"',
        '    base_url = "https://api.focalapi.com/v1"',
        '    env_key = "FOCALAPI_API_KEY"',
        '  （focalapi 已兼容 /v1/responses 与 /v1/chat/completions）',
      ].join('\n'),
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      skillsDir: join(opencodeRoot, 'skills'),
      detected: existsSync(opencodeRoot),
      providerHint: [
        'OpenCode provider 配置（手动）：',
        '  在 opencode.json 的 provider 段加入 openai-compatible 提供商，',
        '  baseURL = "https://api.focalapi.com/v1"，apiKey 指向你的 sk- key。',
      ].join('\n'),
    },
    {
      id: 'hermes',
      name: 'Hermes',
      skillsDir: join(hermesRoot, 'skills'),
      detected: existsSync(hermesRoot),
      providerHint: [
        'Hermes 配置（手动）：',
        '  技能已装入默认 profile 的 skills 目录；非默认 profile 请把技能目录复制到',
        '  hermes/profiles/<name>/skills/。provider 在 config.yaml 加 openai-compatible',
        '  提供商，base_url = "https://api.focalapi.com/v1"。',
      ].join('\n'),
    },
  ];
}

/** 定位内置 skills 源目录：兼容打包后（dist/cli.js → ../skills）与开发态（src/commands → ../../skills）。 */
export function bundledSkillsDir(): string {
  if (process.env.FOCALAPI_SKILLS_DIR) {
    return process.env.FOCALAPI_SKILLS_DIR;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'skills'), join(here, '..', '..', 'skills')];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'focalapi', 'SKILL.md'))) {
      return dir;
    }
  }
  throw new ApiError('internal_error', '未找到内置 skills 目录（focalapi/SKILL.md 缺失）');
}

export function listBundledSkills(srcDir?: string): string[] {
  const dir = srcDir ?? bundledSkillsDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('focalapi') && existsSync(join(dir, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
}

interface Manifest {
  tool: 'focalapi-cli';
  version: string;
  installedAt: string;
  skills: string[];
}

function manifestPath(skillsDir: string): string {
  return join(skillsDir, MANIFEST_NAME);
}

function readManifest(skillsDir: string): Manifest | undefined {
  const path = manifestPath(skillsDir);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
  } catch {
    return undefined;
  }
}

function installTo(target: AgentTarget, skills: string[], srcDir: string): Manifest {
  mkdirSync(target.skillsDir, { recursive: true });
  for (const skill of skills) {
    cpSync(join(srcDir, skill), join(target.skillsDir, skill), { recursive: true });
  }
  const manifest: Manifest = {
    tool: 'focalapi-cli',
    version: VERSION,
    installedAt: new Date().toISOString(),
    skills,
  };
  writeFileSync(manifestPath(target.skillsDir), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifest;
}

function uninstallFrom(target: AgentTarget): { removed: string[]; hadManifest: boolean } {
  const manifest = readManifest(target.skillsDir);
  if (!manifest) {
    return { removed: [], hadManifest: false };
  }
  const removed: string[] = [];
  for (const skill of manifest.skills) {
    const dir = join(target.skillsDir, skill);
    // 双重防护：只删 focalapi 前缀目录
    if (skill.startsWith('focalapi') && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(skill);
    }
  }
  rmSync(manifestPath(target.skillsDir), { force: true });
  return { removed, hadManifest: true };
}

function resolveTargets(targetIds: string[] | undefined, g: GlobalOpts): AgentTarget[] {
  const all = getTargets();
  if (targetIds && targetIds.length > 0) {
    const unknown = targetIds.filter((id) => !all.some((t) => t.id === id));
    if (unknown.length > 0) {
      throw new ApiError('invalid_request', `未知 Agent：${unknown.join(', ')}`, {
        hint: `可选：${all.map((t) => t.id).join(' | ')}。`,
      });
    }
    return all.filter((t) => targetIds.includes(t.id));
  }
  const detected = all.filter((t) => t.detected);
  if (detected.length === 0) {
    throw new ApiError('invalid_request', '未检测到任何本机 Agent', {
      hint: `支持：${all.map((t) => `${t.id}（${t.name}）`).join('、')}。可先显式指定：focalapi connect install <agent>。`,
    });
  }
  if (!g.json) {
    info(`检测到 ${detected.length} 个 Agent：${detected.map((t) => t.name).join('、')}`);
  }
  return detected;
}

export function registerConnect(program: Command): void {
  const connect = program.command('connect').description('把 focalapi 能力注入本机 AI Agent（skills 安装/卸载）');

  connect
    .command('list')
    .description('列出支持的 Agent 及检测/安装状态')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const rows = getTargets().map((t) => {
        const manifest = readManifest(t.skillsDir);
        return {
          id: t.id,
          name: t.name,
          detected: t.detected,
          skillsDir: t.skillsDir,
          installed: manifest ? `${manifest.skills.length} 个技能（v${manifest.version}）` : '',
        };
      });
      if (g.json) {
        printJson({ agents: rows });
      } else {
        printTable(
          ['Agent', 'ID', '检测到', '已安装', '技能目录'],
          rows.map((r) => [r.name, r.id, r.detected ? '✓' : '-', r.installed || '-', r.skillsDir]),
        );
      }
    });

  connect
    .command('install')
    .description('向指定（或全部已检测到的）Agent 安装 focalapi 技能包')
    .argument('[targets...]', `Agent ID，如 claude-code codex；省略=全部已检测到的`)
    .action(async (targetIds: string[], _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const targets = resolveTargets(targetIds, g);
      const srcDir = bundledSkillsDir();
      const skills = listBundledSkills(srcDir);
      const results = targets.map((t) => ({ target: t, manifest: installTo(t, skills, srcDir) }));

      if (g.json) {
        printJson({
          installed: results.map((r) => ({ agent: r.target.id, skillsDir: r.target.skillsDir, skills: r.manifest.skills })),
        });
        return;
      }
      for (const { target, manifest } of results) {
        info(`✓ ${target.name}：${manifest.skills.length} 个技能已装入 ${target.skillsDir}`);
      }
      info('');
      info('技能已就绪。要让 Agent 直接以 focalapi 为模型后端，还需配置 provider（v1 请手动）：');
      for (const { target } of results) {
        info('');
        info(target.providerHint);
      }
      info('');
      info('完成后重启 Agent 会话，即可用自然语言让它调用 focalapi（如「用 focalapi 画一张……」）。');
      info('卸载：focalapi connect uninstall');
    });

  connect
    .command('uninstall')
    .description('按 manifest 精确卸载注入的技能（不碰其他文件）')
    .argument('[targets...]', 'Agent ID；省略=全部已检测到的')
    .action(async (targetIds: string[], _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const targets = resolveTargets(targetIds, g);
      const results = targets.map((t) => ({ target: t, ...uninstallFrom(t) }));

      if (g.json) {
        printJson({
          uninstalled: results.map((r) => ({ agent: r.target.id, removed: r.removed, hadManifest: r.hadManifest })),
        });
        return;
      }
      for (const r of results) {
        if (!r.hadManifest) {
          info(`- ${r.target.name}：无 focalapi 安装记录，跳过`);
        } else {
          info(`✓ ${r.target.name}：已移除 ${r.removed.length} 个技能`);
        }
      }
    });
}
