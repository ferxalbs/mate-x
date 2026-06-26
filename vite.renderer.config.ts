import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import path from 'path';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    minify: 'oxc',
    target: 'esnext',
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
