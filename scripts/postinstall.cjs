#!/usr/bin/env node

/**
 * Best-effort Agent integration after global npm installation.
 *
 * Run local connect only: do not access the network, read an API key, or change an Agent provider.
 * Missing Agents or integration failures never fail CLI installation; users can run focalapi connect later.
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
    // Unparseable output after a successful connect must not fail installation.
  }
  process.exit(0);
}

if (!String(result.stderr).includes('未检测到本机 Agent')) {
  console.warn('focalapi-cli: Agent Skills 自动接入未完成；请稍后运行 `focalapi connect`。');
}
process.exit(0);
