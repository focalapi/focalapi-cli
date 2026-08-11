#!/usr/bin/env node

/**
 * npm 全局安装后的 best-effort Agent 接入。
 *
 * 只运行本地 connect：不联网、不读取 API Key、不改 Agent provider。没有检测到
 * Agent 或接入失败都不影响 CLI 安装；用户之后可运行 focalapi connect 修复。
 */

const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.env.FOCALAPI_SKIP_POSTINSTALL === '1' || process.env.CI === '1' || process.env.CI === 'true') {
  process.exit(0);
}

const cli = join(__dirname, '..', 'dist', 'cli.js');
if (!existsSync(cli)) process.exit(0);

const result = spawnSync(process.execPath, [cli, 'connect', 'install', '--json'], {
  encoding: 'utf8',
  env: process.env,
  windowsHide: true,
});

if (result.status === 0) {
  try {
    const output = JSON.parse(result.stdout || '{}');
    const count = Array.isArray(output.installed) ? output.installed.length : 0;
    if (count > 0) console.log(`focalapi-cli: 已自动接入 ${count} 个 Agent Skills 目录；重启 Agent 后生效。`);
  } catch {
    // connect 成功但输出不可解析不影响安装。
  }
  process.exit(0);
}

if (!String(result.stderr).includes('未检测到本机 Agent')) {
  console.warn('focalapi-cli: Agent Skills 自动接入未完成；请稍后运行 `focalapi connect`。');
}
process.exit(0);
