/**
 * focalapi update：检查 npm 上的最新版本并给出升级指引。
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { info, printJson } from '../lib/output.js';
import { VERSION } from '../lib/version.js';
import type { GlobalOpts } from '../cli.js';

const REGISTRY_URL = 'https://registry.npmjs.org/focalapi-cli/latest';

/** 简单的 x.y.z 版本比较：a>b 返回 1，a<b 返回 -1，相等 0。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function registerUpdate(program: Command): void {
  program
    .command('update')
    .description('检查是否有新版本（只读，不自动升级）')
    .action(async (_opts: unknown, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      let latest: string;
      try {
        const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(8_000) });
        if (res.status === 404) {
          if (g.json) {
            printJson({ current: VERSION, published: false, updateAvailable: false });
          } else {
            info(`当前版本 v${VERSION}；focalapi-cli 尚未发布到 npm，无需更新。`);
          }
          return;
        }
        if (!res.ok) {
          throw new ApiError('network_error', `npm registry 返回 HTTP ${res.status}`);
        }
        const data = (await res.json()) as { version?: string };
        latest = data.version ?? '0.0.0';
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError('network_error', `无法连接 npm registry：${(err as Error)?.message ?? err}`, {
          hint: '检查网络后重试；该命令只做版本检查，不影响本地使用。',
        });
      }

      const updateAvailable = compareVersions(latest, VERSION) > 0;
      if (g.json) {
        printJson({ current: VERSION, latest, published: true, updateAvailable });
        return;
      }
      if (updateAvailable) {
        info(`发现新版本：v${latest}（当前 v${VERSION}）`);
        info('升级：npm i -g focalapi-cli@latest');
      } else {
        info(`已是最新版本（v${VERSION}）。`);
      }
    });
}
