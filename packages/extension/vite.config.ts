import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@mikukotoba/shared': resolve(__dirname, '../shared/src/index.ts'),
      'path': 'path-browserify',
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
        vocabulary: resolve(__dirname, 'src/vocabulary/vocabulary.html'),
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
});
