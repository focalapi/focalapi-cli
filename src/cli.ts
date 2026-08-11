/**
 * CLI entry point: Commander assembly and the global error boundary.
 */

import { Command } from 'commander';
import { printError } from './lib/output.js';
import { VERSION } from './lib/version.js';
import { registerAuth } from './commands/auth.js';
import { registerModels } from './commands/models.js';
import { registerChat } from './commands/chat.js';
import { registerDoctor } from './commands/doctor.js';
import { registerGen } from './commands/gen.js';
import { registerTask } from './commands/task.js';
import { registerAudio } from './commands/audio.js';
import { registerUsage } from './commands/usage.js';
import { registerConnect } from './commands/connect.js';
import { registerUpdate } from './commands/update.js';
import { registerRequest } from './commands/request.js';

export interface GlobalOpts {
  json?: boolean;
  baseUrl?: string;
  key?: string;
  profile?: string;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('focalapi')
    .description('让 AI Agent 直接调用 focalapi 创作模型：自动选模、生成、任务续取与用量诊断')
    .version(VERSION, '-v, --version', '显示版本号')
    .option('--json', '以 JSON 输出（面向 Agent 与脚本，stdout 纯净）')
    .option('--base-url <url>', '覆盖 API 地址（默认 https://api.focalapi.com，可用 FOCALAPI_BASE_URL）')
    .option('--key <key>', '覆盖 API Key（可用 FOCALAPI_API_KEY）')
    .option('--profile <name>', '使用指定配置档案');

  registerAuth(program);
  registerModels(program);
  registerChat(program);
  registerGen(program);
  registerTask(program);
  registerAudio(program);
  registerUsage(program);
  registerDoctor(program);
  registerConnect(program);
  registerUpdate(program);
  registerRequest(program);

  return program;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  process.exitCode = 0;
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (err) {
    let json = false;
    try {
      json = Boolean(program.opts().json);
    } catch {
      // ignore
    }
    printError(err, { json });
    return 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'));

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  });
}
