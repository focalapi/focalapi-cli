import { describe, expect, it, vi } from 'vitest';
import { maskKey, sanitize } from '../src/lib/output.js';
import { normalizeHomePath } from '../src/lib/config.js';
import { extractProgress, extractTaskId, normalizeTaskStatus } from '../src/lib/tasks.js';
import { validateImageGeneration, validateVideoGeneration } from '../src/lib/model-capabilities.js';

describe('normalizeHomePath（Windows MSYS 路径防御）', () => {
  it('MSYS 风格转 Windows 原生；普通路径原样返回', () => {
    if (process.platform === 'win32') {
      expect(normalizeHomePath('/c/Users/foo')).toBe('C:\\Users\\foo');
      expect(normalizeHomePath('/d/hezh/Gitee')).toBe('D:\\hezh\\Gitee');
      expect(normalizeHomePath('C:\\Users\\foo')).toBe('C:\\Users\\foo');
    } else {
      expect(normalizeHomePath('/c/Users/foo')).toBe('/c/Users/foo');
    }
  });
});

describe('maskKey / sanitize', () => {
  it('长 key 保留首尾，短 key 全脱敏', () => {
    expect(maskKey('sk-abcdef123456')).toBe('sk-ab***3456');
    expect(maskKey('short')).toBe('***');
  });

  it('sanitize 递归脱敏 key 字段与字符串中的 sk-', () => {
    const dirty = {
      apiKey: 'sk-abcdef1234567890abcdef12',
      nested: { authorization: 'Bearer sk-abcdef1234567890abcdef12' },
      list: ['error near sk-abcdef1234567890abcdef12 end'],
      untouched: 42,
    };
    const clean = sanitize(dirty) as Record<string, unknown>;
    expect(JSON.stringify(clean)).not.toContain('sk-abcdef1234567890abcdef12');
    expect((clean.nested as Record<string, unknown>).authorization).toBe('Bearer sk-ab***ef12');
    expect(clean.untouched).toBe(42);
  });

  it('不误伤含 sk- 片段的任务 ID / 文件路径（回归）', () => {
    const taskId = 'task_nW4RVxsd3dRLrhBbG7tCHV0gaYlIAUEN';
    const path = 'D:\\out\\task-task_nW4RVxsd3dRLrhBbG7tCHV0gaYlIAUEN.mp4';
    expect(sanitize({ task_id: taskId })).toEqual({ task_id: taskId });
    expect(sanitize({ file: path })).toEqual({ file: path });
  });
});

describe('任务状态归一化', () => {
  it('成功/失败/运行/等待/未知', () => {
    expect(normalizeTaskStatus('success')).toBe('success');
    expect(normalizeTaskStatus('SUCCEEDED')).toBe('success');
    expect(normalizeTaskStatus('failed')).toBe('failed');
    expect(normalizeTaskStatus('processing')).toBe('running');
    expect(normalizeTaskStatus('queued')).toBe('pending');
    expect(normalizeTaskStatus('whatever')).toBe('unknown');
    expect(normalizeTaskStatus(undefined)).toBe('unknown');
  });

  it('cancelled 独立终态；expired 归失败；queued_* 前缀族归等待（平台状态归一）', () => {
    expect(normalizeTaskStatus('cancelled')).toBe('cancelled');
    expect(normalizeTaskStatus('CANCELED')).toBe('cancelled');
    expect(normalizeTaskStatus('expired')).toBe('failed');
    expect(normalizeTaskStatus('queued_waiting')).toBe('pending');
    expect(normalizeTaskStatus('queued_limited')).toBe('pending');
  });
});

