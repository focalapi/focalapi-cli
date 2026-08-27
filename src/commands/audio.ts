/**
 * focalapi audio: transcription through /v1/audio/transcriptions and speech synthesis through /v1/audio/speech.
 */

import { readFile, writeFile } from 'node:fs/promises';
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
    .argument('[text...]', '要合成的文本（eleven-v3-dialogue 用 --dialogue 时可省略）')
    .requiredOption('-m, --model <model>', 'TTS 模型 ID（必填、无默认值；运行 focalapi models list 查看）')
    .option('--voice <voice>', '音色（ElevenLabs 用完整标签如 "Sarah (female, american)"；Seed Audio 用 "Tim (Male, English)"）')
    .option('--voices <voices...>', 'Fish Audio 音色数组（可多个）')
    .option('--dialogue <json>', 'eleven-v3-dialogue 多角色台词数组，如 [\"{\\"text\\":\\"你好\\",\\"voice\\":\\"Sarah (female, american)\\"}\"] 或 @dialogue.json；1-10 条，每条 {text, voice}')
    .option('--stability <n>', 'eleven 系列语音稳定性 0-1', (v) => Number.parseFloat(v))
    .option('--language-code <code>', 'ISO-639 语言码（eleven 系列可省略自动检测）')
    .option('--format <fmt>', '音频格式（mp3/wav/...）', 'mp3')
    .option('-o, --out <file>', '输出文件路径')
    .action(async (textParts: string[], opts: { model: string; voice?: string; format: string; out?: string; dialogue?: string; stability?: number; languageCode?: string }, cmd: Command) => {
      const g = cmd.optsWithGlobals() as GlobalOpts;
      const auth = resolveAuth(g);
      // The gateway exposes TTS through the task-based /v1/audio/generations
      // endpoint, not the OpenAI /v1/audio/speech path (audio matrix
      // 2026-08-26: all six TTS models 404 on the speech path).
      // eleven-v3-dialogue 走 dialogue 数组（1-10 条 {text, voice}），不送
      // 顶层 prompt/voice；其余 TTS 模型维持 prompt+voice 门面。
      let speechBody: Record<string, unknown>;
      if (opts.dialogue) {
        const dialogueRaw = opts.dialogue.startsWith('@')
          ? await readFile(resolve(opts.dialogue.slice(1)), 'utf8')
          : opts.dialogue;
        let dialogue: unknown;
        try {
          dialogue = JSON.parse(dialogueRaw);
        } catch {
          throw new ApiError('invalid_request', `--dialogue 不是合法 JSON：${opts.dialogue.slice(0, 80)}`);
        }
        if (!Array.isArray(dialogue) || dialogue.length < 1 || dialogue.length > 10) {
          throw new ApiError('invalid_request', '--dialogue 必须是 1-10 条的 JSON 数组');
        }
        for (const [i, line] of dialogue.entries()) {
          const entry = line as { text?: unknown; voice?: unknown };
          if (typeof entry.text !== 'string' || !entry.text.trim() || typeof entry.voice !== 'string' || !entry.voice.trim()) {
            throw new ApiError('invalid_request', `--dialogue[${i}] 必须含非空 text 与 voice（22 个 ElevenLabs 预置音色标签）`);
          }
        }
        speechBody = { model: opts.model, dialogue };
        if (opts.stability !== undefined) speechBody.stability = opts.stability;
        if (opts.languageCode) speechBody.language_code = opts.languageCode;
      } else {
        if (textParts.length === 0) {
          throw new ApiError('invalid_request', '缺少要合成的文本（或对 eleven-v3-dialogue 使用 --dialogue）');
        }
        speechBody = { model: opts.model, prompt: textParts.join(' '), ...((opts as { voices?: string[] }).voices ? { voices: (opts as { voices?: string[] }).voices } : { voice: opts.voice }) };
      }
      const created = await request<{ task_id?: string; id?: string }>({
        baseUrl: auth.baseUrl,
        path: '/v1/audio/generations',
        apiKey: auth.apiKey,
        body: speechBody,
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
