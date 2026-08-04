import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  bundle: true,
  minify: false,
  sourcemap: false,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  define: { __FOCALAPI_VERSION__: JSON.stringify(pkg.version) },
});