describe('任务 ID / 进度提取（宽容解析多渠道上游）', () => {
  it('task_id / id / data.task_id 都能取到', () => {
    expect(extractTaskId({ task_id: 't1' })).toBe('t1');
    expect(extractTaskId({ id: 't2' })).toBe('t2');
    expect(extractTaskId({ data: { task_id: 't3' } })).toBe('t3');
    expect(extractTaskId({ id: 123 })).toBe('123');
    expect(extractTaskId({})).toBeUndefined();
    expect(extractTaskId('nope')).toBeUndefined();
  });

  it('progress 兼容 0-1 小数、百分数、字符串', () => {
    expect(extractProgress({ progress: 0.5 })).toBe(50);
    expect(extractProgress({ progress: 80 })).toBe(80);
    expect(extractProgress({ progress: '60%' })).toBe(60);
    expect(extractProgress({})).toBeUndefined();
  });
});

describe('validateImageGeneration 新图像族本地契约', () => {
  const base = { n: 1 };

  it('krea-2 接受最多 10 张参考图（平台 OpenAI facade 映射 style reference，2026-08-25 审计回归）', () => {
    expect(() => validateImageGeneration('krea-2-medium', { ...base, imageCount: 10 })).not.toThrow();
    expect(() => validateImageGeneration('krea-2-large', { ...base, imageCount: 11 })).toThrow(/at most 10 reference images/);
  });

  it('Gemini 图像模型在 gen image 上本地拦截并指向 gen gemini-image（P07）', () => {
    expect(() => validateImageGeneration('gemini-3-pro-image', base)).toThrow(/gen gemini-image/);
    expect(() => validateImageGeneration('gemini-2.5-flash-image', base)).toThrow(/gen gemini-image/);
  });

  it('增强/超分/矢量化族要求恰好一张输入图', () => {
    for (const model of ['topaz-image-reimagine', 'topaz-image-bloom-2', 'topaz-image-wonder-3-5',
      'wavespeed-seedvr2-upscale', 'wavespeed-ultimate-upscale', 'quiver-image-to-svg',
      'hitpaw-image-enhance', 'hitpaw-image-portrait-enhance', 'beeble-switchx-image-720p']) {
      expect(() => validateImageGeneration(model, { ...base, imageCount: 0 })).toThrow(/requires at least 1 input image/);
      expect(() => validateImageGeneration(model, { ...base, imageCount: 1 })).not.toThrow();
    }
  });

  it('topaz creativity 是 1-9 整数；wavespeed 分辨率 2k/4k/8k；quiver t2svg 最多 4 参考图；beeble 最多 2 图', () => {
    expect(() => validateImageGeneration('topaz-image-reimagine', { ...base, imageCount: 1, creativity: '5' })).not.toThrow();
    expect(() => validateImageGeneration('topaz-image-reimagine', { ...base, imageCount: 1, creativity: 'high' })).toThrow(/integer 1-9/);
    expect(() => validateImageGeneration('topaz-image-reimagine', { ...base, imageCount: 1, creativity: '10' })).toThrow(/integer 1-9/);
    expect(() => validateImageGeneration('wavespeed-ultimate-upscale', { ...base, imageCount: 1, resolution: '8k' })).not.toThrow();
    expect(() => validateImageGeneration('wavespeed-ultimate-upscale', { ...base, imageCount: 1, resolution: '16k' })).toThrow(/resolution/);
    expect(() => validateImageGeneration('quiver-text-to-svg', { ...base, imageCount: 4 })).not.toThrow();
    expect(() => validateImageGeneration('quiver-text-to-svg', { ...base, imageCount: 5 })).toThrow(/at most 4 reference images/);
    expect(() => validateImageGeneration('beeble-switchx-image-1080p', { ...base, imageCount: 2 })).not.toThrow();
    expect(() => validateImageGeneration('beeble-switchx-image-1080p', { ...base, imageCount: 3 })).toThrow(/at most 2 reference images/);
  });

  it('recraft 尺寸走官方表；n 1-6；不接受参考图', () => {
    expect(() => validateImageGeneration('recraft-v4', { n: 6, size: '1536x768' })).not.toThrow();
    expect(() => validateImageGeneration('recraft-v4', { n: 7, size: '1024x1024' })).toThrow(/n must be 1-6/);
    expect(() => validateImageGeneration('recraft-v4', { n: 1, size: '2048x2048' })).toThrow(/size must be one of/);
    expect(() => validateImageGeneration('recraft-v4-pro', { n: 1, size: '2048x2048' })).not.toThrow();
    expect(() => validateImageGeneration('recraft-v4', { n: 1, size: '1024x1024', imageCount: 1 })).toThrow(/reference images/);
  });
});

