/**
 * focalapi connect：把内置 Skills 可靠地安装到本机 AI Agent。
 *
 * 约束：
 * - 当前 catalog 是 focalapi-* 官方技能名的权威来源；同名技能会整体更新；
 * - 同一路径只执行一次事务，避免 Codex / Cline / Pi / Warp 的共享目录重复安装；
 * - manifest 记录目录摘要，默认卸载只删除未被用户修改的托管技能；
 * - connect 只让 Agent 学会调用 focalapi CLI，不改 Agent 自己的模型/provider。
 *
 * 测试钩子：FOCALAPI_HOME 覆盖 home；FOCALAPI_SKILLS_DIR 覆盖内置 Skills。
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { loadConfig, normalizeHomePath } from '../lib/config.js';
import { info, printJson, printTable } from '../lib/output.js';
import { VERSION } from '../lib/version.js';
import type { GlobalOpts } from '../cli.js';

const MANIFEST_NAME = '.focalapi-managed-skills.json';
const LEGACY_MANIFEST_NAME = '.focalapi-connect-manifest.json';

interface AgentDefinition {
  id: string;
  name: string;
  skillsPath: string[];
  detectPaths?: string[][];
}

interface AgentTarget {
  id: string;
  name: string;
  skillsDir: string;
  detected: boolean;
}

interface Manifest {
  tool: 'focalapi-cli';
  schema: 2;
  version: string;
  installedAt: string;
  agents: string[];
  skills: string[];
  digests: Record<string, string>;
}

interface StoredManifest {
  tool?: string;
  schema?: number;
  version?: string;
  installedAt?: string;
  agents?: string[];
  skills?: string[];
  digests?: Record<string, string>;
}

interface InstallResult {
  agents: string[];
  skillsDir: string;
  skills: string[];
  version: string;
}

const AGENTS: AgentDefinition[] = [
  { id: 'adal', name: 'ADAL', skillsPath: ['.adal', 'skills'] },
  { id: 'amp', name: 'Amp', skillsPath: ['.config', 'agents', 'skills'], detectPaths: [['.amp'], ['.config', 'amp']] },
  { id: 'antigravity', name: 'Antigravity', skillsPath: ['.gemini', 'antigravity', 'skills'] },
  { id: 'augment', name: 'Augment', skillsPath: ['.augment', 'skills'] },
  { id: 'bob', name: 'Bob', skillsPath: ['.bob', 'skills'] },
  { id: 'claude-code', name: 'Claude Code', skillsPath: ['.claude', 'skills'] },
  { id: 'cline', name: 'Cline', skillsPath: ['.agents', 'skills'], detectPaths: [['.cline']] },
  { id: 'codebuddy', name: 'CodeBuddy', skillsPath: ['.codebuddy', 'skills'] },
  { id: 'codex', name: 'Codex', skillsPath: ['.agents', 'skills'], detectPaths: [['.codex']] },
  { id: 'command-code', name: 'Command Code', skillsPath: ['.commandcode', 'skills'] },
  { id: 'continue', name: 'Continue', skillsPath: ['.continue', 'skills'] },
  { id: 'cortex', name: 'Snowflake Cortex', skillsPath: ['.snowflake', 'cortex', 'skills'] },
  { id: 'crush', name: 'Crush', skillsPath: ['.config', 'crush', 'skills'] },
  { id: 'cursor', name: 'Cursor', skillsPath: ['.cursor', 'skills'] },
  { id: 'deepagents', name: 'Deep Agents', skillsPath: ['.deepagents', 'agent', 'skills'] },
  { id: 'droid', name: 'Factory Droid', skillsPath: ['.factory', 'skills'] },
  { id: 'firebender', name: 'Firebender', skillsPath: ['.firebender', 'skills'] },
  { id: 'gemini-cli', name: 'Gemini CLI', skillsPath: ['.gemini', 'skills'] },
  { id: 'github-copilot', name: 'GitHub Copilot', skillsPath: ['.copilot', 'skills'] },
  { id: 'goose', name: 'Goose', skillsPath: ['.config', 'goose', 'skills'] },
  { id: 'iflow-cli', name: 'iFlow CLI', skillsPath: ['.iflow', 'skills'] },
  { id: 'junie', name: 'Junie', skillsPath: ['.junie', 'skills'] },
  { id: 'kilo', name: 'Kilo Code', skillsPath: ['.kilocode', 'skills'] },
  { id: 'kimi-cli', name: 'Kimi CLI', skillsPath: ['.config', 'agents', 'skills'], detectPaths: [['.kimi'], ['.config', 'kimi']] },
  { id: 'kiro-cli', name: 'Kiro CLI', skillsPath: ['.kiro', 'skills'] },
  { id: 'kode', name: 'Kode', skillsPath: ['.kode', 'skills'] },
  { id: 'mcpjam', name: 'MCPJam', skillsPath: ['.mcpjam', 'skills'] },
  { id: 'mistral-vibe', name: 'Mistral Vibe', skillsPath: ['.vibe', 'skills'] },
  { id: 'mux', name: 'Mux', skillsPath: ['.mux', 'skills'] },
  { id: 'neovate', name: 'Neovate', skillsPath: ['.neovate', 'skills'] },
  { id: 'openclaw', name: 'OpenClaw', skillsPath: ['.openclaw', 'skills'] },
  { id: 'opencode', name: 'OpenCode', skillsPath: ['.config', 'opencode', 'skills'] },
  { id: 'openhands', name: 'OpenHands', skillsPath: ['.openhands', 'skills'] },
  { id: 'pi', name: 'Pi', skillsPath: ['.agents', 'skills'], detectPaths: [['.pi', 'agent']] },
  { id: 'pochi', name: 'Pochi', skillsPath: ['.pochi', 'skills'] },
  { id: 'qoder', name: 'Qoder', skillsPath: ['.qoder', 'skills'] },
  { id: 'qwen-code', name: 'Qwen Code', skillsPath: ['.qwen', 'skills'] },
  { id: 'roo', name: 'Roo Code', skillsPath: ['.roo', 'skills'] },
  { id: 'trae', name: 'Trae', skillsPath: ['.trae', 'skills'] },
  { id: 'trae-cn', name: 'Trae CN', skillsPath: ['.trae-cn', 'skills'] },
  { id: 'warp', name: 'Warp', skillsPath: ['.agents', 'skills'], detectPaths: [['.warp']] },
  { id: 'windsurf', name: 'Windsurf', skillsPath: ['.codeium', 'windsurf', 'skills'] },
  { id: 'zencoder', name: 'Zencoder', skillsPath: ['.zencoder', 'skills'] },
];

function homeDir(): string {
  return normalizeHomePath(process.env.FOCALAPI_HOME ?? homedir());
}

function getTargets(): AgentTarget[] {
  const home = homeDir();
  const definitions = [...AGENTS];
  definitions.push({
    id: 'hermes',
    name: 'Hermes',
    skillsPath: platform() === 'win32'
      ? ['AppData', 'Local', 'hermes', 'skills']
      : ['.config', 'hermes', 'skills'],
  });
  return definitions.map((agent) => {
    const skillsDir = join(home, ...agent.skillsPath);
    const detectPaths = agent.detectPaths ?? [agent.skillsPath.slice(0, -1)];
    return {
      id: agent.id,
      name: agent.name,
      skillsDir,
      detected: detectPaths.some((parts) => existsSync(join(home, ...parts))),
    };
  });
}

/** 兼容打包后（dist/cli.js → ../skills）与开发态（src/commands → ../../skills）。 */
export function bundledSkillsDir(): string {
  if (process.env.FOCALAPI_SKILLS_DIR) return normalizeHomePath(process.env.FOCALAPI_SKILLS_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'skills'), join(here, '..', '..', 'skills')];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'focalapi', 'SKILL.md'))) return dir;
  }
  throw new ApiError('internal_error', '未找到内置 Skills（focalapi/SKILL.md 缺失）');
}

