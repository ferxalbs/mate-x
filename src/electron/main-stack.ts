import { loadConfig, createMaTeXStack, type MaTeXConfig } from './config/mate-x.config';

export type MaTeXStack = Awaited<ReturnType<typeof createMaTeXStack>>;

let stack: MaTeXStack | null = null;
let configSnapshot: MaTeXConfig | null = null;

export async function initStack(): Promise<void> {
  configSnapshot = await loadConfig();
  stack = await createMaTeXStack(configSnapshot);
  stack.failureMemorySync.start();
}

export function getStack(): MaTeXStack {
  if (!stack) {
    throw new Error('MaTeX stack not initialized. Call initStack() first.');
  }

  return stack;
}

export function getConfigSnapshot(): MaTeXConfig {
  if (!configSnapshot) {
    throw new Error('MaTE X config not initialized. Call initStack() first.');
  }

  return configSnapshot;
}

export async function teardownStack(): Promise<void> {
  if (!stack) {
    return;
  }

  stack.failureMemorySync.stop();
  stack = null;
  configSnapshot = null;
}
