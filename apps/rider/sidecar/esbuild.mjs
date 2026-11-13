import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/sidecar.mjs',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    js: [
      "import { createRequire as __ss14CreateRequire } from 'node:module';",
      'const require = __ss14CreateRequire(import.meta.url);',
    ].join('\n'),
  },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching Rider sidecar sources...');
} else {
  await build(options);
}
