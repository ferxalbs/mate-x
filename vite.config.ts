/**
 * Conventional Vite config marker for tooling such as shadcn/ui.
 *
 * Electron Forge uses vite.renderer.config.ts for the actual renderer build.
 * Re-exporting it here lets Vite-aware CLIs detect this as a Vite project
 * without creating a second renderer configuration.
 */
export { default } from './vite.renderer.config';
