/**
 * focalapi audio：语音转写（/v1/audio/transcriptions）与语音合成（/v1/audio/speech）。
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
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
    .option('--voice <voice>', '音色', 'alloy')
    .option('--format <fmt>', '音频格式（mp3/wav/...）', 'mp3')
    .option('-o, --out <file>', '输出文件路径')
    .action(async (textParts: string[], opts: { model: string; voice: string; format: string; out?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      const res = await rawRequest({
        baseUrl: auth.baseUrl,
        path: '/v1/audio/speech',
        apiKey: auth.apiKey,
        body: { model: opts.model, input: textParts.join(' '), voice: opts.voice, response_format: opts.format },
        timeoutMs: 300_000,
      });
      const buf = Buffer.from(await res.arrayBuffer());
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
