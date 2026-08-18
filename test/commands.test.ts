/**
 * Command-level integration tests that exercise the complete main(argv) path with routed fetch mocks.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
    expect(JSON.stringify(loginOut)).not.toContain(VALID_KEY); // Output must redact the key.
    expect(existsSync(join(ctx.configDir, 'config.json'))).toBe(true);

    expect(await main(['node', 'focalapi', 'auth', 'status', '--json', '--base-url', BASE])).toBe(0);
    const status = parseStdoutJson();
    expect(status.valid).toBe(true);
    expect(status.keySource).toBe('config'); // Written to configuration by login.

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

  it('get 显示服务端下发的已核实模型契约，JSON 结构可供 Agent 使用', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models/seedream-4-5-251128': () => ({
          id: 'seedream-4-5-251128',
          object: 'model',
          owned_by: 'comfy-cloud',
          supported_endpoint_types: ['image-generation'],
          supported_params: [
            { name: 'prompt', type: 'string', required: true, description: 'Text prompt.' },
            { name: 'size', type: 'string', default: '2k', description: 'Output size.' },
            { name: 'n', type: 'integer', default: 1, minimum: 1, maximum: 10, description: 'Image count.' },
          ],
        }),
      }),
    );
    expect(await main(argv('models', 'get', 'seedream-4-5-251128', '--json'))).toBe(0);
    const out = parseStdoutJson() as { supported_endpoint_types: string[]; supported_params: { name: string; minimum?: number; maximum?: number }[] };
    expect(out.supported_endpoint_types).toContain('image-generation');
    expect(out.supported_params.map((parameter) => parameter.name)).toEqual(expect.arrayContaining(['prompt', 'size', 'n']));
    expect(new Set(out.supported_params.map((parameter) => parameter.name)).size).toBe(out.supported_params.length);
    const n = out.supported_params.find((parameter) => parameter.name === 'n');
    expect(n).toMatchObject({ minimum: 1, maximum: 10 });
  });

  it('get 的人读输出将 null 显示为缺失值，不把对象塞为字符串 null', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/models/model-with-null': () => ({ id: 'model-with-null', owned_by: null, description: null }) }),
    );
    expect(await main(argv('models', 'get', 'model-with-null'))).toBe(0);
    expect(ctx.stdout()).toContain('-');
    expect(ctx.stdout()).not.toContain('"null"');
  });
  it('search can filter the live list by keyword and endpoint type', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models': () => ({ data: [
          { id: 'grok-imagine-image', supported_endpoint_types: ['image-generation'] },
          { id: 'grok-imagine-video', supported_endpoint_types: ['video-generation'] },
        ] }),
      }),
    );
    expect(await main(argv('models', 'search', 'grok', '--endpoint', 'video-generation', '--json'))).toBe(0);
    const out = parseStdoutJson() as { data: { id: string }[] };
    expect(out.data.map((model) => model.id)).toEqual(['grok-imagine-video']);
  });

  it('get turns an HTTP 200 model error envelope into a CLI error', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/models/list-only-model': () => ({ error: { code: 'model_not_found', message: 'model unavailable' } }) }),
    );
    expect(await main(argv('models', 'get', 'list-only-model', '--json'))).toBe(1);
    const out = parseStdoutJson() as { error: { code: string; message: string } };
    expect(out.error).toMatchObject({ code: 'invalid_request', message: 'model unavailable' });
  });

  it('resolve 按实时列表和详情契约选择默认创作模型，不靠名称猜端点', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models/dreamina-seedance-2-5-260628': () => ({
          id: 'dreamina-seedance-2-5-260628',
          owned_by: 'bytedance',
          supported_endpoint_types: ['video-generation'],
          supported_params: [{ name: 'duration', type: 'integer', minimum: 4, maximum: 30 }],
        }),
        '/v1/models': () => ({ data: [
          // The list summary intentionally exposes only openai; resolve must read details before determining modality.
          { id: 'dreamina-seedance-2-5-260628', supported_endpoint_types: ['openai'] },
          { id: 'kling-3.0', supported_endpoint_types: ['openai'] },
        ] }),
      }),
    );
    expect(await main(argv('models', 'resolve', 'video', '--json'))).toBe(0);
    const out = parseStdoutJson() as { model: { id: string }; endpoint_type: string; next_command: string };
    expect(out.model.id).toBe('dreamina-seedance-2-5-260628');
    expect(out.endpoint_type).toBe('video-generation');
    expect(out.next_command).toContain('focalapi gen video');
  });
});

describe('request', () => {
  it('GET uses configured auth and returns a stable JSON envelope', async () => {
    let capturedMethod: string | undefined;
    let capturedAuthorization: string | null | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models?limit=2': (init) => {
          capturedMethod = init?.method;
          capturedAuthorization = new Headers(init?.headers).get('authorization');
          return { data: [{ id: 'model-1' }] };
        },
      }),
    );

    expect(await main(argv('request', 'get', '/v1/models?limit=2', '--json'))).toBe(0);
    const out = parseStdoutJson() as { method: string; path: string; status: number; data: { data: { id: string }[] } };
    expect(capturedMethod).toBe('GET');
    expect(capturedAuthorization).toBe(`Bearer ${VALID_KEY}`);
    expect(out).toMatchObject({ method: 'GET', path: '/v1/models?limit=2', status: 200 });
    expect(out.data.data[0]!.id).toBe('model-1');
  });

  it('rejects writes and external URLs before sending a request', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);

    expect(await main(argv('request', 'post', '/v1/models', '--json'))).toBe(1);
    expect((parseStdoutJson() as { error: { code: string } }).error.code).toBe('invalid_request');
    expect(await main(argv('request', 'get', 'https://example.com/', '--json'))).toBe(1);
    expect((parseStdoutJson() as { error: { code: string } }).error.code).toBe('invalid_request');
    expect(spy).not.toHaveBeenCalled();
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
  it('省略 --model 时自动选择实时可用默认模型并只生成一次', async () => {
    const png = Buffer.from('auto-selected-image').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models/seedream-5-0-260128': () => ({
          id: 'seedream-5-0-260128',
          supported_endpoint_types: ['image-generation'],
          supported_params: [{ name: 'prompt', type: 'string', required: true }],
        }),
        '/v1/models': () => ({ data: [{ id: 'seedream-5-0-260128', supported_endpoint_types: ['openai'] }] }),
        '/v1/images/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { created: 1, data: [{ b64_json: png }] };
        },
      }),
    );
    const outDir = join(ctx.homeDir, 'auto-image-out');
    expect(await main(argv('gen', 'image', '产品主视觉', '-o', outDir, '--json'))).toBe(0);
    const out = parseStdoutJson() as { model: string; files: string[] };
    expect(out.model).toBe('seedream-5-0-260128');
    expect(capturedBody?.model).toBe('seedream-5-0-260128');
    expect(out.files).toHaveLength(1);
  });

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

  it('将已公开的图像编辑参数按原字段发给 API', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/images/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { created: 1, data: [{ b64_json: png }] };
        },
      }),
    );

    const outDir = join(ctx.homeDir, 'image-edit-out');
    expect(await main(argv('gen', 'image', 'edit', '-m', 'gpt-image-2', '--image', 'https://example.com/source.png', '--mask', 'https://example.com/mask.png', '--response-format', 'b64_json', '-o', outDir, '--json'))).toBe(0);
    expect(capturedBody).toMatchObject({
      image: ['https://example.com/source.png'],
      mask: 'https://example.com/mask.png',
      response_format: 'b64_json',
    });
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

  it('--no-wait 请求持久图像任务，并可由 task status 查询', async () => {
    let preferHeader: string | null = null;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-image-123': () => new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }),
        '/v1/images/generations/task-image-123': () => ({ object: 'image_generation_task', id: 'task-image-123', status: 'in_progress' }),
        '/v1/images/generations': (init) => {
          preferHeader = new Headers(init?.headers).get('Prefer');
          return { object: 'image_generation_task', id: 'task-image-123', status: 'queued' };
        },
      }),
    );
    expect(await main(argv('gen', 'image', '一只猫', '-m', 'img-model', '--no-wait', '--json'))).toBe(0);
    expect(preferHeader).toBe('respond-async');
    expect((parseStdoutJson() as { task_id: string }).task_id).toBe('task-image-123');

    expect(await main(argv('task', 'status', 'task-image-123', '--json'))).toBe(0);
    expect((parseStdoutJson() as { status: string }).status).toBe('running');
  });

  it('Seedream 4.5 的不支持尺寸在发送前拒绝，并说明像素范围', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'image', 'x', '-m', 'seedream-4-5-251128', '--size', '1024x1024', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    expect((parseStdoutJson() as { error: { message: string } }).error.message).toContain('3.69');
  });

  it('Gemini 图像走原生 generateContent 端点，并提取 inlineData 文件', async () => {
    const png = Buffer.from('gemini-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1beta/models/gemini-3.1-flash-image:generateContent': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] };
        },
      }),
    );
    const outDir = join(ctx.homeDir, 'gemini-out');
    expect(await main(argv('gen', 'gemini-image', '一只猫', '-m', 'gemini-3.1-flash-image', '--aspect-ratio', '16:9', '--image-size', '2K', '--response-modalities', 'IMAGE', '-o', outDir, '--json'))).toBe(0);
    expect(capturedBody).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: '一只猫' }] }],
      generationConfig: { candidateCount: 1, responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio: '16:9', imageSize: '2K' } } },
    });
    const out = parseStdoutJson() as { files: string[] };
    expect(readFileSync(out.files[0]!).toString()).toBe('gemini-png-bytes');
  });
  it('sends documented Seedream watermark, format, and prompt optimization fields', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/images/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { created: 1, data: [{ b64_json: png }] };
        },
      }),
    );
    const outDir = join(ctx.homeDir, 'seedream-options-out');
    expect(await main(argv(
      'gen', 'image', 'x', '-m', 'seedream-5-0-260128', '--size', '3k', '--watermark', 'false',
      '--output-format', 'jpeg', '--optimize-prompt', 'disabled', '-o', outDir, '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      size: '3k', watermark: false, output_format: 'jpeg', optimize_prompt_options: { thinking: 'disabled' },
    });
  });

  it('sends Grok image aspect ratio, resolution, and seed as native fields', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/images/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { created: 1, data: [{ b64_json: png }] };
        },
      }),
    );
    const outDir = join(ctx.homeDir, 'grok-image-options-out');
    expect(await main(argv(
      'gen', 'image', 'x', '-m', 'grok-imagine-image-quality', '--aspect-ratio', '16:9', '--resolution', '2k', '--seed', '7', '-o', outDir, '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ aspect_ratio: '16:9', resolution: '2k', seed: 7 });
  });

  it('sends current Krea fields and rejects unsupported output counts before requesting', async () => {
    const png = Buffer.from('fake-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/images/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { created: 1, data: [{ b64_json: png }] };
        },
      }),
    );
    const outDir = join(ctx.homeDir, 'krea-image-options-out');
    expect(await main(argv(
      'gen', 'image', 'x', '-m', 'krea-2-large', '--aspect-ratio', '4:3', '--resolution', '1k',
      '--seed', '7', '--creativity', 'high', '--style-references', '[{"url":"https://example.com/style.png","strength":0.7}]',
      '--moodboards', '[{"uuid":"board-1","strength":0.5}]', '-o', outDir, '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      aspect_ratio: '4:3', resolution: '1k', seed: 7, creativity: 'high',
      image_style_references: [{ url: 'https://example.com/style.png', strength: 0.7 }],
      moodboards: [{ uuid: 'board-1', strength: 0.5 }],
    });

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'image', 'x', '-m', 'krea-2-large', '--n', '2', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('gen gemini-image documented fields', () => {
  it('maps image, system, seed, and Lite sampling fields', async () => {
    const png = Buffer.from('gemini-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1beta/models/gemini-3.1-flash-lite-image:generateContent': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] };
        },
      }),
    );

    const outDir = join(ctx.homeDir, 'gemini-fields-out');
    expect(await main(argv(
      'gen', 'gemini-image', 'draw it', '-m', 'gemini-3.1-flash-lite-image',
      '--image', 'data:image/png;base64,ZmFrZQ==', '--system', 'Be concise.', '--seed', '7',
      '--thinking-level', 'HIGH', '--temperature', '1.2', '--top-p', '0.8', '-o', outDir, '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'draw it' }, { inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] }],
      systemInstruction: { parts: [{ text: 'Be concise.' }] },
      generationConfig: {
        candidateCount: 1,
        seed: 7,
        thinkingConfig: { thinkingLevel: 'HIGH' },
        temperature: 1.2,
        topP: 0.8,
      },
    });
  });

  it('3.1-flash accepts the extended ratio surface and sampling params; 2.5-flash enforces its reference limits', async () => {
    const png = Buffer.from('gemini-png-bytes').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1beta/models/gemini-3.1-flash-image:generateContent': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] };
        },
      }),
    );
    expect(await main(argv(
      'gen', 'gemini-image', 'x', '-m', 'gemini-3.1-flash-image',
      '--aspect-ratio', '1:4', '--thinking-level', 'HIGH', '-o', join(ctx.homeDir, 'g31-out'), '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } });

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    // 2.5-flash: at most 1 reference image, and it must be an inline data URI.
    expect(await main(argv(
      'gen', 'gemini-image', 'x', '-m', 'gemini-2.5-flash-image',
      '--image', 'data:image/png;base64,ZmFrZQ==', 'data:image/png;base64,ZmFrZQ==', '--json',
    ))).toBe(1);
    expect(await main(argv(
      'gen', 'gemini-image', 'x', '-m', 'gemini-2.5-flash-image', '--image', 'https://example.com/a.png', '--json',
    ))).toBe(1);
    // Sampling params stay rejected on 2.5-flash.
    expect(await main(argv(
      'gen', 'gemini-image', 'x', '-m', 'gemini-2.5-flash-image', '--thinking-level', 'HIGH', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('task cancel + capacity signal', () => {
  it('cancel issues DELETE and reports the cancelled terminal state', async () => {
    let capturedMethod: string | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-cancel-1': (init) => {
          capturedMethod = init?.method;
          return { id: 'task-cancel-1', status: 'cancelled', cancelled: true };
        },
      }),
    );
    expect(await main(argv('task', 'cancel', 'task-cancel-1', '--json'))).toBe(0);
    expect(capturedMethod).toBe('DELETE');
    expect((parseStdoutJson() as { status: string; cancelled: boolean })).toMatchObject({ status: 'cancelled', cancelled: true });
  });

  it('cancel surfaces the running-task 409 contract with the next action', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-running': () => new Response(
          JSON.stringify({ error: { message: 'task is already running and cannot be cancelled', type: 'invalid_request_error', code: 'task_already_running' } }),
          { status: 409 },
        ),
      }),
    );
    expect(await main(argv('task', 'cancel', 'task-running', '--json'))).toBe(1);
    const out = parseStdoutJson() as { error: { code: string; hint?: string } };
    expect(out.error.code).toBe('task_already_running');
    expect(out.error.hint).toContain('focalapi task status task-running');
  });

  it('task download exposes both file and files for parser compatibility', async () => {
    const png = Buffer.from('download-bytes').toString('base64');
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/videos/task-dl-1/content': () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
      }),
    );
    const outDir = join(ctx.homeDir, 'task-dl-out');
    expect(await main(argv('task', 'download', 'task-dl-1', '-o', outDir, '--json'))).toBe(0);
    const out = parseStdoutJson() as { file: string; files: string[] };
    expect(out.file).toBeTruthy();
    expect(out.files).toEqual([out.file]);
  });

  it('turns the 503 capacity_exhausted signal into a retryable error code', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': () => new Response(
          JSON.stringify({ error: { message: 'creative capacity exhausted, retry later', type: 'server_error', code: 'capacity_exhausted' } }),
          { status: 503, headers: { 'retry-after': '10' } },
        ),
      }),
    );
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--no-wait', '--json'))).toBe(1);
    const out = parseStdoutJson() as { error: { code: string; hint?: string } };
    expect(out.error.code).toBe('capacity_exhausted');
    expect(out.error.hint).toContain('重试');
  });
});

describe('gen omni-video', () => {
  it('uses the native Interactions API, retains the official model ID, and saves inline video', async () => {
    const video = Buffer.from('gemini-omni-video').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1beta/interactions': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return {
            id: 'interaction-123',
            steps: [{ content: [{ type: 'video', mime_type: 'video/mp4', data: video }] }],
          };
        },
      }),
    );

    const outDir = join(ctx.homeDir, 'gemini-omni-out');
    expect(await main(argv(
      'gen', 'omni-video', 'a dancing robot', '--image', 'data:image/png;base64,ZmFrZQ==',
      '--aspect-ratio', '9:16', '--task', 'image_to_video', '-o', outDir, '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      model: 'gemini-omni-flash-preview',
      input: [{ type: 'image', mime_type: 'image/png', data: 'ZmFrZQ==' }, { type: 'text', text: 'a dancing robot' }],
      response_format: { type: 'video', aspect_ratio: '9:16' },
      generation_config: { video_config: { task: 'image_to_video' } },
    });
    const out = parseStdoutJson() as { interaction_id: string; file: string };
    expect(out.interaction_id).toBe('interaction-123');
    expect(readFileSync(out.file).toString()).toBe('gemini-omni-video');
  });

  it('rejects non-data-URI image input before making an API request', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'omni-video', 'x', '--image', 'https://example.com/image.png', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('gen video + task', () => {
  it('省略 --model 时自动选择 Seedance 默认模型并返回明确续取命令', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/models/dreamina-seedance-2-5-260628': () => ({
          id: 'dreamina-seedance-2-5-260628',
          supported_endpoint_types: ['video-generation'],
          supported_params: [{ name: 'duration', type: 'integer', minimum: 4, maximum: 30 }],
        }),
        '/v1/models': () => ({ data: [{ id: 'dreamina-seedance-2-5-260628', supported_endpoint_types: ['openai'] }] }),
        '/v1/video/generations': () => ({ task_id: 'auto-video-1', status: 'submitted' }),
      }),
    );
    expect(await main(argv('gen', 'video', '海浪', '--no-wait', '--json'))).toBe(0);
    const out = parseStdoutJson() as { model: string; task_id: string; next_command: string };
    expect(out).toMatchObject({ model: 'dreamina-seedance-2-5-260628', task_id: 'auto-video-1' });
    expect(out.next_command).toBe('focalapi task status auto-video-1 --json');
  });

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
    expect(capturedBody?.duration).toBe(5);
    expect(capturedBody?.seconds).toBeUndefined();
  });

  it('Seedance 原生参数进入 metadata，并在本地拒绝不支持的分辨率', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'seedance-1', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv('gen', 'video', '海浪', '-m', 'dreamina-seedance-2-0-260128', '--seconds', '5', '--resolution', '720p', '--ratio', '16:9', '--generate-audio', 'true', '--no-wait', '--json'))).toBe(0);
    expect(capturedBody?.duration).toBe(5);
    expect(capturedBody?.metadata).toMatchObject({ resolution: '720p', ratio: '16:9', generate_audio: true });

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-0-fast-260128', '--resolution', '1080p', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();

    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-0-260128', '--priority', '10', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-0-260128', '--service-tier', 'priority', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('将 Seedance 任务控制参数和图生视频输入映射到公开的字段', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'seedance-controls', status: 'submitted' };
        },
      }),
    );

    expect(await main(argv(
      'gen', 'video', '海浪', '-m', 'dreamina-seedance-2-0-260128', '--image', 'https://example.com/frame.png',
      '--generate-audio', 'false', '--callback-url', 'https://example.com/callback',
      '--execution-expires-after', '7200', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      images: ['https://example.com/frame.png'],
      metadata: {
        generate_audio: false,
        callback_url: 'https://example.com/callback',
        execution_expires_after: 7200,
      },
    });

    // priority is rejected by the platform (F-8.1 channel limitation) — the
    // CLI intercepts it locally instead of forwarding an invalid request.
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'dreamina-seedance-2-0-260128', '--priority', '4', '--no-wait', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
  it('uses aspect-ratio and seed for Grok video, and accepts 30 seconds for Seedance 2.5', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'grok-video', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--seconds', '6', '--resolution', '1080p',
      '--aspect-ratio', '16:9', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ duration: 6, metadata: { resolution: '1080p', ratio: '16:9' } });

    // seed is rejected by the grok video contract (F-9.1) — local intercept.
    const grokSpy = mockFetchRouter({});
    vi.stubGlobal('fetch', grokSpy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--seed', '7', '--no-wait', '--json',
    ))).toBe(1);
    expect(grokSpy).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', mockFetchRouter({ '/v1/video/generations': () => ({ task_id: 'seedance-25', status: 'submitted' }) }));
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-5-260628', '--seconds', '30', '--resolution', '1080p', '--no-wait', '--json'))).toBe(0);
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-5-260628', '--seconds', '31', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps Grok video modes: --image is r2v (capped at 720p), --first-frame is i2v', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'grok-mode', status: 'submitted' };
        },
      }),
    );
    // r2v with references: 720p passes, images array is the reference channel.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--seconds', '6', '--resolution', '720p',
      '--image', 'https://example.com/a.png', 'https://example.com/b.png', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ images: ['https://example.com/a.png', 'https://example.com/b.png'] });

    // i2v via --first-frame keeps 1080p and sends the string image field.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--seconds', '6', '--resolution', '1080p',
      '--first-frame', 'https://example.com/frame.png', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ image: 'https://example.com/frame.png' });

    // Legacy Grok video is image-to-video only; --first-frame still works there.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video', '--seconds', '6',
      '--first-frame', 'https://example.com/frame.png', '--no-wait', '--json',
    ))).toBe(0);

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    // r2v mode caps at 720p — 1080p must be intercepted locally.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--resolution', '1080p',
      '--image', 'https://example.com/a.png', '--no-wait', '--json',
    ))).toBe(1);
    // r2v supports at most 7 references.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5',
      '--image', ...Array.from({ length: 8 }, (_, i) => `https://example.com/${i}.png`), '--no-wait', '--json',
    ))).toBe(1);
    // Legacy Grok rejects reference images outright.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video', '--image', 'https://example.com/a.png', '--no-wait', '--json',
    ))).toBe(1);
    // --image and --first-frame are mutually exclusive.
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--image', 'https://example.com/a.png',
      '--first-frame', 'https://example.com/b.png', '--no-wait', '--json',
    ))).toBe(1);
    // Grok video rejects generate_audio and watermark (explicit upstream 400s).
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--generate-audio', 'true', '--no-wait', '--json',
    ))).toBe(1);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--watermark', 'true', '--no-wait', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enforces the omni reference cap, Vidu seed ceiling, and flux-3 image-mode safety cap locally', async () => {
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'gemini-omni-flash-preview',
      '--image', ...Array.from({ length: 15 }, (_, i) => `https://example.com/${i}.png`), '--no-wait', '--json',
    ))).toBe(1);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'gemini-omni-flash-preview', '--generate-audio', 'true', '--no-wait', '--json',
    ))).toBe(1);
    expect(await main(argv('gen', 'video', 'x', '-m', 'viduq3-pro', '--seed', '3000000000', '--no-wait', '--json'))).toBe(1);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'flux-3', '--safety-tolerance', '4',
      '--image', 'https://example.com/a.png', '--no-wait', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enforces current Kling and Vidu duration and resolution contracts before submitting', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'kling-30', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv(
      'gen', 'video', 'cinematic ocean', '-m', 'kling-3.0',
      '--seconds', '15', '--resolution', '4k', '--aspect-ratio', '16:9', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      model: 'kling-3.0', duration: 15, metadata: { resolution: '4k', ratio: '16:9' },
    });

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'kling-3.0',
      '--seconds', '16', '--resolution', '1080p', '--no-wait', '--json',
    ))).toBe(1);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'viduq3-pro',
      '--seconds', '8', '--resolution', '4k', '--no-wait', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts --duration as the --seconds alias and rejects conflicting duplicates', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'alias-1', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--duration', '6', '--no-wait', '--json'))).toBe(0);
    expect(capturedBody?.duration).toBe(6);

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--seconds', '5', '--duration', '6', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits a stderr task_id breadcrumb so callers can recover after stdout parse failures', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/video/generations': () => ({ task_id: 'crumb-1', status: 'submitted' }) }),
    );
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--no-wait', '--json'))).toBe(0);
    expect(ctx.takeStdout()).toContain('"task_id": "crumb-1"');
    expect(ctx.stderr()).toContain('task_id=crumb-1');
  });

  it('task status 404 explains case-sensitive ID transcription instead of failing silently', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-typo': () => new Response(JSON.stringify({ error: { message: 'task not found' } }), { status: 404 }),
        '/v1/images/generations/task-typo': () => new Response(JSON.stringify({ error: { message: 'task not found' } }), { status: 404 }),
      }),
    );
    expect(await main(argv('task', 'status', 'task-typo', '--json'))).toBe(1);
    const out = parseStdoutJson() as { error: { code: string; hint?: string } };
    expect(out.error.code).toBe('model_not_found');
    expect(out.error.hint).toContain('逐字复制');
  });

  it('maps LTX and FLUX 3 parameters and validates their live ranges', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'ltx-25', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv(
      'gen', 'video', 'cinematic ocean', '-m', 'ltx-2-5-fast', '--seconds', '12',
      '--resolution', '1920x1080', '--fps', '25', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      model: 'ltx-2-5-fast', duration: 12,
      metadata: { resolution: '1920x1080', fps: 25 },
    });

    // seed is rejected by the LTX contract (F-13.1) — local intercept.
    const ltxSpy = mockFetchRouter({});
    vi.stubGlobal('fetch', ltxSpy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'ltx-2-5-fast', '--seed', '42', '--no-wait', '--json',
    ))).toBe(1);
    expect(ltxSpy).not.toHaveBeenCalled();

    vi.stubGlobal(
      'fetch',
      mockFetchRouter({ '/v1/video/generations': () => ({ task_id: 'flux-3', status: 'submitted' }) }),
    );
    expect(await main(argv(
      'gen', 'video', 'cinematic ocean', '-m', 'flux-3', '--seconds', '20',
      '--resolution', 'fhd', '--ratio', '21:9', '--safety-tolerance', '4', '--no-wait', '--json',
    ))).toBe(0);

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'flux-3', '--seconds', '20', '--safety-tolerance', '5', '--no-wait', '--json',
    ))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('gen video metadata content', () => {
  it('allows documented Ark content through metadata.content', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'seedance-content', status: 'submitted' };
        },
      }),
    );

    const content = JSON.stringify([{ type: 'text', text: 'Use this exact prompt.' }]);
    expect(await main(argv(
      'gen', 'video', 'ignored facade prompt', '-m', 'dreamina-seedance-2-0-260128',
      '--content', content, '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody?.metadata).toMatchObject({ content: [{ type: 'text', text: 'Use this exact prompt.' }] });
  });
});

describe('task list + wait + idempotency key', () => {
  it('inlines local reference media via @file into all gen paths with size guards', async () => {
    const png = Buffer.from('local-ref-media').toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'atfile-1', status: 'submitted' };
        },
      }),
    );
    const localRef = join(ctx.homeDir, 'ref.png');
    writeFileSync(localRef, Buffer.from('local-ref-media'));

    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--image', `@${localRef}`, '--no-wait', '--json'))).toBe(0);
    expect(String((capturedBody?.images as string[])[0])).toMatch(/^data:image\/png;base64,/);

    // 缺失文件与超限文件都在本地拒绝，不发请求。
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--image', '@/nonexistent/ref.png', '--no-wait', '--json'))).toBe(1);
    const oversized = join(ctx.homeDir, 'big.png');
    writeFileSync(oversized, Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--image', `@${oversized}`, '--no-wait', '--json'))).toBe(1);
    // 裸本地路径（无 @ 前缀）本地拦截并给出加 @ 的指引。
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--image', 'C:/Users/x/ref.png', '--no-wait', '--json'))).toBe(1);
    expect(ctx.stderr()).toContain('@C:/imgs/ref.png');
    expect(spy).not.toHaveBeenCalled();
  });

  it('gen gemini-image accepts a local reference via @file as inlineData', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1beta/models/gemini-3.1-flash-image:generateContent': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'ZmFrZQ==' } }] } }] };
        },
      }),
    );
    const localRef = join(ctx.homeDir, 'gemref.png');
    writeFileSync(localRef, Buffer.from('gem-ref'));
    expect(await main(argv('gen', 'gemini-image', 'x', '-m', 'gemini-3.1-flash-image', '--image', `@${localRef}`, '--json'))).toBe(0);
    const parts = ((capturedBody?.contents as Array<{ parts: Array<{ inlineData?: { mimeType?: string } }> }>)[0])?.parts;
    expect(parts?.[1]?.inlineData?.mimeType).toBe('image/png');
  });

  it('task list returns the caller\'s recent tasks', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/tasks': () => ({
          object: 'list',
          data: [
            { task_id: 't-newest', model: 'grok-imagine-video', action: 'generate', status: 'in_progress', progress: 40, quota: 5000, created_at: 1787000000 },
            { task_id: 't-older', model: 'seedream-5-0-260128', action: 'image_generation', status: 'completed', progress: 100, quota: 3000, created_at: 1786900000 },
          ],
        }),
      }),
    );
    expect(await main(argv('task', 'list', '--json'))).toBe(0);
    const out = parseStdoutJson() as { data: { task_id: string }[] };
    expect(out.data.map((item) => item.task_id)).toEqual(['t-newest', 't-older']);
  });

  it('task status --wait polls to a terminal state and reports elapsed time', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations/task-wait-1': () => {
          calls += 1;
          if (calls === 1) {
            return { task_id: 'task-wait-1', status: 'IN_PROGRESS', progress: 40, created_at: Math.floor(Date.now() / 1000) - 30 };
          }
          return { task_id: 'task-wait-1', status: 'SUCCESS', progress: 100, created_at: Math.floor(Date.now() / 1000) - 90 };
        },
      }),
    );
    expect(await main(argv('task', 'status', 'task-wait-1', '--wait', '--poll-interval', '10', '--json'))).toBe(0);
    const out = parseStdoutJson() as { status: string; elapsed_seconds: number };
    expect(out.status).toBe('success');
    expect(out.elapsed_seconds).toBeGreaterThanOrEqual(90);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('gen video sends an idempotency key and breadcrumbs it on stderr', async () => {
    let capturedKey: string | null = null;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedKey = new Headers(init?.headers).get('Idempotency-Key');
          return { task_id: 'idem-1', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--idempotency-key', 'agent-fixed-key-0001', '--no-wait', '--json'))).toBe(0);
    expect(capturedKey).toBe('agent-fixed-key-0001');
    expect(ctx.stderr()).toContain('idempotency_key=agent-fixed-key-0001');

    // Auto-generated keys are valid and also breadcrumbed.
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--no-wait', '--json'))).toBe(0);
    expect(ctx.stderr()).toMatch(/idempotency_key=[0-9a-f-]{36}/);

    // Malformed keys are rejected locally.
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--idempotency-key', 'bad key!', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces the idempotent_replay marker when the server replays the original task', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': () => ({ task_id: 'idem-orig', status: 'queued', idempotent_replay: true }),
      }),
    );
    expect(await main(argv('gen', 'video', 'x', '-m', 'grok-imagine-video-1.5', '--idempotency-key', 'retry-same-key-0001', '--no-wait', '--json'))).toBe(0);
    const out = parseStdoutJson() as { task_id: string; idempotent_replay?: boolean };
    expect(out.task_id).toBe('idem-orig');
    expect(out.idempotent_replay).toBe(true);
    expect(ctx.stderr()).toContain('已回放原任务');
  });
});

describe('usage', () => {
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

  it('人读输出将账单对象拆为总用量和对象类型', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/api/usage/token/': () => TOKEN_USAGE_OK,
        '/v1/dashboard/billing/usage': () => ({ object: 'list', total_usage: 1234.5678 }),
      }),
    );
    expect(await main(argv('usage'))).toBe(0);
    expect(ctx.stdout()).toContain('1,234.5678');
    expect(ctx.stdout()).not.toContain('{"object"');
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
    // No --key, environment value, or configuration.
    expect(await main(['node', 'focalapi', 'doctor', '--json', '--base-url', BASE])).toBe(1);
    const out = parseStdoutJson() as { ok: boolean; checks: { ok: boolean }[] };
    expect(out.ok).toBe(false);
    expect(out.checks[0]!.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
