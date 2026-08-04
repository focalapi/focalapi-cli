/**
 * focalapi chat：OpenAI 兼容对话（/v1/chat/completions），支持流式与多模态 @file 输入。
 */

import { Command } from 'commander';
import { ApiError } from '../lib/errors.js';
import { resolveAuth } from '../lib/config.js';
import { rawRequest, request, sseEvents } from '../lib/http.js';
import { isImageMime, readInputFile, readStdin, toDataUrl } from '../lib/fileinput.js';
import { info, isInteractive, printJson } from '../lib/output.js';
import type { GlobalOpts } from '../cli.js';

interface ChatMessage {
  role: string;
  content: unknown;
}

interface ChatResponse {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  [key: string]: unknown;
}

function resolveModel(flag?: string): string {
  const model = flag ?? process.env.FOCALAPI_MODEL;
  if (!model) {
    throw new ApiError('invalid_request', '缺少模型参数', {
      hint: '用 -m <model> 指定模型，或设置 FOCALAPI_MODEL；可用模型见 focalapi models list。免费演练模型：focal-rehearsal-chat。',
    });
  }
  return model;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('');
  }
  return '';
}

export function registerChat(program: Command): void {
  program
    .command('chat')
    .description('对话与多模态推理（/v1/chat/completions）')
    .argument('[prompt...]', '提示词；省略且 stdin 为管道时从 stdin 读取')
    .option('-m, --model <model>', '模型 ID（或设 FOCALAPI_MODEL）')
    .option('--system <text>', 'system 提示词')
    .option('--input <file...>', '输入文件（图片转 data URL，如 --input @photo.jpg；@ 前缀可选）')
    .option('--max-tokens <n>', 'max_tokens', (v) => Number.parseInt(v, 10))
    .option('--stream', '强制流式输出')
    .option('--no-stream', '强制非流式')
    .action(
      async (
        promptParts: string[],
        opts: { model?: string; system?: string; input?: string[]; maxTokens?: number; stream?: boolean },
        cmd: Command,
      ) => {
        const g = cmd.optsWithGlobals() as GlobalOpts;
        const auth = resolveAuth(g);
        const model = resolveModel(opts.model);

        let prompt = promptParts.join(' ').trim();
        if (!prompt && !process.stdin.isTTY) {
          prompt = await readStdin();
        }
        const inputs = (opts.input ?? []).map((p) => readInputFile(p.replace(/^@/, '')));
        if (!prompt && inputs.length === 0) {
          throw new ApiError('invalid_request', '缺少提示词', {
            hint: 'focalapi chat "你的问题" -m <model>，或 echo "问题" | focalapi chat -m <model>。',
          });
        }

        let userContent: unknown = prompt;
        if (inputs.length > 0) {
          const parts: Record<string, unknown>[] = [];
          if (prompt) parts.push({ type: 'text', text: prompt });
          for (const file of inputs) {
            if (isImageMime(file.mime)) {
              parts.push({ type: 'image_url', image_url: { url: toDataUrl(file) } });
            } else if (file.mime.startsWith('text/') || file.mime === 'application/json') {
              parts.push({ type: 'text', text: `\n\n[文件 ${file.name}]\n${file.data.toString('utf-8')}` });
            } else {
              throw new ApiError('invalid_request', `chat 暂不支持该文件类型：${file.name}（${file.mime}）`, {
                hint: '图片可直接传入；音视频请用 focalapi audio 系列命令。',
              });
            }
          }
          userContent = parts;
        }

        const messages: ChatMessage[] = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        messages.push({ role: 'user', content: userContent });

        const body: Record<string, unknown> = { model, messages };
        if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

        // 流式默认：TTY 且非 JSON 模式
        const stream = opts.stream ?? (isInteractive() && !g.json);
        body.stream = stream;

        if (!stream) {
          const res = await request<ChatResponse>({
            baseUrl: auth.baseUrl,
            path: '/v1/chat/completions',
            apiKey: auth.apiKey,
            body,
            timeoutMs: 300_000,
          });
          if (g.json) {
            printJson(res);
          } else {
            const text = extractText(res.choices?.[0]?.message?.content);
            process.stdout.write(text + '\n');
            if (res.usage) {
              info(`（tokens: prompt=${res.usage.prompt_tokens ?? '-'} completion=${res.usage.completion_tokens ?? '-'}）`);
            }
          }
          return;
        }

        const res = await rawRequest({
          baseUrl: auth.baseUrl,
          path: '/v1/chat/completions',
          apiKey: auth.apiKey,
          body,
          timeoutMs: 300_000,
        });
        const collected: string[] = [];
        for await (const data of sseEvents(res)) {
          let chunk: { choices?: { delta?: { content?: unknown } }[] };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          const text = extractText(chunk.choices?.[0]?.delta?.content);
          if (text) {
            collected.push(text);
            process.stdout.write(text);
          }
        }
        process.stdout.write('\n');
        if (g.json) {
          // --json + 显式 --stream：流结束后输出聚合结果
          printJson({ model, content: collected.join('') });
        }
      },
    );
}
