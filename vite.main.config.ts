import { createLogger, defineConfig } from 'vite';

const logger = createLogger();
const warn = logger.warn.bind(logger);

// Electron Forge 7 still sets this deprecated Rollup option internally while
// Vite 8 builds the main process. Keep the startup log focused on actionable
// warnings until Forge replaces it with codeSplitting: false.
logger.warn = (message, options) => {
  if (message.includes('inlineDynamicImports option is deprecated')) {
    return;
  }

  warn(message, options);
};

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rolldownOptions: {
      external: ['@vscode/ripgrep'],
    },
  },
  customLogger: logger,
});
