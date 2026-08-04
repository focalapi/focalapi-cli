/**
 * 命令级集成测试：经 main(argv) 走完整命令链路，fetch 用路由 mock。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { mockFetchRouter, setupTestEnv, TOKEN_USAGE_OK, VALID_KEY } from './helpers.js';

const ctx = setupTestEnv();
const BASE = 'https://api.test.local';

function argv(...args: string[]): string[] {
  return ['node', 'focalapi', ...args, '--base-url', BASE, '--key', VALID_KEY];
}

function parseStdoutJson(): Record<string, unknown> {
  return JSON.parse(ctx.takeStdout()) as Record<string, unknown>;
}

describe('auth', () => {
  it('login 验证 key 并写盘；status 读取；logout 删除', async () => {
    vi.stubGlobal('fetch', mockFetchRouter({ '/api/usage/token/': () => TOKEN_USAGE_OK }));

    expect(await main(argv('auth', 'login', '--json'))).toBe(0);
    const loginOut = parseStdoutJson();
    expect(loginOut.success).toBe(true);
    expect(JSON.stringify(loginOut)).not.toContain(VALID_KEY); // 输出必须脱敏
    expect(existsSync(join(ctx.configDir, 'config.json'))).toBe(true);

    expect(await main(['node', 'focalapi', 'auth', 'status', '--json', '--base-url', BASE])).toBe(0);
    const status = parseStdoutJson();
    expect(status.valid).toBe(true);
    expect(status.keySource).toBe('config'); // 来自 login 落盘

    expect(await main(argv('auth', 'logout', '--json'))).toBe(0);
    expect(JSON.parse(readFileSync(join(ctx.configDir, 'config.json'), 'utf-8')).profiles.default).toBeUndefined();
  });

  it('login 遇到无效 key（401）不落盘且报错', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/api/usage/token/': () => new Response(JSON.stringify({ error: { message: 'invalid token' } }), { status: 401 }),
      }),
    );
    expect(await main(argv('auth', 'login', '--json'))).toBe(1);
    expect(existsSync(join(ctx.configDir, 'config.json'))).toBe(false);
    const out = parseStdoutJson() as { error: { code: string } };
    expect(out.error.code).toBe('invalid_api_key');
  });
});

describe('models', () => {
  it('list --filter 过滤 + JSON 输出', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models': () => ({ data: [{ id: 'focal-rehearsal-chat', owned_by: 'synthetic' }, { id: 'gpt-x', owned_by: 'openai' }] }),
      }),
    );
    expect(await main(argv('models', 'list', '--filter', 'rehearsal', '--json'))).toBe(0);
    const out = parseStdoutJson() as { data: { id: string }[] };
    expect(out.data.map((m) => m.id)).toEqual(['focal-rehearsal-chat']);
  });
});

describe('chat', () => {
  const CHAT_OK = {
    choices: [{ message: { role: 'assistant', content: '你好，世界' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };

  it('非流式 --json 输出完整响应', async () => {
    vi.stubGlobal('fetch', mockFetchRouter({ '/v1/chat/completions': () => CHAT_OK }));
    expect(await main(argv('chat', '你好', '-m', 'test-model', '--json', '--no-stream'))).toBe(0);
    const out = parseStdoutJson() as typeof CHAT_OK;
    expect(out.choices[0]!.message!.content).toBe('你好，世界');
  });

  it('缺 model 报错并给出提示', async () => {
    vi.stubGlobal('fetch', mockFetchRouter({}));
    expect(await main(['node', 'focalapi', 'chat', 'hi', '--key', VALID_KEY, '--base-url', BASE, '--no-stream'])).toBe(1);
    expect(ctx.stderr()).toContain('缺少模型参数');
  });

  it('流式聚合 stdout 输出文本', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/chat/completions': () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(new TextEncoder().encode(sse));
                c.close();
              },
            }),
            { status: 200 },
          ),
      }),
    );
    expect(await main(argv('chat', '你好', '-m', 'm', '--stream'))).toBe(0);
    expect(ctx.stdout()).toContain('你好');
  });
});

describe('gen image', () => {
  it('b64_json 结果落盘 + JSON 输出文件列表', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/images/generations': () => ({ created: 1, data: [{ b64_json: png }] }) }),
    );
    const outDir = join(ctx.homeDir, 'img-out');
    expect(await main(argv('gen', 'image', '一只猫', '-m', 'img-model', '-o', outDir, '--json'))).toBe(0);
    const out = parseStdoutJson() as { files: string[] };
    expect(out.files).toHaveLength(1);
    expect(existsSync(out.files[0]!)).toBe(true);
    expect(readFileSync(out.files[0]!).toString()).toBe('fake-png-bytes');
  });

  it('n 超上限（>128）直接拒绝，不发请求', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'image', 'x', '-m', 'm', '--n', '200', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    const out = parseStdoutJson() as { error: { code: string; message: string } };
    expect(out.error.code).toBe('invalid_request');
    expect(out.error.message).toContain('1–128');
  });
});

describe('gen video + task', () => {
  it('--no-wait 立即返回 task_id；task status 归一化状态', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-123': () => ({ task_id: 'task-123', status: 'processing', progress: 0.4 }),
        '/v1/video/generations': () => ({ task_id: 'task-123', status: 'submitted' }),
      }),
    );
    expect(await main(argv('gen', 'video', '海浪', '-m', 'vid-model', '--no-wait', '--json'))).toBe(0);
    expect((parseStdoutJson() as { task_id: string }).task_id).toBe('task-123');

    expect(await main(argv('task', 'status', 'task-123', '--json'))).toBe(0);
    const st = parseStdoutJson() as { status: string; progress: number };
    expect(st.status).toBe('running');
    expect(st.progress).toBe(40);
  });

  it('seconds 超上限（>3600）直接拒绝', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'm', '--seconds', '9999', '--no-wait'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('seconds 以字符串发送（focalapi 任务 DTO 为 string 类型）', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 't-str', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv('gen', 'video', '海浪', '-m', 'vid', '--seconds', '5', '--no-wait', '--json'))).toBe(0);
    expect(capturedBody?.seconds).toBe('5');
  });
});

describe('search / embed / rerank / usage', () => {
  it('search --json 透传上游响应', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/alpha/search': () => ({ results: [{ title: 'T', url: 'https://x.com' }] }) }),
    );
    expect(await main(argv('search', '今日新闻', '-m', 'search-model', '--json'))).toBe(0);
    expect((parseStdoutJson() as { results: unknown[] }).results).toHaveLength(1);
  });

  it('embed --json 返回向量', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/embeddings': () => ({ data: [{ embedding: [0.1, 0.2] }], usage: { total_tokens: 2 } }) }),
    );
    expect(await main(argv('embed', '文本', '-m', 'emb-model', '--json'))).toBe(0);
    expect((parseStdoutJson() as { data: { embedding: number[] }[] }).data[0]!.embedding).toEqual([0.1, 0.2]);
  });

  it('rerank --json 返回排序结果', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/rerank': () => ({ results: [{ index: 1, relevance_score: 0.9 }] }) }),
    );
    expect(await main(argv('rerank', '-m', 'rr', '--query', 'q', '--docs', '["a","b"]', '--json'))).toBe(0);
    expect((parseStdoutJson() as { results: unknown[] }).results).toHaveLength(1);
  });

  it('usage --json 汇总 token 与 billing', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/api/usage/token/': () => TOKEN_USAGE_OK,
        '/v1/dashboard/billing/usage': () => ({ total_usage: 12.34 }),
      }),
    );
    expect(await main(argv('usage', '--json'))).toBe(0);
    const out = parseStdoutJson() as { token: { total_available: number }; billing: { total_usage: number } };
    expect(out.token.total_available).toBe(750000);
    expect(out.billing.total_usage).toBe(12.34);
  });
});

describe('doctor', () => {
  it('链路正常时全 ✓，退出码 0', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models': () => ({ data: [{ id: 'focal-rehearsal-chat' }] }),
        '/v1/chat/completions': () => ({ choices: [{ message: { content: 'pong' } }] }),
        '/api/usage/token/': () => TOKEN_USAGE_OK,
      }),
    );
    expect(await main(argv('doctor', '--json'))).toBe(0);
    const out = parseStdoutJson() as { ok: boolean; checks: { ok: boolean }[] };
    expect(out.ok).toBe(true);
    expect(out.checks).toHaveLength(4);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('无 key 时报告失败项且退出码非零（不抛异常崩溃）', async () => {
    vi.stubGlobal('fetch', mockFetchRouter({}));
    // 不传 --key，无 env 无 config
    expect(await main(['node', 'focalapi', 'doctor', '--json', '--base-url', BASE])).toBe(0);
    const out = parseStdoutJson() as { ok: boolean; checks: { ok: boolean }[] };
    expect(out.ok).toBe(false);
    expect(out.checks[0]!.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
