import { createLogger, defineConfig } from 'vite';

// https://vitejs.dev/config
// Electron Forge configures preload scripts as single-file bundles internally.
const logger = createLogger();
const warn = logger.warn.bind(logger);

logger.warn = (message, options) => {
  if (message.includes('inlineDynamicImports option is deprecated')) {
    return;
  }

  warn(message, options);
};

export default defineConfig({ customLogger: logger });
