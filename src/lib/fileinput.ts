/**
 * File-input utilities for --input @file, including file-to-data-URL and text conversion.
 */

import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { ApiError } from './errors.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
};

export interface InputFile {
  path: string;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function readInputFile(path: string): InputFile {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new ApiError('invalid_request', `文件不存在：${path}`);
  }
  if (!stat.isFile()) {
    throw new ApiError('invalid_request', `不是文件：${path}`);
  }
  if (stat.size > 50 * 1024 * 1024) {
    throw new ApiError('invalid_request', `文件超过 50MB 上限：${path}`, {
      hint: '大文件请先压缩或分段处理。',
    });
  }
  const ext = extname(path).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return { path, name: basename(path), mime, size: stat.size, data: readFileSync(path) };
}

export function toDataUrl(file: InputFile): string {
  return `data:${file.mime};base64,${file.data.toString('base64')}`;
}

/** Read all text from stdin for piped prompts. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
