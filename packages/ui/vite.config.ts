import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../../apps/vscode/media/webview'),
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/studio.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
