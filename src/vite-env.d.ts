import type { RepoInspectorApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
    };
  }
}

export {};
