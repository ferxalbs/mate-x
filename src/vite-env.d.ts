import type { GitApi, RepoInspectorApi, SettingsApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
      git: GitApi;
      settings: SettingsApi;
    };
  }
}

export {};
