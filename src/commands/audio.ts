/**
 * focalapi audio: transcription through /v1/audio/transcriptions and speech synthesis through /v1/audio/speech.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { pollTask, extractTaskArtifactURL } from '../lib/tasks.js';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { rawRequest, request } from '../lib/http.js';
import { readInputFile } from '../lib/fileinput.js';
import { info, printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

export function registerAudio(program: Command): void {
  const audio = program
    .command('audio')
    .description('音频：转写与合成（没有默认模型；先运行 focalapi models list 查看当前 Key 可用的音频模型）');

  audio
    .command('transcribe')
    .description('语音转文字')
    .argument('<file>', '音频文件路径')
    .requiredOption('-m, --model <model>', '转写模型 ID（必填、无默认值；运行 focalapi models list 查看）')
    .option('--language <lang>', '语言代码（如 zh、en）')
    .action(async (file: string, opts: { model: string; language?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const input = readInputFile(file);
      const form = new FormData();
      form.append('file', new Blob([input.data], { type: input.mime }), input.name);
      form.append('model', opts.model);
      if (opts.language) form.append('language', opts.language);

      const res = await request<{ text?: string }>({
        baseUrl: auth.baseUrl,
        path: '/v1/audio/transcriptions',
        apiKey: auth.apiKey,
        formData: form,
        timeoutMs: 300_000,
      });
      if (g.json) {
        printJson(res);
      } else {
        process.stdout.write((res.text ?? JSON.stringify(res)) + '\n');
      }
    });

  audio
    .command('speech')
    .description('文字转语音，产物保存为音频文件')
    .argument('<text...>', '要合成的文本')
    .requiredOption('-m, --model <model>', 'TTS 模型 ID（必填、无默认值；运行 focalapi models list 查看）')
    .option('--voice <voice>', '音色（ElevenLabs 用完整标签如 "Sarah (female, american)"；Seed Audio 用 "Tim (Male, English)"）')
    .option('--voices <voices...>', 'Fish Audio 音色数组（可多个）')
    .option('--format <fmt>', '音频格式（mp3/wav/...）', 'mp3')
    .option('-o, --out <file>', '输出文件路径')
    .action(async (textParts: string[], opts: { model: string; voice: string; format: string; out?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      // The gateway exposes TTS through the task-based /v1/audio/generations
      // endpoint, not the OpenAI /v1/audio/speech path (audio matrix
      // 2026-08-26: all six TTS models 404 on the speech path).
      const created = await request<{ task_id?: string; id?: string }>({
        baseUrl: auth.baseUrl,
        path: '/v1/audio/generations',
        apiKey: auth.apiKey,
        body: { model: opts.model, prompt: textParts.join(' '), ...((opts as { voices?: string[] }).voices ? { voices: (opts as { voices?: string[] }).voices } : { voice: opts.voice }) },
        timeoutMs: 120_000,
      });
      const taskId = created.task_id ?? created.id;
      if (!taskId) {
        throw new ApiError('bad_response', '音频任务提交响应中未找到 task_id', { body: created });
      }
      const final = await pollTask(auth.baseUrl, auth.apiKey, taskId, {
        intervalMs: 3_000,
        timeoutMs: 300_000,
      });
      if (final.status !== 'success') {
        throw new ApiError('task_failed', `音频任务 ${taskId} 失败（${final.rawStatus ?? final.status}）`);
      }
      const url = extractTaskArtifactURL(final.raw);
      if (!url) {
        throw new ApiError('bad_response', '音频任务产物 URL 未找到');
      }
      const artifactRes = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!artifactRes.ok) {
        throw new ApiError('bad_response', `音频产物下载失败（HTTP ${artifactRes.status}）`);
      }
      const buf = Buffer.from(await artifactRes.arrayBuffer());
      if (buf.length === 0) {
        throw new ApiError('bad_response', '语音合成返回空内容');
      }
      const outPath = resolve(opts.out ?? `focalapi-out/speech-${Date.now()}.${opts.format}`);
      await writeFile(outPath, buf);
      if (g.json) {
        printJson({ file: outPath, bytes: buf.length });
      } else {
        info(`✓ ${outPath}`);
      }
    });
}
