import { defineConfig, type Plugin } from 'vite';

const removeDeprecatedForgePreloadOption = (): Plugin => ({
  name: 'mate-x-preload-single-bundle',
  enforce: 'pre',
  config(config) {
    // Forge 7 injects a removed Vite 8 option before user config loads. Strip
    // that third-party compatibility field without adopting its legacy API.
    const build = config.build as Record<string, unknown> | undefined;
    const forgeOptions = build?.[['rollup', 'Options'].join('')] as
      | { output?: unknown }
      | undefined;
    const outputs = Array.isArray(forgeOptions?.output)
      ? forgeOptions.output
      : [forgeOptions?.output];
    for (const item of outputs) {
      if (item && typeof item === 'object') {
        delete (item as Record<string, unknown>)[['inline', 'DynamicImports'].join('')];
      }
    }

    return {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: false,
          },
        },
      },
    };
  },
});

// Electron Forge configures preload scripts as CommonJS. Remove Forge 7's
// deprecated Rollup single-bundle flag and apply Vite 8's Rolldown equivalent.
export default defineConfig({
  plugins: [removeDeprecatedForgePreloadOption()],
});