describe('validateVideoGeneration 新视频族本地契约(vid-matrix 2026-08-26)', () => {
  it('源长族拒绝显式时长;其余族校验时长档', () => {
    expect(() => validateVideoGeneration('heygen-talking-photo', { seconds: 5 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('topaz-video-enhance', { seconds: 10 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('bria-video-edit', { seconds: 5 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('happyhorse-1.0-video-edit', { seconds: 5 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('wan2.7-t2v', { seconds: 5 })).not.toThrow();
    expect(() => validateVideoGeneration('wan2.7-videoedit', { seconds: 11 })).toThrow(/seconds must be 2-10/);
    expect(() => validateVideoGeneration('pixverse-v5', { seconds: 6 })).toThrow(/seconds must be one of 5, 8/);
    expect(() => validateVideoGeneration('luma-ray-3-2', { seconds: 7 })).toThrow(/seconds must be one of 5, 10/);
    expect(() => validateVideoGeneration('MiniMax-H3', { seconds: 3 })).toThrow(/seconds must be 4-15/);
    expect(() => validateVideoGeneration('kling-v3-omni', { resolution: '4k', seconds: 5 })).not.toThrow();
    expect(() => validateVideoGeneration('happyhorse-1.1-i2v', { seconds: 5 })).not.toThrow();
    expect(() => validateVideoGeneration('wan2.7-t2v', { resolution: '4k' })).toThrow(/resolution must be one of/);
    // 2026-08-27 批次 B/D：LTX 2s 档放开；Vidu Q2 续写 1-7s + seed；
    // 口型同步/翻译为源长族；luma 360p 档。
    expect(() => validateVideoGeneration('ltx-2-5-fast', { seconds: 2 })).not.toThrow();
    expect(() => validateVideoGeneration('ltx-2-5-pro', { seconds: 3 })).toThrow(/seconds must be one of 2, 4/);
    expect(() => validateVideoGeneration('luma-ray-3-2', { resolution: '360p', seconds: 5 })).not.toThrow();
    expect(() => validateVideoGeneration('viduq2-pro-extend', { seconds: 8 })).toThrow(/seconds must be 1-7/);
    expect(() => validateVideoGeneration('viduq2-turbo-extend', { seconds: 4, resolution: '1080p', seed: 42 })).not.toThrow();
    expect(() => validateVideoGeneration('viduq2-turbo-extend', { resolution: '4k' })).toThrow(/resolution must be one of 720p, 1080p/);
    expect(() => validateVideoGeneration('kling-lipsync-audio', { seconds: 5 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('kling-lipsync-text', { seconds: 5 })).toThrow(/does not accept a duration/);
    expect(() => validateVideoGeneration('heygen-video-translate', { seconds: 5 })).toThrow(/does not accept a duration/);
  });
});

describe('pollTask 网络容错(轮询断连不弃任务)', () => {
  it('连续 3 次网络失败后恢复并成功;连续 5 次才放弃且带续取指引', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls <= 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ task_id: 't1', status: 'success', files: ['x.mp4'] }), { status: 200 });
    }));
    const tasks = await import('../src/lib/tasks.js');
    const info = await tasks.pollTask('https://example.test', 'sk-test', 't1', { intervalMs: 1, timeoutMs: 5_000 });
    expect(info.status).toBe('success');
    expect(calls).toBe(4);

    let hardCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      hardCalls += 1;
      throw new TypeError('fetch failed');
    }));
    await expect(tasks.pollTask('https://example.test', 'sk-test', 't2', { intervalMs: 1, timeoutMs: 5_000 }))
      .rejects.toThrow(/t2 可能仍在运行/);
    expect(hardCalls).toBe(5);
    vi.unstubAllGlobals();
  });
});
