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
      '--generate-audio', 'false', '--watermark', 'true', '--return-last-frame', 'true',
      '--callback-url', 'https://example.com/callback', '--execution-expires-after', '7200',
      '--safety-identifier', 'customer-42', '--priority', '4', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      images: ['https://example.com/frame.png'],
      metadata: {
        generate_audio: false,
        watermark: true,
        return_last_frame: true,
        callback_url: 'https://example.com/callback',
        execution_expires_after: 7200,
        safety_identifier: 'customer-42',
        priority: 4,
      },
    });
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
      '--aspect-ratio', '16:9', '--seed', '7', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({ duration: 6, metadata: { resolution: '1080p', ratio: '16:9', seed: 7 } });

    vi.stubGlobal('fetch', mockFetchRouter({ '/v1/video/generations': () => ({ task_id: 'seedance-25', status: 'submitted' }) }));
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-5-260628', '--seconds', '30', '--no-wait', '--json'))).toBe(0);
    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv('gen', 'video', 'x', '-m', 'dreamina-seedance-2-5-260628', '--seconds', '31', '--no-wait', '--json'))).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('enforces the official Veo 3.1 duration and resolution matrix before submitting', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      mockFetchRouter({
        '/v1/video/generations': (init) => {
          capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { task_id: 'veo-31', status: 'submitted' };
        },
      }),
    );
    expect(await main(argv(
      'gen', 'video', 'cinematic ocean', '-m', 'veo-3.1-generate-preview',
      '--seconds', '8', '--resolution', '4k', '--ratio', '16:9', '--no-wait', '--json',
    ))).toBe(0);
    expect(capturedBody).toMatchObject({
      model: 'veo-3.1-generate-preview', duration: 8, metadata: { resolution: '4k', ratio: '16:9' },
    });

    const spy = mockFetchRouter({});
    vi.stubGlobal('fetch', spy);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'veo-3.1-fast-generate-preview',
      '--seconds', '6', '--resolution', '1080p', '--no-wait', '--json',
    ))).toBe(1);
    expect(await main(argv(
      'gen', 'video', 'x', '-m', 'veo-3.1-lite-generate-preview',
      '--seconds', '8', '--resolution', '4k', '--no-wait', '--json',
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
    // 不传 --key，无 env 无 config
    expect(await main(['node', 'focalapi', 'doctor', '--json', '--base-url', BASE])).toBe(0);
    const out = parseStdoutJson() as { ok: boolean; checks: { ok: boolean }[] };
    expect(out.ok).toBe(false);
    expect(out.checks[0]!.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
