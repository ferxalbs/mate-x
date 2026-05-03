import type { GitApi, PolicyApi, PrivacyApi, RepoInspectorApi, SettingsApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
      git: GitApi;
      settings: SettingsApi;
      policy: PolicyApi;
      privacy: PrivacyApi;
    };
  }
}

export {};
