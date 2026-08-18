/**
 * focalapi task: inspect task status and continue artifact downloads for video and other task-based capabilities.
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { cancelTask, downloadTaskContent, fetchTask } from '../lib/tasks.js';
import { info, printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

const TASK_ID_HINT =
  'task_id 区分大小写且混有小写 l / 数字 1 / 大写 I（O 与 0 同理），必须逐字复制。若提交时的输出已丢失，先回查当时的 stderr 面包屑（task_id=...），不要盲目重新提交——重复提交会重复扣费。';

function withTaskIdHint(err: unknown): unknown {
  if (err instanceof ApiError && err.status === 404) {
    return new ApiError(err.code, err.message, { status: err.status, hint: TASK_ID_HINT, body: err.body, upstreamCode: err.upstreamCode, requestId: err.requestId });
  }
  return err;
}

export function registerTask(program: Command): void {
  const task = program.command('task').description('任务查询、取消与产物下载（视频等任务制能力）');

  task
    .command('status')
    .description('查询任务状态')
    .argument('<task_id>', '任务 ID')
    .action(async (taskId: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      try {
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
          if (info_.status === 'pending' || info_.status === 'running') {
            info(`如需停止排队中的任务：focalapi task cancel ${taskId}`);
          }
        }
      } catch (err) {
        throw withTaskIdHint(err);
      }
    });

  task
    .command('cancel')
    .description('取消排队中的任务（运行中的任务不可取消；取消后费用自动退还）')
    .argument('<task_id>', '任务 ID')
    .action(async (taskId: string, _opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      await cancelTask(auth.baseUrl, auth.apiKey, taskId);
      if (g.json) {
        printJson({ task_id: taskId, status: 'cancelled', cancelled: true });
      } else {
        info(`✓ 任务 ${taskId} 已取消`);
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
