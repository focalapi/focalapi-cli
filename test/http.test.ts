import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/errors.js';
import { request, rawRequest, sseEvents } from '../src/lib/http.js';
import { setupTestEnv } from './helpers.js';

setupTestEnv();

const BASE = 'https://api.test.local';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('http.request', () => {
  it('GET 成功解析 JSON；query 拼接正确', async () => {
    const spy = vi.fn(async (input: unknown) => {
      const url = String(input);
      expect(url).toBe(`${BASE}/v1/models?a=1&b=x`);
      return jsonResponse(200, { data: [1, 2] });
    });
    vi.stubGlobal('fetch', spy);
    const res = await request<{ data: number[] }>({ baseUrl: BASE, path: '/v1/models', query: { a: 1, b: 'x', c: undefined } });
    expect(res.data).toEqual([1, 2]);
  });

  it('POST 带 Authorization 与 JSON body', async () => {
    const spy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer sk-abc');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual({ hello: 'world' });
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal('fetch', spy);
    await request({ baseUrl: BASE, path: '/x', apiKey: 'sk-abc', body: { hello: 'world' } });
  });

  it('401 + OpenAI 错误体 → invalid_api_key', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(401, { error: { message: 'Invalid API key provided' } }));
    const err = await request({ baseUrl: BASE, path: '/x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('upstream_auth_failed');
  });

  it('错误消息含 quota → insufficient_quota（即使状态码是 400）', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(400, { error: { message: 'user quota is not enough' } }));
    const err = await request({ baseUrl: BASE, path: '/x' }).catch((e) => e);
    expect((err as ApiError).code).toBe('insufficient_quota');
  });

  it('429 → rate_limited；500 → server_error', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(429, { error: { message: 'too many requests' } }));
    expect(((await request({ baseUrl: BASE, path: '/x' }).catch((e) => e)) as ApiError).code).toBe('rate_limited');
    vi.stubGlobal('fetch', async () => jsonResponse(502, { message: 'bad gateway' }));
    expect(((await request({ baseUrl: BASE, path: '/x' }).catch((e) => e)) as ApiError).code).toBe('server_error');
  });

  it('网络异常 → network_error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed: ECONNREFUSED');
    });
    const err = await request({ baseUrl: BASE, path: '/x' }).catch((e) => e);
    expect((err as ApiError).code).toBe('network_error');
  });

  it('new-api 形态 {success:false,message} 也能提取消息', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(403, { success: false, message: '令牌已过期' }));
    const err = await request({ baseUrl: BASE, path: '/x' }).catch((e) => e);
    expect((err as ApiError).message).toBe('令牌已过期');
  });
});

describe('sseEvents', () => {
  it('逐条解析 data 负载，[DONE] 结束', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: [DONE]\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const res = new Response(stream);
    const got: string[] = [];
    for await (const data of sseEvents(res)) {
      got.push(data);
    }
    expect(got).toHaveLength(2);
    expect(JSON.parse(got[0]!).choices[0].delta.content).toBe('你');
  });

  it('分片到达也能正确拼行', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"a":1'));
        controller.enqueue(enc.encode('}\n\ndata: {"b":2}\n\n'));
        controller.close();
      },
    });
    const res = new Response(stream);
    const got: string[] = [];
    for await (const data of sseEvents(res)) got.push(data);
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('rawRequest 非 2xx 时消费 body 后抛错', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(500, { error: { message: 'boom' } }));
    const err = await rawRequest({ baseUrl: BASE, path: '/x' }).catch((e) => e);
    expect((err as ApiError).code).toBe('server_error');
  });
});
