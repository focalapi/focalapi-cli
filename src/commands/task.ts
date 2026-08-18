/**
 * focalapi task: inspect task status and continue artifact downloads for video and other task-based capabilities.
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { cancelTask, downloadTaskContent, fetchTask, listTasks, pollTask } from '../lib/tasks.js';
import { info, printJson, printTable } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

const TASK_ID_HINT =
  'task_id 区分大小写且混有小写 l / 数字 1 / 大写 I（O 与 0 同理），必须逐字复制。若提交时的输出已丢失，先运行 focalapi task list 找回最近的任务，不要盲目重新提交——重复提交会重复扣费。';

function withTaskIdHint(err: unknown): unknown {
  if (err instanceof ApiError && err.status === 404) {
    return new ApiError(err.code, err.message, { status: err.status, hint: TASK_ID_HINT, body: err.body, upstreamCode: err.upstreamCode, requestId: err.requestId });
  }
  return err;
}

function formatElapsed(seconds?: number): string {
  if (!seconds || seconds < 0) return '-';
  if (seconds < 90) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function taskAgeSeconds(createdAt?: number): number | undefined {
  if (!createdAt) return undefined;
  return Math.max(0, Math.floor(Date.now() / 1000 - createdAt));
}

export function registerTask(program: Command): void {
  const task = program.command('task').description('任务查询、取消与产物下载（视频等任务制能力）');

  task
    .command('status')
    .description('查询任务状态；--wait 内置轮询等待终态，无需自写轮询脚本')
    .argument('<task_id>', '任务 ID')
    .option('--wait', '等待任务到达终态（成功 / 失败 / 取消）后再返回')
    .option('--timeout <minutes>', '--wait 的最长等待分钟', (v) => Number.parseInt(v, 10), 30)
    .option('--poll-interval <ms>', '--wait 的轮询间隔毫秒', (v) => Number.parseInt(v, 10), 5_000)
    .option('--download', '--wait 成功后自动下载产物（等价于接着执行 task download）')
    .option('-o, --out <dir>', '--download 的输出目录', 'focalapi-out')
    .action(async (taskId: string, opts: { wait?: boolean; timeout: number; pollInterval: number; download?: boolean; out: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      try {
        let info_ = await fetchTask(auth.baseUrl, auth.apiKey, taskId);
        if (opts.wait && info_.status !== 'success' && info_.status !== 'failed' && info_.status !== 'cancelled') {
          info_ = await pollTask(auth.baseUrl, auth.apiKey, taskId, {
            intervalMs: opts.pollInterval,
            timeoutMs: opts.timeout * 60_000,
            onUpdate: (t) => {
              if (!g.json) {
                const elapsed = formatElapsed(taskAgeSeconds(t.createdAt));
                info(`  状态：${t.rawStatus || t.status}${t.progress !== undefined ? `（${t.progress}%）` : ''}，已耗时 ${elapsed}`);
              }
            },
          });
        }
        const elapsed = taskAgeSeconds(info_.createdAt);
        let file: string | undefined;
        if (opts.download && info_.status === 'success') {
          file = await downloadTaskContent(auth.baseUrl, auth.apiKey, taskId, opts.out);
        }
        if (g.json) {
          printJson({
            task_id: taskId,
            status: info_.status,
            raw_status: info_.rawStatus,
            progress: info_.progress,
            ...(elapsed !== undefined ? { elapsed_seconds: elapsed } : {}),
            ...(file ? { file } : {}),
            raw: info_.raw,
          });
        } else {
          printTable(
            ['字段', '值'],
            [
              ['任务 ID', taskId],
              ['状态', `${info_.status}${info_.rawStatus && info_.rawStatus !== info_.status ? `（上游：${info_.rawStatus}）` : ''}`],
              ['进度', info_.progress !== undefined ? `${info_.progress}%` : '-'],
              ['已耗时', formatElapsed(elapsed)],
            ],
          );
          if (file) {
            info(`✓ ${file}`);
          } else if (info_.status === 'success') {
            info(`产物下载：focalapi task download ${taskId}`);
          }
          if (info_.status === 'pending' || info_.status === 'running') {
            info(`等待完成：focalapi task status ${taskId} --wait；排队中可取消：focalapi task cancel ${taskId}`);
          }
        }
      } catch (err) {
        throw withTaskIdHint(err);
      }
    });

  task
    .command('list')
    .description('列出当前 Key 的近期任务（提交输出丢失时用它找回 task_id）')
    .option('--status <status>', '按状态过滤：queued、in_progress、completed、failed、cancelled')
    .option('--action <action>', '按任务类型过滤，如 generate、image_generation')
    .option('--limit <n>', '每页数量（1–100）', (v) => Number.parseInt(v, 10), 20)
    .option('--offset <n>', '偏移量', (v) => Number.parseInt(v, 10), 0)
    .action(async (opts: { status?: string; action?: string; limit: number; offset: number }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const items = await listTasks(auth.baseUrl, auth.apiKey, opts);
      if (g.json) {
        printJson({ object: 'list', data: items });
      } else if (items.length === 0) {
        info('当前 Key 暂无任务记录。');
      } else {
        printTable(
          ['任务 ID', '模型', '状态', '进度', '已耗时', '额度'],
          items.map((item) => [
            item.task_id,
            item.model ?? '-',
            item.status ?? '-',
            item.progress !== undefined ? `${item.progress}%` : '-',
            formatElapsed(item.created_at ? Math.max(0, Math.floor(Date.now() / 1000 - item.created_at)) : undefined),
            item.quota !== undefined ? String(item.quota) : '-',
          ]),
        );
        info('续取：focalapi task status <task_id> --wait');
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
