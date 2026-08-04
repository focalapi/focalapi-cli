import { describe, expect, it } from 'vitest';
import { maskKey, sanitize } from '../src/lib/output.js';
import { normalizeHomePath } from '../src/lib/config.js';
import { extractProgress, extractTaskId, normalizeTaskStatus } from '../src/lib/tasks.js';

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
      apiKey: 'sk-abcdef1234567890',
      nested: { authorization: 'Bearer sk-abcdef1234567890' },
      list: ['error near sk-abcdef1234567890 end'],
      untouched: 42,
    };
    const clean = sanitize(dirty) as Record<string, unknown>;
    expect(JSON.stringify(clean)).not.toContain('sk-abcdef1234567890');
    expect((clean.nested as Record<string, unknown>).authorization).toBe('Bearer sk-ab***7890');
    expect(clean.untouched).toBe(42);
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
