import type { GitApi, PolicyApi, PrivacyApi, RepoInspectorApi, SettingsApi, UiApi } from './contracts/ipc';

declare global {
  interface Window {
    mate: {
      repo: RepoInspectorApi;
      git: GitApi;
      settings: SettingsApi;
      policy: PolicyApi;
      privacy: PrivacyApi;
      ui: UiApi;
    };
  }
}

export {};
