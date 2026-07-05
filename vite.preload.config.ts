import { defineConfig } from 'vite';

// https://vitejs.dev/config
// build.rolldownOptions.output.codeSplitting: false replaces the deprecated
// rollupOptions.output.inlineDynamicImports: true that Electron Forge's Vite
// plugin sets internally for preload scripts (single-file output required).
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});

