/**
 * 输出层：人读 pretty / 机读 JSON 双模式。
 *
 * 约定：JSON 模式下 stdout 只输出 JSON（无颜色、无进度），诊断信息一律走 stderr，
 * 这样 Agent 可以 `focalapi ... --json | jq` 安全串联。
 */

import { ApiError } from './errors.js';

export interface OutputOptions {
  json?: boolean;
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

/** 脱敏 API Key：sk-ab***wxyz。短 key 全脱敏。 */
export function maskKey(key: string): string {
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 5)}***${key.slice(-4)}`;
}

/** 递归脱敏任意对象中的 apiKey/authorization 字段，防止错误体泄露。 */
export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, (m) => maskKey(m));
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/api[-_]?key|authorization|token/i.test(k) && typeof v === 'string') {
        // 敏感字段：先按 sk- 模式局部脱敏（如 "Bearer sk-xxx"），没有 sk- 片段则整体脱敏
        const replaced = v.replace(/sk-[A-Za-z0-9_-]{8,}/g, (m) => maskKey(m));
        out[k] = replaced !== v ? replaced : maskKey(v);
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(sanitize(data), null, 2) + '\n');
}

export function info(message: string): void {
  process.stderr.write(message + '\n');
}

export function warn(message: string): void {
  process.stderr.write(`警告：${message}\n`);
}

/** 统一错误出口：JSON 模式输出结构化错误，否则输出人读格式。exit code 由调用方决定。 */
export function printError(err: unknown, opts?: OutputOptions): void {
  if (err instanceof ApiError) {
    if (opts?.json) {
      printJson(err.toJSON());
    } else {
      process.stderr.write(`错误 [${err.code}]：${err.message}\n`);
      const hint = err.hint;
      if (hint) {
        process.stderr.write(`提示：${hint}\n`);
      }
    }
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (opts?.json) {
    printJson({ error: { code: 'internal_error', message } });
  } else {
    process.stderr.write(`内部错误：${message}\n`);
  }
}

/** 表格输出（pretty 模式专用）。列宽按内容自适应。 */
export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ''))),
  );
  const line = (cells: string[]): string =>
    cells.map((c, i) => c + ' '.repeat(Math.max(0, (widths[i] ?? 0) - displayWidth(c)))).join('  ');
  process.stdout.write(line(headers) + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
  for (const row of rows) {
    process.stdout.write(line(row) + '\n');
  }
}

/** 中文等宽计算：CJK 字符按 2 列宽。 */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    width += /[⺀-鿿豈-﫿︰-﹏＀-￠￡-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

/** 字节数 → 人读单位。 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
