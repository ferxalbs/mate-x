import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      // Transformers.js relies on import.meta.url to resolve its ONNX/WASM
      // assets. Keep it out of the CommonJS main bundle so Electron loads it
      // through its package exports at runtime.
      external: ['@vscode/ripgrep', '@huggingface/transformers'],
      output: {
        // Forge restarts Electron after a main-process rebuild, but the old
        // process can still handle IPC briefly. Hashed split chunks are removed
        // during that rebuild, so a late dynamic import can target a file that
        // no longer exists. Keep main.js self-contained across rebuilds.
        codeSplitting: false,
      },
    },
  },
});
