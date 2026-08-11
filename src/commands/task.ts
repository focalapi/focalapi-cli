/**
 * focalapi task: inspect task status and continue artifact downloads for video and other task-based capabilities.
 */

import { Command } from 'commander';
import { resolveAuth } from '../lib/config.js';
import { downloadTaskContent, fetchTask } from '../lib/tasks.js';
import { info, printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

export function registerTask(program: Command): void {
  const task = program.command('task').description('任务查询与产物下载（视频等任务制能力）');

  task
    .command('status')
    .description('查询任务状态')
    .argument('<task_id>', '任务 ID')
    .action(async (taskId: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const info_ = await fetchTask(auth.baseUrl, auth.apiKey, taskId);
      if (g.json) {
        printJson({ task_id: taskId, status: info_.status, raw_status: info_.rawStatus, progress: info_.progress, raw: info_.raw });
      } else {
        printTable(
          ['字段', '值'],
          [
            ['任务 ID', taskId],
            ['状态', `${info_.status}${info_.rawStatus && info_.rawStatus !== info_.status ? `（上游：${info_.rawStatus}）` : ''}`],
            ['进度', info_.progress !== undefined ? `${info_.progress}%` : '-'],
          ],
        );
        if (info_.status === 'success') {
          info(`产物下载：focalapi task download ${taskId}`);
        }
      }
    });

  task
    .command('download')
    .description('下载任务产物（经 focalapi 内容代理，无需上游签名 URL）')
    .argument('<task_id>', '任务 ID')
    .option('-o, --out <dir>', '输出目录', 'focalapi-out')
    .action(async (taskId: string, opts: { out: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const filePath = await downloadTaskContent(auth.baseUrl, auth.apiKey, taskId, opts.out);
      if (g.json) {
        printJson({ task_id: taskId, file: filePath });
      } else {
        info(`✓ ${filePath}`);
      }
    });
}