export function listBundledSkills(srcDir?: string): string[] {
  const dir = srcDir ?? bundledSkillsDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('focalapi') && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function manifestPath(skillsDir: string): string {
  return join(skillsDir, MANIFEST_NAME);
}

function readManifest(skillsDir: string): StoredManifest | undefined {
  for (const name of [MANIFEST_NAME, LEGACY_MANIFEST_NAME]) {
    const path = join(skillsDir, name);
    if (!existsSync(path)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as StoredManifest;
      if (manifest.tool === 'focalapi-cli' && Array.isArray(manifest.skills)) return manifest;
    } catch {
      // 损坏的 manifest 由 verify 报告；安装可重新收敛当前 catalog。
    }
  }
  return undefined;
}

function digestDirectory(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const name = relative(root, path).replaceAll('\\', '/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        hash.update(`link\0${name}\0${readlinkSync(path)}\0`);
      } else if (stat.isDirectory()) {
        hash.update(`dir\0${name}\0`);
        walk(path);
      } else if (stat.isFile()) {
        hash.update(`file\0${name}\0`);
        hash.update(readFileSync(path));
        hash.update('\0');
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

function isAuthConfigured(): boolean {
  if (process.env.FOCALAPI_API_KEY) return true;
  try {
    return Object.values(loadConfig().profiles).some((profile) => Boolean(profile.apiKey));
  } catch {
    return false;
  }
}

function groupTargets(targets: AgentTarget[]): Array<{ agents: AgentTarget[]; skillsDir: string }> {
  const grouped = new Map<string, AgentTarget[]>();
  for (const target of targets) {
    const key = resolve(target.skillsDir).toLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  }
  return [...grouped.values()].map((agents) => ({ agents, skillsDir: agents[0]!.skillsDir }));
}

function installTo(skillsDir: string, agents: string[], skills: string[], srcDir: string): InstallResult {
  const sourceRoot = resolve(srcDir).toLowerCase();
  if (resolve(skillsDir).toLowerCase() === sourceRoot) {
    throw new ApiError('invalid_request', '安装目标不能是 focalapi-cli 自带 Skills 源目录');
  }

  mkdirSync(skillsDir, { recursive: true });
  const oldManifest = readManifest(skillsDir);
  const transactionRoot = join(skillsDir, `.focalapi-install-${randomUUID()}`);
  const stageRoot = join(transactionRoot, 'stage');
  const backupRoot = join(transactionRoot, 'backup');
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(backupRoot, { recursive: true });

  const digests: Record<string, string> = {};
  const touched: Array<{ destination: string; backup?: string }> = [];
  let oldManifestBackup: string | undefined;
  let oldLegacyManifestBackup: string | undefined;
  try {
    for (const skill of skills) {
      const staged = join(stageRoot, skill);
      cpSync(join(srcDir, skill), staged, { recursive: true, force: true });
      digests[skill] = digestDirectory(staged);
    }

    const currentManifest = manifestPath(skillsDir);
    if (existsSync(currentManifest)) {
      oldManifestBackup = join(backupRoot, MANIFEST_NAME);
      renameSync(currentManifest, oldManifestBackup);
    }
    const legacyManifest = join(skillsDir, LEGACY_MANIFEST_NAME);
    if (existsSync(legacyManifest)) {
      oldLegacyManifestBackup = join(backupRoot, LEGACY_MANIFEST_NAME);
      renameSync(legacyManifest, oldLegacyManifestBackup);
    }

    for (const skill of skills) {
      const destination = join(skillsDir, skill);
      const backup = join(backupRoot, skill);
      if (existsSync(destination)) {
        renameSync(destination, backup);
        touched.push({ destination, backup });
      } else {
        touched.push({ destination });
      }
      renameSync(join(stageRoot, skill), destination);
    }

    // 退出 catalog 的旧托管技能，仅在摘要仍等于上次安装值时删除；用户修改过的保留。
    for (const retired of oldManifest?.skills ?? []) {
      if (skills.includes(retired) || !retired.startsWith('focalapi')) continue;
      const destination = join(skillsDir, retired);
      const expected = oldManifest?.digests?.[retired];
      if (!expected || !existsSync(destination) || digestDirectory(destination) !== expected) continue;
      const backup = join(backupRoot, `retired-${retired}`);
      renameSync(destination, backup);
      touched.push({ destination, backup });
    }

    const manifest: Manifest = {
      tool: 'focalapi-cli',
      schema: 2,
      version: VERSION,
      installedAt: new Date().toISOString(),
      agents,
      skills,
      digests,
    };
    const stagedManifest = join(transactionRoot, MANIFEST_NAME);
    writeFileSync(stagedManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    renameSync(stagedManifest, currentManifest);
  } catch (error) {
    rmSync(manifestPath(skillsDir), { force: true });
    for (const item of touched.reverse()) {
      rmSync(item.destination, { recursive: true, force: true });
      if (item.backup && existsSync(item.backup)) renameSync(item.backup, item.destination);
    }
    if (oldManifestBackup && existsSync(oldManifestBackup)) renameSync(oldManifestBackup, manifestPath(skillsDir));
    if (oldLegacyManifestBackup && existsSync(oldLegacyManifestBackup)) {
      renameSync(oldLegacyManifestBackup, join(skillsDir, LEGACY_MANIFEST_NAME));
    }
    throw error;
  } finally {
    rmSync(transactionRoot, { recursive: true, force: true });
  }

  return { agents, skillsDir, skills, version: VERSION };
}

function uninstallFrom(skillsDir: string, srcDir: string): { removed: string[]; preserved: string[]; hadManifest: boolean } {
  const manifest = readManifest(skillsDir);
  if (!manifest) return { removed: [], preserved: [], hadManifest: false };
  const removed: string[] = [];
  const preserved: string[] = [];
  for (const skill of manifest.skills ?? []) {
    if (!skill.startsWith('focalapi')) continue;
    const dir = join(skillsDir, skill);
    if (!existsSync(dir)) continue;
    const expected = manifest.digests?.[skill]
      ?? (existsSync(join(srcDir, skill)) ? digestDirectory(join(srcDir, skill)) : undefined);
    if (!expected || digestDirectory(dir) !== expected) {
      preserved.push(skill);
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
    removed.push(skill);
  }
  rmSync(manifestPath(skillsDir), { force: true });
  rmSync(join(skillsDir, LEGACY_MANIFEST_NAME), { force: true });
  return { removed, preserved, hadManifest: true };
}

function verifyTarget(skillsDir: string): { installed: boolean; valid: boolean; version?: string; missing: string[]; modified: string[] } {
  const manifest = readManifest(skillsDir);
  if (!manifest) return { installed: false, valid: false, missing: [], modified: [] };
  const missing: string[] = [];
  const modified: string[] = [];
  for (const skill of manifest.skills ?? []) {
    const dir = join(skillsDir, skill);
    if (!existsSync(dir)) {
      missing.push(skill);
      continue;
    }
    const expected = manifest.digests?.[skill];
    if (!expected || digestDirectory(dir) !== expected) modified.push(skill);
  }
  return {
    installed: true,
    valid: missing.length === 0 && modified.length === 0,
    version: manifest.version,
    missing,
    modified,
  };
}

function customTarget(path: string): AgentTarget {
  const skillsDir = resolve(normalizeHomePath(path));
  if (dirname(skillsDir) === skillsDir || skillsDir.toLowerCase() === resolve(homeDir()).toLowerCase()) {
    throw new ApiError('invalid_request', '--path 必须指向具体的 Skills 目录，不能是磁盘根目录或用户主目录');
  }
  return {
    id: 'custom',
    name: 'Custom Skills Directory',
    skillsDir,
    detected: true,
  };
}

function resolveTargets(targetIds: string[], path: string | undefined, g: GlobalOpts): AgentTarget[] {
  if (path) {
    if (targetIds.length > 0) {
      throw new ApiError('invalid_request', '--path 与 Agent ID 不能同时使用');
    }
    return [customTarget(path)];
  }
  const all = getTargets();
  if (targetIds.length > 0) {
    const unknown = targetIds.filter((id) => !all.some((target) => target.id === id));
    if (unknown.length > 0) {
      throw new ApiError('invalid_request', `未知 Agent：${unknown.join(', ')}`, {
        hint: `可选：${all.map((target) => target.id).join(' | ')}；未知 Agent 可使用 --path <skills-dir>。`,
      });
    }
    return all.filter((target) => targetIds.includes(target.id));
  }
  const detected = all.filter((target) => target.detected);
  if (detected.length === 0) {
    throw new ApiError('invalid_request', '未检测到本机 Agent', {
      hint: '运行 focalapi connect list 查看支持列表，或使用 focalapi connect install --path <skills-dir>。',
    });
  }
  if (!g.json) info(`检测到 ${detected.length} 个 Agent，将按 ${groupTargets(detected).length} 个技能目录安装。`);
  return detected;
}

function installCommand(targetIds: string[], path: string | undefined, g: GlobalOpts): void {
  const targets = resolveTargets(targetIds, path, g);
  const srcDir = bundledSkillsDir();
  const skills = listBundledSkills(srcDir);
  const results = groupTargets(targets).map((group) => installTo(
    group.skillsDir,
    group.agents.map((agent) => agent.id),
    skills,
    srcDir,
  ));
  const authConfigured = isAuthConfigured();
  const nextSteps = [
    ...(!authConfigured ? ['focalapi auth login --key <sk-...>'] : []),
    '重启 Agent 会话',
    '直接描述创作任务，例如“生成一张产品主视觉”',
  ];
  if (g.json) {
    printJson({
      installed: results,
      auth_configured: authConfigured,
      ready: authConfigured,
      restart_required: true,
      next_steps: nextSteps,
    });
    return;
  }
  for (const result of results) {
    info(`✓ ${result.agents.join(' / ')}：${result.skills.length} 个 Skills 已装入 ${result.skillsDir}`);
  }
  info(authConfigured
    ? '接入已闭环：重启 Agent 后，直接描述图片或视频任务即可；无需点名 focalapi 或先试模型。'
    : 'Skills 已安装；还需运行 focalapi auth login --key <sk-...>，然后重启 Agent。');
}

export function registerConnect(program: Command): void {
  const connect = program
    .command('connect')
    .description('让本机 AI Agent 自动调用 focalapi 创作模型（不改 Agent 的主模型/provider）')
    .option('--path <skills-dir>', '安装到指定 Skills 目录，不扫描全局 Agent')
    .action(async (opts: { path?: string }, cmd: Command) => {
      installCommand([], opts.path, cmd.optsWithGlobals() as GlobalOpts);
    });

  connect
    .command('list')
    .description('列出支持的 Agent 及检测/安装状态（只读）')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const rows = getTargets().map((target) => {
        const status = verifyTarget(target.skillsDir);
        return {
          id: target.id,
          name: target.name,
          detected: target.detected,
          skills_dir: target.skillsDir,
          installed: status.installed,
          valid: status.valid,
          version: status.version,
        };
      });
      if (g.json) {
        printJson({ supported: rows.length, agents: rows });
      } else {
        printTable(
          ['Agent', 'ID', '检测到', '安装状态', '技能目录'],
          rows.map((row) => [
            row.name,
            row.id,
            row.detected ? '✓' : '-',
            row.valid ? `✓ v${row.version}` : row.installed ? '需修复' : '-',
            row.skills_dir,
          ]),
        );
      }
    });

  connect
    .command('install')
    .description('事务式安装/修复 Skills；省略 Agent ID 时处理全部已检测到的 Agent')
    .argument('[targets...]', 'Agent ID，如 claude-code codex')
    .option('--path <skills-dir>', '安装到指定 Skills 目录，不扫描全局 Agent')
    .action(async (targetIds: string[], opts: { path?: string }, cmd: Command) => {
      installCommand(targetIds, opts.path ?? cmd.parent?.opts().path as string | undefined, cmd.optsWithGlobals() as GlobalOpts);
    });

  connect
    .command('verify')
    .description('验证 Skills 完整性、认证就绪状态与需要重启的 Agent')
    .argument('[targets...]', 'Agent ID；省略=全部已检测到的')
    .option('--path <skills-dir>', '验证指定 Skills 目录')
    .action(async (targetIds: string[], opts: { path?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const targets = resolveTargets(targetIds, opts.path ?? cmd.parent?.opts().path as string | undefined, g);
      const rows = groupTargets(targets).map((group) => ({
        agents: group.agents.map((agent) => agent.id),
        skills_dir: group.skillsDir,
        ...verifyTarget(group.skillsDir),
      }));
      const authConfigured = isAuthConfigured();
      const valid = rows.every((row) => row.valid);
      const result = {
        valid,
        auth_configured: authConfigured,
        ready: valid && authConfigured,
        targets: rows,
        next_steps: [
          ...(!valid ? ['focalapi connect install'] : []),
          ...(!authConfigured ? ['focalapi auth login --key <sk-...>'] : []),
          ...(valid && authConfigured ? ['重启 Agent 会话后直接描述创作任务'] : []),
        ],
      };
      if (g.json) {
        printJson(result);
      } else {
        printTable(
          ['Agent', 'Skills', '认证', '就绪'],
          rows.map((row) => [row.agents.join(' / '), row.valid ? '✓' : '需修复', authConfigured ? '✓' : '未配置', row.valid && authConfigured ? '✓' : '-']),
        );
        for (const step of result.next_steps) info(`下一步：${step}`);
      }
      if (!result.ready) process.exitCode = 1;
    });

  connect
    .command('uninstall')
    .description('卸载未被用户修改的托管 Skills；其他文件一律保留')
    .argument('[targets...]', 'Agent ID；省略=全部已检测到的')
    .option('--path <skills-dir>', '从指定 Skills 目录卸载')
    .action(async (targetIds: string[], opts: { path?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const targets = resolveTargets(targetIds, opts.path ?? cmd.parent?.opts().path as string | undefined, g);
      const srcDir = bundledSkillsDir();
      const results = groupTargets(targets).map((group) => ({
        agents: group.agents.map((agent) => agent.id),
        skills_dir: group.skillsDir,
        ...uninstallFrom(group.skillsDir, srcDir),
      }));
      if (g.json) {
        printJson({ uninstalled: results });
        return;
      }
      for (const result of results) {
        info(`✓ ${result.agents.join(' / ')}：移除 ${result.removed.length} 个，保留用户修改 ${result.preserved.length} 个`);
      }
    });
}
