/**
 * Output layer with human-readable pretty mode and machine-readable JSON mode.
 *
 * In JSON mode, stdout contains JSON only, with no color or progress output. Diagnostics always
 * go to stderr so Agents can safely compose `focalapi ... --json | jq`.
 */

import { ApiError, ERROR_HINTS } from './errors.js';

export interface OutputOptions {
  json?: boolean;
}

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

/**
 * API keys use an sk- prefix followed by a long alphanumeric value (48 characters in new-api).
 * Require a left boundary and sufficient length to avoid redacting task IDs or filenames that
 * happen to contain an "sk-" fragment, such as "sk-task_" inside "task-task_nW4RVxsd...mp4".
 */
const KEY_PATTERN = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20,}/g;

/** Redact an API key as sk-ab***wxyz; redact short keys completely. */
export function maskKey(key: string): string {
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 5)}***${key.slice(-4)}`;
}

/** Recursively redact apiKey and authorization fields to prevent error-response leakage. */
export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(KEY_PATTERN, (m) => maskKey(m));
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/api[-_]?key|authorization|token/i.test(k) && typeof v === 'string') {
        // Redact sk- fragments such as "Bearer sk-xxx" first; redact the whole value when none exists.
        const replaced = v.replace(KEY_PATTERN, (m) => maskKey(m));
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

/** Unified error output: structured JSON in JSON mode, otherwise human-readable text. The caller sets the exit code. */
export function printError(errInput: unknown, opts?: OutputOptions): void {
  if (errInput instanceof ApiError) {
    // Fall back to the per-code hint table so codes raised inside the HTTP layer
    // (for example capacity_exhausted) always ship a next action to the caller.
    const err = !errInput.hint && ERROR_HINTS[errInput.code]
      ? new ApiError(errInput.code, errInput.message, {
          status: errInput.status,
          hint: ERROR_HINTS[errInput.code],
          body: errInput.body,
          upstreamCode: errInput.upstreamCode,
          requestId: errInput.requestId,
        })
      : errInput;
    if (opts?.json) {
      printJson(err.toJSON());
    } else {
      process.stderr.write(`错误 [${err.code}]：${err.message}\n`);
      const hint = err.hint;
      if (hint) {
        process.stderr.write(`提示：${hint}\n`);
      }
      if (err.upstreamCode) {
        process.stderr.write(`上游代码：${err.upstreamCode}\n`);
      }
      if (err.requestId) {
        process.stderr.write(`请求 ID：${err.requestId}\n`);
      }
    }
    return;
  }
  const message = errInput instanceof Error ? errInput.message : String(errInput);
  if (opts?.json) {
    printJson({ error: { code: 'internal_error', message } });
  } else {
    process.stderr.write(`内部错误：${message}\n`);
  }
}

/** Render a table in pretty mode with content-aware column widths. */
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

/** Measure terminal width with CJK characters occupying two columns. */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) {
    width += /[⺀-鿿豈-﫿︰-﹏＀-￠￡-￦]/.test(ch) ? 2 : 1;
  }
  return width;
}

/** Convert a byte count to a human-readable unit. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
